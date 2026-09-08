/**
 * Deep research: the well goes and looks, instead of guessing once.
 *
 * WHAT THIS REPLACES, AND WHY
 *
 * lib/ask/retrieve.ts turns the plan into one fan of searches, fuses them and
 * answers. It can only find what the first guess at the corpus's vocabulary
 * reaches, and it cannot act on what it learns: asked what EFTA Court case
 * E-5/21 decided and whether Hæstiréttur had ruled since, the well returned
 * the right EFTA case, could not answer the second half, and wrote down the
 * two searches it would need to run — having no way to run them. A human
 * answered it in seconds with one search of one court and one subject tag.
 *
 * So this path gives the model the search itself. It reads a judgment and
 * follows what the judgment says; it asks which decisions cite a case number;
 * it looks up the tag the corpus files a subject under rather than guessing at
 * the words. See lib/ask/tools.ts for the tools and why each one is there.
 *
 * WHAT DOES NOT CHANGE, DELIBERATELY
 *
 * It returns a `Retrieval` — the same shape lib/ask/retrieve.ts returns — so
 * everything downstream is untouched: the answer prompt, the numbering, the
 * citation validation, the optional verifier, the streaming. That is the whole
 * design. The loop decides *what law the answer rests on*; it never writes the
 * answer, never numbers a source, and never gets to say that something is
 * supported. `composeRetrieval` numbers what it gathered, and
 * lib/ask/citations.ts checks the result exactly as before.
 *
 * The model also cannot cite what it has not read: only documents opened with
 * `read_decision` or `read_provision` become sources. A result list is a lead,
 * not evidence.
 *
 * BOUNDED, BECAUSE A LOOP IS A BILL
 *
 * Rounds are capped (`ASK_RESEARCH_MAX_ROUNDS`, default 12) and the whole
 * stage sits inside a wall-clock timeout (`ASK_TIMEOUT_RESEARCH_MS`, default
 * four minutes). Hitting either is not a failure: whatever was gathered by
 * then is composed and answered from, because a good answer from nine sources
 * beats an error.
 */
import { getAskModel, type AskModel, type ToolStep } from "./llm";
import { askConfig, type AskConfig } from "./config";
import { rankCandidates, type RankCandidate } from "./rank";
import { stripMarks } from "./evidence";
import { ResearchSession } from "./tools";
import {
  composeRetrieval,
  decisionKind,
  retrieve,
  select,
  type CandidatePayload,
  type Retrieval,
  type RetrieveOptions,
} from "./retrieve";
import type { QueryPlan } from "./types";

const RESEARCH_SYSTEM = `You are the research stage of Lögbrunnur, a legal research tool over Icelandic, EEA and EU law. You do not write the answer. Your job is to find the law the answer will rest on, and to be thorough about it.

The corpus: Icelandic acts (Lagasafn) and EU acts (EUR-Lex); judgments of Hæstiréttur, Landsréttur and the héraðsdómar; Endurupptökudómur and Félagsdómur; the EFTA Court, the CJEU and its General Court; Umboðsmaður Alþingis; the EFTA Surveillance Authority; some forty Icelandic administrative appeal boards; and two legal journals. Icelandic material is written in Icelandic; the EFTA Court, the CJEU and ESA write in English. Search each in its own language.

HOW TO WORK

1. Find the governing law first — the article, not a case about the article.
2. Then find how it has been applied. Read the decisions that matter.
3. Follow what you find. A judgment that names an earlier case, an article, or an advisory opinion is telling you what to look for next. Go and look.
4. When a question asks what happened after a decision — whether it was applied, followed or overturned — use find_citing_cases on its case number. This is the tool for "and then what".
5. When words are not finding it, use list_subject_tags: the corpus files subjects under tags, and a court plus a tag is far sharper than a guess at wording.
6. If a search comes back empty, that is information. Change the wording, the language, or the source, and try again. Do not conclude from one empty search that nothing exists.

THE ONE HARD RULE

**Nothing you have not opened can be cited.** A result list gives you leads. Only read_decision and read_provision make something available to the answer. So read everything you intend the answer to rely on — including the decision that settles the question, not merely the one that raises it.

WHEN TO STOP

Stop when you have the governing provisions and the decisions that apply them, and when you have checked the specific things the question asks about. Do not pad: an unread case is worth nothing and a read but irrelevant one costs the reader attention. If the corpus genuinely does not hold something, stop and say so in one line — being clear about a gap is a useful result.

You may call several tools at once, and should whenever the calls do not depend on each other.

Finish with two or three sentences on what you found and what you could not. You are not writing the answer.`;

export interface ResearchOptions extends RetrieveOptions {
  /** Reported per tool call, for the metrics line and for the reader. */
  onStep?: (step: ToolStep) => void;
}

export interface ResearchOutcome {
  retrieval: Retrieval;
  /** Calls made. Zero means the loop declined to search at all. */
  steps: number;
  rounds: number;
  /** True when the round ceiling stopped it rather than the model finishing. */
  exhausted: boolean;
  /** True when it found nothing and the ordinary retrieval was used instead. */
  fellBack: boolean;
  /** The loop's own closing note, for the metrics line. Never shown as an answer. */
  note: string;
}

