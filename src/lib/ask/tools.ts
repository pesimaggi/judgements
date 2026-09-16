/**
 * The tools the deep research loop is given, and the record of what it found.
 *
 * WHY THESE ONES
 *
 * Each is a question the fixed retrieval in lib/ask/retrieve.ts cannot ask.
 * That path runs one fan of searches derived from the plan and then answers,
 * so it can only ever find what the first guess at the vocabulary reaches. It
 * cannot read a judgment and follow what the judgment says; it cannot notice
 * that a decision has been applied since; it cannot use the subject tags a
 * human uses in seconds.
 *
 * The set below was chosen against a question the well got wrong: what E-5/21
 * decided, and whether Hæstiréttur has ruled since. Finding the follow-on case
 * by hand took one search of one court plus a tag. `find_citing_cases` is that
 * search, `search_decisions` takes the court and the tags, and
 * `read_decision` is what turns "this looks relevant" into something citable.
 *
 * THE RULE THAT KEEPS THE ANSWER HONEST
 *
 * **Only a document the loop has actually read can be cited.** Searching adds
 * nothing to the source list. That is not a limitation to work around — it is
 * what stops a model citing a case it saw the title of, and it is why the
 * system prompt in lib/ask/research.ts tells the loop to read everything it
 * intends to rely on. Numbering stays with our code either way: the model
 * gathers, `composeRetrieval` numbers.
 *
 * Nothing here can write, and nothing reaches the network. Every tool is a
 * read of this app's own search provider or its own database.
 */
import { prisma } from "../db";
import { getSearchProvider } from "../search";
import { SOURCES, isScholarship, sourceByKey } from "../sources";
import { searchTags } from "../tags";
import { actCitation, actPath } from "../acts";
import { rankActMatches } from "../act-match";
import { BEFORE, wordAlternation } from "../word-boundary";
import type { ProvisionHit, SearchHit } from "../types";
import type { AskToolDef } from "./llm";
import type { QueryPlan } from "./types";

/** Every live source, as the loop may name them. */
const SOURCE_KEYS = SOURCES.map((s) => s.key);

/** Rows any one call may return. Enough to choose from, not enough to drown in. */
const MAX_ROWS = 40;
/** Characters of a document a single read may return. */
const MAX_READ_CHARS = 60_000;
/** Articles one act outline may list. Enough for all but the largest codes. */
const MAX_OUTLINE_ROWS = 220;

/** The act columns `read_act_outline` needs to cite, link and rank an act. */
const ACT_SELECT = {
  id: true, jurisdiction: true, docType: true, actNumber: true, year: true,
  title: true, aliases: true, celex: true, citation: true,
} as const;

type ActRow = {
  id: string;
  jurisdiction: string;
  docType: string;
  actNumber: number;
  year: number;
  title: string;
  aliases: string[];
  celex: string | null;
  citation: string | null;
};

type ProvisionHitLike = Awaited<
  ReturnType<ReturnType<typeof getSearchProvider>["searchProvisions"]>
>["hits"][number];

/**
 * What the loop found, and what it read.
 *
 * `seen` is everything any search returned — the lookup that lets a later
 * `read_decision` know what it is opening. `documents` and `provisions` are
 * the ones actually read, and they alone become sources.
 */
export class ResearchSession {
  readonly seen = new Map<string, SearchHit>();
  readonly seenProvisions = new Map<string, ProvisionHitLike>();
  readonly documents = new Map<string, SearchHit>();
  readonly provisions = new Map<string, ProvisionHitLike>();
  /** Every call made, in order, for the metrics line and the transcript. */
  readonly calls: { name: string; input: unknown }[] = [];

  /**
   * True once `research_complete` has been accepted — the loop said it was
   * done and the gate below agreed.
   */
  finished = false;
  /** What the loop itself said it could not find. Reported as a limitation. */
  readonly declaredGaps: string[] = [];

  constructor(
    private readonly plan: QueryPlan,
    private readonly scope: "eea" | "eu" = "eea",
    /**
     * Calls the loop must make before `research_complete` is accepted.
     *
     * A floor, not a target. Two searches and a read is not research, and the
     * cheapest way for a model to finish a hard question is to decide early
     * that it has enough — which is precisely the behaviour that produced
     * answers reading as if they had been written off search summaries.
     */
    private readonly minCalls = 6
  ) {}

  tools(): AskToolDef[] {
    return TOOLS;
  }

