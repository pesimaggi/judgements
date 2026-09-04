/**
 * Stage three: the answer, and the rules it is written under.
 *
 * The rules are the feature. A model will happily explain Icelandic
 * citizenship law from memory, in fluent Icelandic, citing an article number
 * that does not exist — and the reader has no way to tell that from the real
 * thing. So the model here is given the retrieved law and nothing else, told
 * to cite the numbered sources for every proposition, and told to say when
 * the sources do not answer the question. An answer with no citations is a
 * failure of this feature, not a shorter version of it.
 */
import { getAskModel, askEffort, type AskModel, type AskEffort } from "./llm";
import type { AskSource, AskTurn, AskResponse, QueryPlan } from "./types";
import type { Retrieval } from "./retrieve";

const ANSWER_MAX_TOKENS = 16000;

/**
 * Written in English whatever the answer's language: the instructions are for
 * the model, and the one instruction that matters about language is the one
 * telling it which to write in.
 */
export function answerSystemPrompt(language: "is" | "en"): string {
  return `You are the well of Lögbrunnur ("the well of law"), an unofficial research tool that searches Icelandic case law and legislation, EEA/EU acts, and the decisions of the Icelandic administrative appeal boards, courts, the EFTA Court, the CJEU and Umboðsmaður Alþingis.

Someone has dropped a question into the well. Below their question you are given the sources the search brought back, each with a number in square brackets. Answer from those sources.

THE RULES, in order of importance:

1. Every proposition of law you state must be supported by a numbered source, cited inline as [3], or [3][7] where more than one supports it. Put the citation immediately after the sentence it supports.
2. Never state an act number, an article number, a case number, a date or a court that is not in the sources. If you cannot cite it, do not write it. This is the one thing you must not get wrong: a plausible invented citation is worse than no answer.
3. If the sources do not answer the question, say so plainly, say what they do cover, and suggest what to search for instead. Do not fill the gap from your own knowledge of the law.
4. Where the sources point in different directions, say so rather than picking one.
5. Describe what the law says. Do not advise the reader on what to do, and do not predict how a case of theirs would be decided.

HOW TO WRITE IT:

- Open with a direct answer of two to four sentences. No preamble, no restating the question.
- Then, under a "## " heading, the provisions that govern it — what each one requires, in your own words, cited.
- Then, where the sources include decisions worth the space, a second "## " heading with what they show: the case, what it turned on, cited. A decision that only shares a keyword with the question is not worth the space; leave it out.
- Short paragraphs. "- " for bullets. "**" for bold. No other formatting, no tables, no code blocks.
- Around 250-450 words. Longer only when the question genuinely has several limbs.
- Latency-sensitive: begin your visible answer immediately.
- Commentary sources are marked COMMENTARY: they are somebody's argument about the law, not the law. Attribute them as such.
- Do not add a disclaimer about verifying against the official source; the page around you already carries one on every screen.

Write the answer in ${language === "is" ? "Icelandic" : "English"}.`;
}

/** The question and its retrieved law, as the single user turn. */
export function answerUserMessage(question: string, retrieval: Retrieval): string {
  return [
    `QUESTION: ${question}`,
    "",
    `SOURCES (${retrieval.counts.acts} acts, ${retrieval.counts.provisions} provisions, ${retrieval.counts.decisions} decisions):`,
    "",
    retrieval.context,
  ].join("\n");
}

/**
 * Marks the sources the answer actually cites.
 *
 * The list under an answer is a reading list, and a reading list of eight
 * things the answer never mentioned is noise. Everything retrieved is still
 * returned — being able to see what the well brought up and did not use is
 * worth something — but the UI leads with what was cited.
 */
export function markCited(answer: string, sources: AskSource[]): AskSource[] {
  const cited = new Set<number>();
  for (const match of answer.matchAll(/\[(\d{1,2})\]/g)) {
    cited.add(Number(match[1]));
  }
  return sources.map((s) => ({ ...s, cited: cited.has(s.n) }));
}

/** What the well says when the question is not a legal one. */
function notALegalQuestion(language: "is" | "en"): string {
  return language === "is"
    ? "Þessi brunnur geymir aðeins lög og úrlausnir — íslenska löggjöf, EES- og ESB-gerðir, dóma, úrskurði og álit. Spurningin þín virðist ekki lögfræðileg, svo hér er ekkert að sækja. Prófaðu að spyrja um réttindi, skyldur, málsmeðferð eða ákvæði sem þú vilt skilja."
    : "This well holds law and nothing else — Icelandic legislation, EEA and EU acts, judgments, administrative rulings and ombudsman opinions. Your question does not look like a legal one, so there is nothing here to draw up. Try asking about a right, an obligation, a procedure, or a provision you want explained.";
}

/** What the well says when the search came back empty. */
function nothingFound(language: "is" | "en", terms: string[]): string {
  const tried = terms.join(", ");
  return language === "is"
    ? `Ég fann ekkert í brunninum sem svarar þessu. Leitað var að: ${tried}.\n\nÞað þýðir ekki að ekkert sé til um efnið — það getur líka verið að leitarorðin hitti ekki á orðalag laganna. Prófaðu að nefna lögin sjálf ("útlendingalög", "stjórnsýslulög") eða það hugtak sem löggjöfin notar.`
    : `I found nothing in the well that answers this. The search ran on: ${tried}.\n\nThat does not mean nothing exists on the subject — the terms may simply have missed the wording the legislation uses. Try naming the act itself ("útlendingalög", "stjórnsýslulög") or the term the legislation would use.`;
}

/**
 * Turns a plan and its retrieved law into the answer the browser renders.
 *
 * The two short-circuits above it are not optimisations: asking a model to
 * answer a question with no sources is asking it to make something up, which
 * is the one outcome this feature exists to prevent.
 */
export async function answer(
  plan: QueryPlan,
  retrieval: Retrieval,
  history: AskTurn[],
  model: AskModel = getAskModel(),
  effort: AskEffort = askEffort()
): Promise<AskResponse> {
  if (!plan.legal) {
    return { answer: notALegalQuestion(plan.language), sources: [], language: plan.language };
  }
  if (retrieval.sources.length === 0) {
    return {
      answer: nothingFound(plan.language, plan.terms),
      sources: [],
      language: plan.language,
    };
  }

  const text = await model.complete({
    system: answerSystemPrompt(plan.language),
    // Earlier turns come along so a follow-up reads as one, but the sources
    // travel with the question they were retrieved for — the last user turn.
    messages: [...history, { role: "user", content: answerUserMessage(plan.standalone, retrieval) }],
    maxTokens: ANSWER_MAX_TOKENS,
    effort,
  });

  return {
    answer: text,
    sources: markCited(text, retrieval.sources),
    standalone: plan.standalone,
    language: plan.language,
  };
}