/**
 * The brief the loop is given: the question as the planner restated it, plus
 * what the planner already worked out about it.
 *
 * The plan is not wasted here. It has already translated the question into the
 * corpus's vocabulary, which is the single hardest step, and handing that over
 * saves the loop from rediscovering it one empty search at a time.
 */
export function researchBrief(plan: QueryPlan): string {
  const lines = [`QUESTION: ${plan.standalone}`, ""];
  if (plan.concepts.length) lines.push(`Concepts the planner suggests: ${plan.concepts.join(", ")}`);
  if (plan.actQueries.length) lines.push(`Acts it thinks are in play: ${plan.actQueries.join("; ")}`);
  if (plan.provisionQueries.length) lines.push(`Provisions named: ${plan.provisionQueries.join("; ")}`);
  if (plan.decisionQueries.length) {
    lines.push(
      `Decisions named in the question: ${plan.decisionQueries.join("; ")} — find these, read them, and check with find_citing_cases whether they have been applied since.`
    );
  }
  if (plan.phrases.length) lines.push(`Phrases to match exactly: ${plan.phrases.join("; ")}`);
  if (plan.historical) {
    lines.push(
      "This question turns on the law as it stood at an earlier time. The act library holds only current consolidated text, so look for decisions quoting the older wording."
    );
  }
  lines.push("", `Answer language: ${plan.language === "is" ? "Icelandic" : "English"}.`);
  return lines.join("\n");
}

export async function deepResearch(
  plan: QueryPlan,
  config: AskConfig = askConfig(),
  options: ResearchOptions = {}
): Promise<ResearchOutcome> {
  const model: AskModel = options.model ?? getAskModel();
  const scope = options.scope ?? "eea";

  if (!model.runTools) {
    throw new Error(
      "Deep research needs a model that supports tool use; this one does not implement runTools()."
    );
  }

  const session = new ResearchSession(plan, scope);
  let note = "";
  let rounds = 0;
  let exhausted = false;

  try {
    const result = await model.runTools({
      system: RESEARCH_SYSTEM,
      messages: [{ role: "user", content: researchBrief(plan) }],
      tools: session.tools(),
      maxTokens: config.researchMaxTokens,
      effort: config.researchEffort,
      maxRounds: config.researchMaxRounds,
      execute: (name, input) => session.run(name, input),
      onStep: options.onStep,
    });
    note = result.text;
    rounds = result.rounds;
    exhausted = result.exhausted;
  } catch (e) {
    // Whatever it gathered before it failed is still worth answering from; the
    // fallback below catches the case where that is nothing.
    console.error("Ask: the research loop failed, using what it had gathered:", e);
  }

  const candidates = buildCandidates(session);

  if (candidates.length === 0) {
    // It read nothing — the model declined to search, the loop failed on its
    // first call, or the corpus really is empty on this. Falling back to the
    // ordinary retrieval is strictly better than abstaining: it is what the
    // quick path would have returned.
    console.warn("Ask: research found nothing to cite; falling back to standard retrieval.");
    return {
      retrieval: await retrieve(plan, config, options),
      steps: session.calls.length,
      rounds,
      exhausted,
      fellBack: true,
      note,
    };
  }

  const chosen = select(rankCandidates(candidates, plan), plan, config);
  return {
    retrieval: await composeRetrieval(chosen, plan, config, candidates.length),
    steps: session.calls.length,
    rounds,
    exhausted,
    fellBack: false,
    note,
  };
}

/**
 * What the loop read, as candidates the existing ranker understands.
 *
 * `relevance` is 1 for everything: the loop chose to open these, one at a
 * time, having seen what else was on offer — which is a stronger signal than
 * any score fusion could produce, and there is no fused score here to use
 * anyway. What ranking still decides is the *order*: legislation before a
 * decision about it, a supreme court before a first-instance one, commentary
 * last. See lib/ask/rank.ts.
 */
function buildCandidates(
  session: ResearchSession
): (RankCandidate & { payload: CandidatePayload })[] {
  const candidates: (RankCandidate & { payload: CandidatePayload })[] = [];

  for (const hit of session.provisions.values()) {
    candidates.push({
      key: `provision:${hit.id}`,
      kind: "provision",
      actId: hit.actId,
      jurisdiction: hit.jurisdiction,
      text: `${hit.displayLabel} ${hit.actCitation} ${hit.actTitle} ${hit.heading ?? ""} ${stripMarks(hit.snippet)}`,
      relevance: 1,
      matchedBy: ["research:read"],
      bestRank: 1,
      payload: { type: "provision", hit },
    });
  }

  for (const hit of session.documents.values()) {
    candidates.push({
      key: `decision:${hit.id}`,
      kind: decisionKind(hit.source),
      sourceKey: hit.source,
      court: hit.court,
      date: hit.date,
      jurisdiction: "is",
      text: `${hit.caseName ?? hit.title} ${hit.summary ?? ""} ${stripMarks(hit.snippet)}`,
      relevance: 1,
      matchedBy: ["research:read"],
      bestRank: 1,
      payload: { type: "decision", hit },
    });
  }

  return candidates;
}