  /**
   * Runs one call. Never throws.
   *
   * A tool that fails returns its failure as text on purpose: a model told
   * "that search errored, try another" carries on researching, and a model
   * handed an exception ends the request. The loop is the expensive part;
   * losing it to one bad argument is the worst outcome available.
   */
  async run(name: string, input: unknown): Promise<string> {
    this.calls.push({ name, input });
    const args = (input ?? {}) as Record<string, unknown>;
    try {
      switch (name) {
        case "search_decisions":
          return await this.searchDecisions(args);
        case "search_provisions":
          return await this.searchProvisions(args);
        case "find_citing_cases":
          return await this.findCitingCases(args);
        case "read_decision":
          return await this.readDecision(args);
        case "read_provision":
          return await this.readProvision(args);
        case "cases_citing_provision":
          return await this.casesCitingProvision(args);
        case "read_act_outline":
          return await this.readActOutline(args);
        case "list_subject_tags":
          return await this.listTags(args);
        case "research_complete":
          return this.researchComplete(args);
        default:
          return `No tool named "${name}". Available: ${TOOLS.map((t) => t.name).join(", ")}.`;
      }
    } catch (e) {
      console.error(`Ask: research tool ${name} failed:`, e);
      return `The tool "${name}" failed: ${String(e).slice(0, 200)}. Try a different search.`;
    }
  }

  // -- searching ------------------------------------------------------------

  private async searchDecisions(a: Record<string, unknown>): Promise<string> {
    const query = str(a.query);
    if (!query) return "search_decisions needs a query.";

    const asked = strings(a.sources);
    const unknown = asked.filter((s) => !SOURCE_KEYS.includes(s));
    if (unknown.length) {
      return `Unknown source key(s): ${unknown.join(", ")}. Valid keys: ${SOURCE_KEYS.join(", ")}.`;
    }

    const { hits, total } = await getSearchProvider().search({
      query,
      sources: asked.length ? asked : SOURCE_KEYS,
      tags: strings(a.tags),
      dateFrom: str(a.dateFrom) || undefined,
      dateTo: str(a.dateTo) || undefined,
      sort: "relevance",
      page: 1,
      pageSize: clamp(a.limit, 10, 1, MAX_ROWS),
    });

    const usable = hits.filter((h) => !h.isSample);
    for (const h of usable) this.seen.set(h.id, h);
    return rows(usable, total, "No decision matched. Try other wording, or list_subject_tags.");
  }

  private async searchProvisions(a: Record<string, unknown>): Promise<string> {
    const query = str(a.query);
    if (!query) return "search_provisions needs a query.";

    const { hits } = await getSearchProvider().searchProvisions({
      query,
      actId: str(a.actId) || undefined,
      scope: this.scope,
      page: 1,
      pageSize: clamp(a.limit, 8, 1, MAX_ROWS),
    });
    for (const h of hits) this.seenProvisions.set(h.id, h);
    if (hits.length === 0) return "No provision matched that wording.";

    return hits
      .map(
        (h) =>
          `provisionId=${h.id} | ${h.displayLabel} ${h.actCitation}` +
          `${h.heading ? ` — ${h.heading}` : ""} | ${h.actTitle}` +
          `${h.caseCount ? ` | cited by ${h.caseCount} decisions` : ""}`
      )
      .join("\n");
  }

  /**
   * Decisions whose text cites a case number.
   *
   * The question this exists for is "and what happened next in Iceland" — the
   * one the well could not answer about E-5/21, whose follow-on judgment a
   * human found in one search. A case number tokenises as a phrase, so this is
   * an ordinary full-text search with the citing case itself removed.
   */
  private async findCitingCases(a: Record<string, unknown>): Promise<string> {
    const caseNumber = str(a.caseNumber);
    if (!caseNumber) return "find_citing_cases needs a caseNumber, e.g. \"E-5/21\".";

    const asked = strings(a.sources).filter((s) => SOURCE_KEYS.includes(s));
    const { hits, total } = await getSearchProvider().search({
      query: `"${caseNumber.replace(/"/g, "")}"`,
      sources: asked.length ? asked : SOURCE_KEYS,
      sort: "relevance",
      page: 1,
      pageSize: clamp(a.limit, 15, 1, MAX_ROWS),
    });

    // The case itself is not a case citing it, and neither is a near-match on
    // some other number: this is an exact-citation question.
    const usable = hits.filter((h) => !h.isSample && !h.isFuzzy && h.caseNumber !== caseNumber);
    for (const h of usable) this.seen.set(h.id, h);
    return rows(
      usable,
      total,
      `Nothing in the corpus cites ${caseNumber}. That is not proof none exists — try search_decisions on the subject instead.`
    );
  }

