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
import { ResearchSession, asksBothSectors } from "./tools";
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

const RESEARCH_SYSTEM = `You are the research stage of Lögbrunnur, a legal research tool over Icelandic, EEA and EU law. You do not write the answer. Your job is to find the law the answer will rest on, and to be exhaustive about it.

The corpus: Icelandic acts (Lagasafn) and Icelandic regulations (reglugerðir), EU acts (EUR-Lex); judgments of Hæstiréttur, Landsréttur and the héraðsdómar; Endurupptökudómur and Félagsdómur; the EFTA Court, the CJEU and its General Court; Umboðsmaður Alþingis; the EFTA Surveillance Authority; some forty Icelandic administrative appeal boards; Alþingi's bills and their greinargerðir; and two legal journals. Icelandic material is written in Icelandic; the EFTA Court, the CJEU and ESA write in English. Search each in its own language.

It does NOT hold kjarasamningar. Collective agreements decide a great deal of Icelandic employment law and none of them is here. Where a question turns on one, find the judgments that quote its terms and say plainly that the agreement itself is not in the corpus.

HOW AN ICELANDIC LAWYER WORKS THIS, AND HOW YOU WILL

**1. The law first, and the whole of it.** Find the governing articles before you look at a single case. Do not stop at one act: a question about employment reaches the specific act, the general one, and often a third nobody names in the question. Read the articles in full with read_provision — a rule is its exceptions.

When you know the act but not the article, use read_act_outline. This matters more than it sounds. The article that answers a question frequently does not contain the question's words: the rule that a fixed-term appointment in the state service may be made terminable is in 41. gr. laga nr. 70/1996, and that article never uses the phrase anyone would search for. Reading down 57 headings finds it; searching may not.

**2. Then how the courts have applied it — through the article, not around it.** Once you hold the governing provision, call cases_citing_provision on it. This is the strongest tool you have. It reads the citation graph rather than matching words, so it returns the judgments that actually turn on the article whatever vocabulary they happen to use, and it tells you which passage cites it.

**3. All three levels of court, in order of weight.** Hæstiréttur sets the precedent and is what you look for first. Landsréttur is the court of appeal and its judgments are real authority. Héraðsdómur binds nobody but is often the only thing written on a narrow point, and a district judgment squarely on the question beats a supreme court judgment that is merely nearby. Search all three (sources: haestirettur, landsrettur, heradsdomar). Do not report that there is no case law when you have searched one of them.

**4. Both sides of any divide the question has.** The commonest is almennur vinnumarkaður against the opinberi vinnumarkaður, and they are governed by different instruments: the state by lög nr. 70/1996 and the stjórnsýslulög, municipalities by their own agreements and the stjórnsýslulög, a private employer by the contract and a kjarasamningur. A question that asks about both and gets one has not been answered. The same applies to any other split a question carries — two periods, two kinds of party, two procedures.

You can often tell which side a judgment is from by its parties: an ehf. or an hf. is the general market; íslenska ríkið, a ministry, a municipality or a named state institution is the public one. That is a hint for choosing what to read, never a fact for the answer — Hæstiréttur anonymises its parties, so many cases say nothing either way. What settles it is which instruments the judgment applies, and you only see that by reading it.

**5. Follow what you find.** A judgment that names an earlier case, an article or an advisory opinion is telling you where to look next. Go there. Use find_citing_cases on a case number to learn what happened to a ruling afterwards — whether it was applied, followed or departed from.

**6. When words are not finding it, stop using words.** list_subject_tags gives the term the corpus files a subject under; a court plus a tag is far sharper than a guess at wording. read_act_outline navigates. cases_citing_provision follows the graph. An empty search is information, not a conclusion: change the wording, the language or the source and try again.

SAYING WHAT YOU ARE DOING

Every tool but research_complete takes a \`why\`, and it is not bookkeeping: it is shown to the reader, in the panel, as you work. They watch the research happen and \`why\` is what makes it legible as legal method rather than a list of queries going past.

Write it in Icelandic, in one sentence, as the step of the method you are on — what you are trying to establish and why it is the next thing to do. "Ég þarf að sjá hvernig dómstólar hafa beitt 42. gr. áður en ég met riftunarheimildina" is worth showing. "Leita að riftun" is not: it repeats the query and tells the reader nothing they could not see.

Do not describe the tool. Describe the reasoning. And do not write it after the fact to look thorough — it is your actual reason for this call, and the reader will hold it against what the call comes back with.

THE ONE HARD RULE

**Nothing you have not opened can be cited.** A result list gives you leads. Only read_decision and read_provision make something available to the answer. So read everything you intend the answer to rely on — including the decision that settles the question, not merely the one that raises it. Read the reasoning (section="reasoning") and the operative part (section="holding") of any case you mean to state a holding from: the head of a judgment is the parties and the claims, not what the court decided.

Twenty sources that were read beat fifty that were listed. Err towards reading one more.

HOW TO FINISH

You MUST call research_complete before you stop, and you must not stop until it comes back accepted. It checks your work against what this session actually holds: law read, decisions opened, every limb covered. If it refuses it will say what is missing — go and do that, then call it again.

Where the corpus genuinely holds nothing on a limb, list it in \`gaps\` and research_complete will accept it. A gap stated plainly reaches the reader as a limitation of the search, which is a useful result. What is not acceptable is finishing quietly with a limb unsearched.

You may call several tools at once, and should whenever the calls do not depend on each other. Reading six judgments is one round, not six.

When research_complete is accepted, write two or three sentences on what you found and what you could not, and stop. You are not writing the answer.`;

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
  /** True when research_complete was called and accepted. */
  finished: boolean;
  /** What the loop said the corpus does not hold. Carried into the answer. */
  gaps: string[];
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
  if (asksBothSectors(plan.standalone)) {
    lines.push(
      "",
      "This question covers BOTH the general labour market and the public sector. They are governed by different instruments and you must research them as two separate limbs: research_complete will refuse a run that has only done one of them."
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

  const session = new ResearchSession(plan, scope, config.researchMinCalls);
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
      // The gate, made binding. A model that stops without calling
      // research_complete is sent the same objection the tool would have
      // given it and carries on; `maxRounds` still ends the loop either way.
      onStop: () => {
        if (session.finished) return null;
        const blocked = session.finishBlocked();
        return blocked
          ? `You have not called research_complete, and you are not finished. ${blocked}`
          : "You have not called research_complete. Call it now with what each limb of the question turned up.";
      },
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
      finished: session.finished,
      gaps: [...session.declaredGaps],
    };
  }

  const chosen = select(rankCandidates(candidates, plan), plan, config);
  const retrieval = await composeRetrieval(chosen, plan, config, candidates.length);
  // A gap the loop found is a fact about the corpus, and it belongs in the same
  // channel as the ones retrieval discovers for itself — stated in the answer,
  // not left for the reader to infer from an absence.
  if (session.declaredGaps.length) {
    retrieval.limitations.push(...session.declaredGaps.map(gapLimitation(plan.language)));
  }
  return {
    retrieval,
    steps: session.calls.length,
    rounds,
    exhausted,
    fellBack: false,
    note,
    finished: session.finished,
    gaps: [...session.declaredGaps],
  };
}

/**
 * A gap the loop declared, phrased as the limitation the answer must state.
 *
 * Kept short and factual. The answer stage is told to state its limitations
 * where they bear on the question, and a sentence that reads like an apology
 * gets restated as one.
 */
function gapLimitation(language: "is" | "en"): (gap: string) => string {
  return (gap) =>
    language === "is"
      ? `Leitin fann ekkert um eftirfarandi og svarið verður að taka það fram: ${gap}`
      : `The search found nothing on the following, and the answer must say so: ${gap}`;
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
