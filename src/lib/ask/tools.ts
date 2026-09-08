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
import type { SearchHit } from "../types";
import type { AskToolDef } from "./llm";
import type { QueryPlan } from "./types";

/** Every live source, as the loop may name them. */
const SOURCE_KEYS = SOURCES.map((s) => s.key);

/** Rows any one call may return. Enough to choose from, not enough to drown in. */
const MAX_ROWS = 25;
/** Characters of a document a single read may return. */
const MAX_READ_CHARS = 30_000;

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

  constructor(
    private readonly plan: QueryPlan,
    private readonly scope: "eea" | "eu" = "eea"
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
        case "list_subject_tags":
          return await this.listTags(args);
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
];