  private async listTags(a: Record<string, unknown>): Promise<string> {
    const found = await searchTags(str(a.query), clamp(a.limit, 20, 1, 40));
    if (found.length === 0) return "No subject tag matched.";
    return found.map((t) => `${t.tag} (${t.count})`).join("\n");
  }

  /**
   * The judgments that cite one article, from the citation graph.
   *
   * This is the move the well could not make, and it is the one an Icelandic
   * lawyer makes first: find the governing article, then ask what the courts
   * have actually done with it. `CaseProvisionLink` has held the answer since
   * ingestion — the act reader shows it as "12 úrlausnir vísa til þessa
   * ákvæðis" — and until now nothing in the well could ask.
   *
   * It beats a keyword search for the same thing because it is not a keyword
   * search. A judgment applying 41. gr. laga nr. 70/1996 need never use the
   * words "tímabundinn ráðningarsamningur"; it cites the article, and the
   * article is what binds.
   *
   * The citing passage comes back with each row, so the loop can tell a case
   * that turns on the article from one that lists it while awarding costs.
   */
  private async casesCitingProvision(a: Record<string, unknown>): Promise<string> {
    const provisionId = str(a.provisionId);
    if (!provisionId) {
      return "cases_citing_provision needs a provisionId, from search_provisions or read_act_outline.";
    }

    const provision = await prisma.provision.findUnique({
      where: { id: provisionId },
      select: { id: true, displayLabel: true, act: { select: { title: true } } },
    });
    if (!provision) return `No provision with id ${provisionId}.`;

    const asked = strings(a.sources).filter((k) => SOURCE_KEYS.includes(k));
    const where = {
      provisionLinks: { some: { provisionId } },
      ...(asked.length ? { source: { in: asked } } : {}),
      isSample: false,
    };

    const [documents, total] = await Promise.all([
      prisma.document.findMany({
        where,
        select: {
          id: true, source: true, court: true, caseNumber: true, caseName: true,
          title: true, date: true, year: true, subjectTags: true,
          officialUrl: true, pdfUrl: true,
          provisionLinks: {
            where: { provisionId },
            orderBy: { charOffset: "asc" },
            take: 2,
            select: { citationText: true, excerpt: true },
          },
        },
        // Newest first: the most recent application of an article is the one
        // most likely still to state the law.
        orderBy: [{ date: "desc" }, { caseNumber: "asc" }],
        take: clamp(a.limit, 20, 1, MAX_ROWS),
      }),
      prisma.document.count({ where }),
    ]);

    if (documents.length === 0) {
      return `No decision in the corpus cites ${provision.displayLabel} of ${provision.act?.title ?? "that act"}. That is not proof none exists — the citation graph only records citations our parser resolved. Try search_decisions on the subject as well.`;
    }

    const lines = documents.map((d) => {
      this.seen.set(d.id, {
        id: d.id, source: d.source, court: d.court, caseNumber: d.caseNumber,
        caseName: d.caseName, title: d.title,
        date: d.date ? d.date.toISOString() : null, year: d.year,
        subjectTags: d.subjectTags ?? [], officialUrl: d.officialUrl,
        pdfUrl: d.pdfUrl, snippet: "", summary: null, isSample: false, isFuzzy: false,
      });
      const cited = d.provisionLinks
        .map((l) => `    cites "${l.citationText}": ${collapse(l.excerpt).slice(0, 320)}`)
        .join("\n");
      return (
        `documentId=${d.id} | ${d.court}${d.caseNumber ? ` ${d.caseNumber}` : ""}` +
        `${d.date ? ` — ${d.date.toISOString().slice(0, 10)}` : ""} | ${d.caseName ?? d.title}` +
        `${sectorHint(d)}\n${cited}`
      );
    });

    const more = total > documents.length ? `\n(${total} cite it; ${documents.length} shown.)` : "";
    return (
      `Decisions citing ${provision.displayLabel} — ${provision.act?.title ?? ""}:\n\n` +
      `${lines.join("\n")}${more}\n\nUse read_decision on the ones worth relying on — nothing can be cited unread.`
    );
  }

  /**
   * An act's table of contents, so the loop can navigate it instead of
   * guessing words into it.
   *
   * Articles that answer a question often do not contain its vocabulary. The
   * rule that a fixed-term appointment in the state service may be made
   * terminable is in 41. gr. laga nr. 70/1996; the article says "ráða
   * starfsmann til starfa tímabundið" and never the phrase anyone would search
   * for. Reading down a list of 57 headings finds it in one call. Keyword
   * search may never find it at all.
   *
   * Every article listed becomes citable once `read_provision` opens it: the
   * outline registers each one exactly as a search result would, because an
   * article found by navigating is no less found than one found by searching.
   */
  private async readActOutline(a: Record<string, unknown>): Promise<string> {
    const actId = str(a.actId);
    const query = str(a.query);
    if (!actId && !query) return "read_act_outline needs an actId or a query naming the act.";

    const act = actId
      ? await prisma.act.findUnique({
          where: { id: actId },
          select: ACT_SELECT,
        })
      : await this.findAct(query);
    if (!act) {
      return `No act matched "${query}". Try the act's number ("70/1996"), its short name ("starfsmannalög"), or words from its title.`;
    }

    const citation = actCitation(act);
    const provisions = await prisma.provision.findMany({
      where: { actId: act.id },
      select: {
        id: true, displayLabel: true, heading: true, isRepealed: true,
        articleNumber: true, articleLetter: true, fullText: true,
        chapter: { select: { title: true, ordering: true } },
        _count: { select: { caseLinks: true } },
      },
      orderBy: [{ articleNumber: "asc" }, { articleLetter: "asc" }],
      take: MAX_OUTLINE_ROWS,
    });
    if (provisions.length === 0) return `${citation} is in the act library but holds no articles.`;

    const path = actPath(act);
    const lines: string[] = [];
    let chapter: string | null = null;
    for (const p of provisions) {
      const hit: ProvisionHit = {
        id: p.id,
        actId: act.id,
        jurisdiction: act.jurisdiction,
        actNumber: act.actNumber,
        year: act.year,
        actTitle: act.title,
        actCitation: citation,
        displayLabel: p.displayLabel,
        heading: p.heading,
        anchor: "",
        snippet: p.fullText.slice(0, 300),
        caseCount: p._count.caseLinks,
        path,
      };
      this.seenProvisions.set(p.id, hit);

      const title = p.chapter?.title ?? null;
      if (title && title !== chapter) {
        chapter = title;
        lines.push(`\n  ${title}`);
      }
      lines.push(
        `provisionId=${p.id} | ${p.displayLabel}` +
          `${p.heading ? ` — ${p.heading}` : ""}` +
          `${p.isRepealed ? " [brottfallið]" : ""}` +
          `${p._count.caseLinks ? ` | cited by ${p._count.caseLinks} decisions` : ""}` +
          // The first words of the article: enough to tell 41. gr. from 43. gr.
          // without another call, and short enough that 57 of them are a page.
          ` | ${collapse(p.fullText).slice(0, 120)}`
      );
    }

    return [
      `actId=${act.id} | ${citation} — ${act.title}`,
      `Read at: ${path}`,
      `${provisions.length} articles${provisions.length === MAX_OUTLINE_ROWS ? " (truncated)" : ""}. Open the ones that matter with read_provision; nothing can be cited unread.`,
      ...lines,
    ].join("\n");
  }

  /** The act a name, number or phrase refers to. */
  private async findAct(query: string): Promise<ActRow | null> {
    const number = /(\d{1,4})\s*\/\s*(\d{4})/.exec(query);
    if (number) {
      const found = await prisma.act.findFirst({
        where: { actNumber: Number(number[1]), year: Number(number[2]) },
        select: ACT_SELECT,
      });
      if (found) return found;
    }

    const words = query
      .replace(/\b(?:lög|laga|lögum|um|nr\.?|act|the|of)\b/gi, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3);
    const candidates = await prisma.act.findMany({
      where: {
        OR: [
          { title: { contains: query, mode: "insensitive" } },
          { aliases: { hasSome: [query.toLowerCase()] } },
          ...words.map((w) => ({ title: { contains: w, mode: "insensitive" as const } })),
          ...words.map((w) => ({ aliases: { hasSome: [w.toLowerCase()] } })),
        ],
      },
      select: ACT_SELECT,
      take: 40,
    });
    if (candidates.length === 0) return null;

    // The same ranking the act lookup uses, so "starfsmannalög" resolves here
    // the way it resolves in the search box. A weak match is dropped by
    // rankActMatches; when everything is weak the first candidate is still a
    // better answer than "no act matched", and the outline says which act it
    // opened.
    const ranked = rankActMatches(
      query,
      candidates.map((c) => ({ ...c, citation: actCitation(c), aliases: c.aliases ?? [] }))
    );
    return ranked[0]?.act ?? candidates[0];
  }

  /**
   * The loop declaring itself finished — and the check on that claim.
   *
   * The loop used to end when the model stopped asking for tools, which makes
   * "I have enough" free and unexamined. Here it costs a call and has to pass:
   * did you read any law, did you open any decision, and — when the question
   * has two limbs — did you look at both?
   *
   * A refusal is not an error. It comes back as an ordinary tool result naming
   * what is missing, the model carries on researching, and the round ceiling
   * and the wall-clock budget still bound the whole thing. What is gathered
   * when a bound is hit is composed and answered from either way, so the gate
   * can only make a run more thorough, never make it fail.
   *
   * And a gap honestly declared passes. "There are no Landsréttur judgments on
   * this" is a finding; the loop says so in `gaps`, that reaches the answer as
   * a limitation, and the reader is told. What the gate refuses is silence.
   */
  private researchComplete(a: Record<string, unknown>): string {
    const gaps = strings(a.gaps);
    const blocked = this.finishBlocked(gaps);
    if (blocked) return `Not yet. ${blocked}\n\nKeep researching, then call research_complete again.`;

    this.finished = true;
    this.declaredGaps.push(...gaps);
    return "Recorded. Research is complete — now write your closing note and stop calling tools.";
  }

  /**
   * Why the loop may not finish yet, or null when it may.
   *
   * Every check is over what the session actually holds, never over what the
   * model says it did.
   */
  finishBlocked(gaps: string[] = []): string | null {
    if (this.calls.length - 1 < this.minCalls) {
      return `You have made ${this.calls.length - 1} tool calls. This question has not been researched at ${this.minCalls > 1 ? `fewer than ${this.minCalls}` : "that few"}.`;
    }
    if (this.provisions.size === 0) {
      return "You have not read a single provision. Find the governing law before the cases that apply it — search_provisions, or read_act_outline when the wording is not what the article uses.";
    }

    const wantsDecisions =
      this.plan.sourceCategories.length === 0 ||
      this.plan.sourceCategories.some((c) => c === "decisions" || c === "administrative");
    if (wantsDecisions && this.documents.size === 0) {
      return "You have not opened a single decision. A result list is a lead; only read_decision makes a case citable.";
    }

    if (asksBothSectors(this.plan.standalone)) {
      const declared = gaps.join(" ").toLowerCase();
      const sectors = new Set(
        Array.from(this.documents.values()).map((d) => sectorOf(d.caseName ?? d.title))
      );
      const publicSide = sectors.has("public") || /opinber|ríkis|public/.test(declared);
      const privateSide = sectors.has("private") || /almenn|einka|private/.test(declared);
      if (!publicSide || !privateSide) {
        const missing = !publicSide ? "opinbera vinnumarkaðnum" : "almennum vinnumarkaði";
        return `The question asks about both the general and the public labour market, and nothing you have read is clearly from ${missing}. Search that side specifically — the state and the municipalities are governed by different instruments from a private employer. If the corpus genuinely holds nothing there, say so in gaps and call this again.`;
      }
    }

    return null;
  }

  // -- reading --------------------------------------------------------------

  /**
   * Opens a decision, and makes it citable.
   *
   * The whole text is not returned. A section is, when one is asked for and the
   * document marks it off; otherwise the head, which is where a summary and the
   * facts are. The labelled parts the answer stage will see are extracted
   * separately by `composeRetrieval` from the stored text — this is for the
   * loop's own reading.
   */
  private async readDecision(a: Record<string, unknown>): Promise<string> {
    const id = str(a.documentId);
    if (!id) return "read_decision needs a documentId from a search result.";

    const doc = await prisma.document.findUnique({
      where: { id },
      select: {
        id: true, source: true, court: true, caseNumber: true, caseName: true,
        title: true, date: true, year: true, subjectTags: true, officialUrl: true,
        pdfUrl: true, fullText: true, isSample: true,
      },
    });
    if (!doc) return `No document with id ${id}.`;
    if (doc.isSample) return "That is seed data, not a real judgment. It cannot be cited.";

    if (isScholarship(doc.source)) {
      // A journal article's text is indexed for searching and never sent out —
      // here as everywhere else in this app.
      return `${doc.title} is a journal article. Its text is not served by this database; it is read at ${sourceByKey(doc.source)?.name ?? "the journal"} (${doc.officialUrl}). It may be cited as commentary, never as law.`;
    }

    const hit: SearchHit = this.seen.get(id) ?? {
      id: doc.id, source: doc.source, court: doc.court, caseNumber: doc.caseNumber,
      caseName: doc.caseName, title: doc.title,
      date: doc.date ? doc.date.toISOString() : null, year: doc.year,
      subjectTags: doc.subjectTags ?? [], officialUrl: doc.officialUrl,
      pdfUrl: doc.pdfUrl, snippet: "", summary: null, isSample: false, isFuzzy: false,
    };
    this.seen.set(id, hit);
    // Read means citable. See the header.
    this.documents.set(id, hit);

    const text = doc.fullText ?? "";
    const section = str(a.section).toLowerCase();
    const { extractReasoning, extractHolding, extractSummary } = await import("../judgment-text");

    const part =
      section === "reasoning" ? extractReasoning(text, MAX_READ_CHARS)
      : section === "holding" ? extractHolding(text, MAX_READ_CHARS)
      : section === "summary" ? extractSummary(text.slice(0, 12_000))
      : null;

    const body = part ?? text.slice(0, MAX_READ_CHARS);
    const note =
      part === null && section
        ? `\n(The "${section}" section is not marked off in this document; the head of it follows.)`
        : text.length > MAX_READ_CHARS && !part
          ? "\n(Truncated. Ask for section=\"reasoning\" or \"holding\" for the parts that decide it.)"
          : "";

    return [
      `documentId=${doc.id}`,
      `${doc.court}${doc.caseNumber ? ` ${doc.caseNumber}` : ""}${doc.date ? ` — ${doc.date.toISOString().slice(0, 10)}` : ""}`,
      doc.caseName ?? doc.title,
      doc.subjectTags?.length ? `Subjects: ${doc.subjectTags.join(", ")}` : "",
      note,
      "",
      body,
    ]
      .filter(Boolean)
      .join("\n");
  }

  private async readProvision(a: Record<string, unknown>): Promise<string> {
    const id = str(a.provisionId);
    if (!id) return "read_provision needs a provisionId from a search result.";

    const row = await prisma.provision.findUnique({
      where: { id },
      select: {
        id: true, fullText: true, displayLabel: true, heading: true,
        act: { select: { title: true } },
      },
    });
    if (!row) return `No provision with id ${id}.`;

    const hit = this.seenProvisions.get(id);
    if (hit) this.provisions.set(id, hit);

    return [
      `provisionId=${row.id}`,
      `${row.displayLabel}${row.heading ? ` — ${row.heading}` : ""}`,
      row.act?.title ?? "",
      "",
      row.fullText.slice(0, MAX_READ_CHARS),
      hit ? "" : "(Not from a search result, so it cannot be cited in the answer. Find it with search_provisions first.)",
    ]
      .filter(Boolean)
      .join("\n");
  }
}

// ---------------------------------------------------------------------------
// Sector: which side of the labour market a judgment comes from
// ---------------------------------------------------------------------------

/**
 * Public or private employer, read off the parties.
 *
 * Not a classification the corpus carries, and the lawyer's own heuristic: a
 * case against an ehf. or an hf. is the general labour market, a case against
 * íslenska ríkið, a ministry, a municipality or a named state institution is
 * the public one. Wrong sometimes — a state-owned hf. is a genuine edge, and
 * Hæstiréttur anonymises its parties so many cases are "A gegn B" and say
 * nothing at all.
 *
 * So this is a hint printed beside a result and a coverage check the loop has
 * to answer, never a fact stated in an answer. What settles the sector in the
 * answer is the law the judgment applies — 70/1996 and the stjórnsýslulög on
 * one side, a kjarasamningur and the contract on the other — which the loop
 * can only see by reading the judgment.
 */
export type Sector = "public" | "private" | "unknown";

/**
 * Stems, not whole words, so only the left edge is anchored — "ráðuneyt"
 * has to match "ráðuneytinu". And anchored with the Unicode lookaround rather
 * than `\b`, which does not fire next to á ð é í ó ú ý þ æ ö and would leave
 * this switched off for exactly the parties it is meant to catch. See
 * lib/word-boundary.ts.
 */
const PUBLIC_PARTY = new RegExp(
  `${BEFORE}(?:íslenska\\s+ríki|ríkissjó|ráðuneyt|sveitarfélag|Reykjavíkurborg|kaupstað|hreppur|hreppi|stofnun|sýslumað|embætti|Landspítal|háskól|framhaldsskól|Vinnumálastofnun|Tryggingastofnun)`,
  "iu"
);
/** The company forms, which are whole words and anchored at both ends. */
const PRIVATE_PARTY = wordAlternation(["ehf", "hf", "slf", "slhf", "sf", "ses", "Ltd", "A/S"]);

export function sectorOf(party: string | null | undefined): Sector {
  const text = party ?? "";
  if (!text.trim()) return "unknown";
  if (PUBLIC_PARTY.test(text)) return "public";
  if (PRIVATE_PARTY.test(text)) return "private";
  return "unknown";
}

/** The sector hint as it is printed on a result row. */
function sectorHint(d: { caseName: string | null; title: string }): string {
  const sector = sectorOf(d.caseName ?? d.title);
  if (sector === "unknown") return "";
  return sector === "public" ? " | likely: opinber vinnumarkaður" : " | likely: almennur vinnumarkaður";
}

/**
 * True when the question is asking about both sides of the labour market, or
 * about any other public/private distinction.
 *
 * Exported and tested because the completion gate turns on it: a question that
 * asks "á almennum vinnumarkaði? En opinberum?" and gets an answer about one
 * of them has not been answered, however good the half is.
 */
export function asksBothSectors(text: string): boolean {
  const lower = text.toLowerCase();
  const publicSide =
    /opinber|ríkisstarfsm|starfsmenn\s+ríkisins|sveitarfélag|stjórnsýslu|public\s+sector|civil\s+servant/.test(
      lower
    );
  const privateSide =
    /almenn(?:um|a|ur)\s+vinnumarka|einkageir|private\s+sector|general\s+labour\s+market/.test(lower);
  return publicSide && privateSide;
}

// ---------------------------------------------------------------------------
// Formatting and argument handling
// ---------------------------------------------------------------------------

function rows(hits: SearchHit[], total: number, empty: string): string {
  if (hits.length === 0) return empty;
  const lines = hits.map(
    (h) =>
      `documentId=${h.id} | ${h.court}${h.caseNumber ? ` ${h.caseNumber}` : ""}` +
      `${h.date ? ` — ${h.date.slice(0, 10)}` : ""} | ${h.caseName ?? h.title}` +
      `${h.subjectTags.length ? ` | tags: ${h.subjectTags.join(", ")}` : ""}`
  );
  const more = total > hits.length ? `\n(${total} matched; ${hits.length} shown.)` : "";
  return `${lines.join("\n")}${more}\n\nUse read_decision on the ones worth relying on — nothing can be cited unread.`;
}

/** One line of a passage: newlines and runs of spaces flattened. */
function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function strings(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean);
}

function clamp(v: unknown, fallback: number, min: number, max: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

// ---------------------------------------------------------------------------
// The definitions the model is shown
// ---------------------------------------------------------------------------

const TOOLS: AskToolDef[] = [
  {
    name: "search_decisions",
    description:
      "Search judgments, administrative rulings and opinions. Terms must be in the language of the material — Icelandic for Icelandic sources, English for the EFTA Court, the CJEU and ESA. Narrow with `sources` and `tags` where you can: a court plus a subject tag is far sharper than words alone.",
    schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search terms, in the corpus's language." },
        sources: {
          type: "array",
          items: { type: "string" },
          description: `Source keys to search. Omit for all. Valid: ${SOURCE_KEYS.join(", ")}.`,
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Subject tags a decision must carry, exactly as list_subject_tags spells them. Combined as AND.",
        },
        dateFrom: { type: "string", description: "ISO date; decisions on or after it." },
        dateTo: { type: "string", description: "ISO date; decisions on or before it." },
        limit: { type: "integer", description: `Rows to return, up to ${MAX_ROWS}.` },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "find_citing_cases",
    description:
      "Decisions whose text cites a case number — what a court did with an earlier ruling, and whether an EFTA Court advisory opinion has been applied by an Icelandic court since. Give the number exactly as it is written: \"E-5/21\", \"22/2023\".",
    schema: {
      type: "object",
      properties: {
        caseNumber: { type: "string", description: "The cited case's number, as written." },
        sources: {
          type: "array",
          items: { type: "string" },
          description: "Restrict to these source keys — e.g. haestirettur for the Supreme Court alone.",
        },
        limit: { type: "integer", description: `Rows to return, up to ${MAX_ROWS}.` },
      },
      required: ["caseNumber"],
      additionalProperties: false,
    },
  },
  {
    name: "search_provisions",
    description:
      "Search the articles of Icelandic acts and EU regulations and directives. This is the law itself; prefer it over a decision for what a rule requires.",
    schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search terms, in the language of the legislation." },
        actId: { type: "string", description: "Restrict to one act, by the id a previous result gave." },
        limit: { type: "integer", description: `Rows to return, up to ${MAX_ROWS}.` },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "read_decision",
    description:
      "Open a decision and read it. REQUIRED before it can be cited: a document you have only seen in a result list is not a source. Ask for section=\"reasoning\" or \"holding\" to get the parts that decide the case rather than the head of the document.",
    schema: {
      type: "object",
      properties: {
        documentId: { type: "string", description: "documentId from a search result." },
        section: {
          type: "string",
          enum: ["summary", "reasoning", "holding"],
          description: "Which part to read. Omit for the head of the document.",
        },
      },
      required: ["documentId"],
      additionalProperties: false,
    },
  },
  {
    name: "read_provision",
    description:
      "Read an article in full, exceptions and conditions included. REQUIRED before it can be cited.",
    schema: {
      type: "object",
      properties: {
        provisionId: { type: "string", description: "provisionId from search_provisions." },
      },
      required: ["provisionId"],
      additionalProperties: false,
    },
  },
  {
    name: "cases_citing_provision",
    description:
      "Every decision in the corpus that cites a given article, newest first, with the passage that cites it. This is the strongest tool here for \"how has this rule actually been applied\": it reads the citation graph rather than searching words, so it finds judgments that turn on the article without ever using the question's vocabulary. Get the provisionId from search_provisions or read_act_outline.",
    schema: {
      type: "object",
      properties: {
        provisionId: { type: "string", description: "provisionId of the article." },
        sources: {
          type: "array",
          items: { type: "string" },
          description: "Restrict to these source keys — e.g. haestirettur, landsrettur, heradsdomar.",
        },
        limit: { type: "integer", description: `Rows to return, up to ${MAX_ROWS}.` },
      },
      required: ["provisionId"],
      additionalProperties: false,
    },
  },
  {
    name: "read_act_outline",
    description:
      "An act's articles in order, with their headings, their opening words and how many decisions cite each. Use it when you know which act governs but not which article — the article that answers a question often does not contain the question's words, and reading down the headings finds it when searching cannot. Name the act by number (\"70/1996\"), by short name (\"starfsmannalög\") or by words from its title.",
    schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The act's number, short name or title." },
        actId: { type: "string", description: "actId, when a previous result gave one." },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "list_subject_tags",
    description:
      "The subject tags decisions carry, with how many carry each. Use this to find the term the corpus files a subject under before searching for it — \"Fæðingarorlof\" rather than a guess at the words a judgment might use.",
    schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Part of a tag. Omit for the commonest tags." },
        limit: { type: "integer", description: "Tags to return, up to 40." },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "research_complete",
    description:
      "Declare the research finished. You MUST call this before you stop, and you must not stop until it comes back accepted — it checks that you have read the governing law, opened the decisions you intend to rely on, and covered every limb the question actually has. If it refuses, it says what is missing; go and do that, then call it again. Where the corpus genuinely holds nothing on a limb, list that in `gaps` and it is accepted: a gap stated plainly is a useful result, and it reaches the reader as a limitation of the search.",
    schema: {
      type: "object",
      properties: {
        covered: {
          type: "array",
          items: { type: "string" },
          description: "Each limb of the question, and in one line what you found on it.",
        },
        gaps: {
          type: "array",
          items: { type: "string" },
          description: "What the corpus does not hold, stated plainly. Empty when there is none.",
        },
      },
      required: ["covered"],
      additionalProperties: false,
    },
  },
];
