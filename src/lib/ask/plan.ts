/**
 * Stage one: turning a question into something the search engine can answer.
 *
 * This exists because the question and the corpus are rarely in the same
 * language, and never in the same register. "How do I apply for Icelandic
 * citizenship?" shares not one indexed token with lög nr. 100/1952; a
 * full-text search for it returns nothing, and an answer built on nothing is
 * the failure mode this whole feature has to avoid. So the model is asked
 * first for the words the *corpus* would use — `ríkisborgararéttur`,
 * `veiting ríkisborgararéttar`, `útlendingalög` — and the search runs on
 * those.
 *
 * The plan is now a plan for *several* searches. One OR query built from every
 * term the model produced is the worst of both worlds: a case number the user
 * typed exactly competes on rank with five synonyms, and a phrase that has to
 * match as a phrase is diluted by the single words around it. So the plan
 * separates what is searched differently — acts, provisions, concepts,
 * phrases, decisions — and `retrieve.ts` runs each as its own focused search
 * and fuses the rankings. See lib/ask/fusion.ts.
 *
 * The planner is also where a follow-up question is made whole: "and what
 * does it cost?" is unanswerable on its own and perfectly answerable once the
 * earlier turns are folded into it.
 */
import { getAskModel, type AskModel } from "./llm";
import { askConfig, type AskConfig } from "./config";
import { HISTORICAL, CROSS_JURISDICTION } from "./complexity";
import { BEFORE, AFTER } from "../word-boundary";
import {
  ASK_SOURCE_CATEGORIES,
  type AskSourceCategory,
  type AskTurn,
  type QueryPlan,
} from "./types";

const PLAN_SYSTEM = `You prepare search queries for Lögbrunnur, a search engine over Icelandic law.

Its corpus is: Icelandic acts (lög) from Lagasafn, EU acts from EUR-Lex, and decisions of the Icelandic courts, the EFTA Court, the CJEU, Umboðsmaður Alþingis and the Icelandic administrative appeal boards. Icelandic material is indexed in Icelandic; EU material in English.

The corpus holds the CURRENT consolidated text of legislation. It does not hold repealed acts or earlier versions of an act.

Given a question, produce the queries that will actually match that corpus. Each field is searched separately and differently, so put each thing where it belongs rather than repeating it everywhere.

Rules:
- Search terms must be in the language of the material, which for a question about Icelandic law means Icelandic — even when the question is in English. Translate the concept, do not transliterate the question.
- Prefer the terms the legislation itself uses over everyday wording: "ríkisborgararéttur", not "verða Íslendingur".
- "concepts": 2-5 legal concepts, most specific first. These are alternative names for the subject.
- "phrases": 0-3 phrases that must match as phrases — a term of art, or something the user put in quotes. Leave empty when there is no such phrase; a phrase that is merely two common words narrows the search to nothing.
- "actQueries": 0-3 acts the question is likely governed by, as they would be cited ("lög um íslenskan ríkisborgararétt", "útlendingalög", "stjórnsýslulög"). Never invent a number for an act you are not sure of — a name alone is looked up correctly, a wrong number is not.
- "provisionQueries": 0-3 specific provisions, only where the question names or plainly implies one ("5. gr. laga nr. 100/1952", "Article 6 GDPR").
- "decisionQueries": 0-3 case numbers or case names the question names. Copy them exactly as written. Never invent one.
- "sourceCategories": which families of material this question calls for, from: legislation, decisions, administrative, eu, commentary.
- "date": a date or year the USER supplied, as written, or null. Never supply one they did not.
- "historical": true only when answering properly needs the law as it stood at some past time rather than as it stands now.
- "language" is the language the ANSWER must be written in: the language the user asked in.
- "legal" is false only when the question has nothing to do with law or the legal system.
- "standalone" restates the question so it can be read on its own, resolving anything carried over from earlier turns. Keep the user's own language.`;

const PLAN_SCHEMA = {
  type: "object",
  properties: {
    concepts: {
      type: "array",
      items: { type: "string" },
      description: "2-5 legal concepts in the language of the material.",
    },
    phrases: {
      type: "array",
      items: { type: "string" },
      description: "0-3 phrases that must match as phrases.",
    },
    actQueries: {
      type: "array",
      items: { type: "string" },
      description: "0-3 acts the question is likely governed by, as they are cited.",
    },
    provisionQueries: {
      type: "array",
      items: { type: "string" },
      description: "0-3 specific provisions the question names or implies.",
    },
    decisionQueries: {
      type: "array",
      items: { type: "string" },
      description: "0-3 case numbers or case names the question names, copied exactly.",
    },
    sourceCategories: {
      type: "array",
      items: {
        type: "string",
        enum: ASK_SOURCE_CATEGORIES as unknown as string[],
      },
      description: "Which families of material the question calls for.",
    },
    date: {
      type: ["string", "null"],
      description: "A date or year the user supplied, or null.",
    },
    historical: {
      type: "boolean",
      description: "True when the question needs the law as it stood in the past.",
    },
    language: {
      type: "string",
      enum: ["is", "en"],
      description: "The language the answer must be written in.",
    },
    legal: {
      type: "boolean",
      description: "False when the question has nothing to do with law.",
    },
    standalone: {
      type: "string",
      description: "The question restated so it stands on its own.",
    },
  },
  required: [
    "concepts",
    "phrases",
    "actQueries",
    "provisionQueries",
    "decisionQueries",
    "sourceCategories",
    "date",
    "historical",
    "language",
    "legal",
    "standalone",
  ],
  additionalProperties: false,
} as const;

/**
 * Case numbers as the courts and boards write them. The boundaries are
 * Unicode-aware: an Icelandic prefix letter is not an ASCII word character, so
 * `\b` would refuse to fire before "Þ-12/2020". See lib/word-boundary.ts.
 */
const CASE_NUMBER_RE = new RegExp(
  `${BEFORE}([A-Za-zÞÆÖÁÐÉÍÓÚÝþæöáðéíóúý]{1,3}-?\\d{1,5}\\/\\d{2,4}|\\d{1,6}\\/\\d{4})${AFTER}`,
  "gu"
);

/** Anything the user put in quotes is a phrase they meant literally. */
const QUOTED_RE = /[“"„«]([^“”"„«»]{3,80})[”"“»]/g;

function strings(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter((v): v is string => typeof v === "string")
        .map((v) => v.trim())
        .filter((v) => v.length > 1)
    )
  ).slice(0, max);
}

function categories(value: unknown): AskSourceCategory[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value.filter((v): v is AskSourceCategory =>
        ASK_SOURCE_CATEGORIES.includes(v as AskSourceCategory)
      )
    )
  );
}

/**
 * Narrows the model's arguments to a plan, and drops anything unusable rather
 * than letting it through to the search: an empty term is a query for
 * everything, and forty terms is a query for nothing in particular.
 *
 * Accepts both shapes of plan. The older one had a single `terms` array, and
 * a model told to produce that — or a recorded fixture, or a test — still
 * produces a usable plan here: `terms` becomes the concepts.
 */
export function parsePlan(input: unknown, question: string): QueryPlan | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;

  const legacyTerms = strings(raw.terms, 6);
  const concepts = strings(raw.concepts, 5);
  const phrases = strings(raw.phrases, 3);
  const provisionQueries = strings(raw.provisionQueries, 3);
  const decisionQueries = strings(raw.decisionQueries, 3);

  const effectiveConcepts = concepts.length ? concepts : legacyTerms;
  // A plan with no concepts and no phrases has nothing to search on at all —
  // an act name alone is a lookup, not a search — so it is rejected and the
  // caller falls back to keywords.
  if (effectiveConcepts.length === 0 && phrases.length === 0) return null;

  const standalone = typeof raw.standalone === "string" ? raw.standalone.trim() : "";
  const date = typeof raw.date === "string" && raw.date.trim() ? raw.date.trim().slice(0, 40) : null;

  return {
    terms: legacyTerms.length ? legacyTerms : [...effectiveConcepts, ...phrases].slice(0, 6),
    concepts: effectiveConcepts,
    phrases,
    actQueries: strings(raw.actQueries, 3),
    provisionQueries,
    decisionQueries,
    sourceCategories: categories(raw.sourceCategories),
    date,
    // The model's own reading, or the question's own words. Either is enough:
    // the consequence is a sentence in the answer, not a different search.
    historical: raw.historical === true || HISTORICAL.test(standalone || question),
    language: raw.language === "en" ? "en" : "is",
    legal: raw.legal !== false,
    standalone: standalone || question,
  };
}

/**
 * The plan to fall back on when the model cannot be reached.
 *
 * It cannot translate, so an English question about Icelandic law will search
 * badly — but a bad search still finds the act when the question names one,
 * and it is a great deal better than refusing to answer because one of two
 * model calls failed. The language guess is by alphabet: the Icelandic
 * letters are not in English text.
 *
 * It fills the structured fields too, from what can be read off the question
 * without understanding it: a case number is a case number, a quoted string is
 * a phrase, and the words that say "as the law stood then" say it in both
 * languages.
 */
export function heuristicPlan(question: string, history: AskTurn[] = []): QueryPlan {
  const icelandic = /[áðéíóúýþæö]/i.test(question);
  const words = question
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s/-]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOPWORDS.has(w));

  // Longest first: in both languages the long words in a question are the
  // ones carrying its subject, and the short ones are grammar.
  const terms = Array.from(new Set(words))
    .sort((a, b) => b.length - a.length)
    .slice(0, 5);

  // A follow-up with nothing of its own to search on borrows from the question
  // before it, which is the turn it is a follow-up to.
  if (terms.length === 0) {
    const previous = [...history].reverse().find((t) => t.role === "user");
    if (previous) return heuristicPlan(previous.content);
  }

  const phrases = Array.from(question.matchAll(QUOTED_RE), (m) => m[1].trim()).slice(0, 3);
  const decisions = Array.from(new Set(question.match(CASE_NUMBER_RE) ?? [])).slice(0, 3);
  const concepts = terms.length ? terms : [question.trim()];

  const sourceCategories: AskSourceCategory[] = ["legislation", "decisions"];
  if (CROSS_JURISDICTION.test(question)) sourceCategories.push("eu");

  return {
    terms: concepts,
    concepts,
    phrases,
    actQueries: [],
    provisionQueries: [],
    decisionQueries: decisions,
    sourceCategories,
    date: question.match(/\b(1[89]\d{2}|20\d{2})\b/)?.[1] ?? null,
    historical: HISTORICAL.test(question),
    language: icelandic ? "is" : "en",
    legal: true,
    standalone: question.trim(),
  };
}

const STOPWORDS = new Set([
  // Icelandic
  "hvað","hver","hvernig","hvaða","hvenær","hvar","segir","þarf","getur","geta","mega","verður",
  "vera","hafa","hafði","þegar","þetta","þessi","þessu","þeirra","sem","með","fyrir","eftir",
  "þeim","þeir","þær","síðan","einnig","gæti","mundi","myndi","ekki","aðeins","bara","mjög",
  "annað","allir","allt","milli","undir","yfir","samkvæmt","varðandi","hvort","eða","ísland",
  "íslandi","íslenskt","íslenskan","íslenskum",
  // English
  "what","which","when","where","how","does","should","would","could","will","can","must","may",
  "the","and","for","from","with","about","into","that","this","these","those","have","has",
  "there","their","them","they","you","your","are","was","were","been","being","apply","get",
  "need","want","know","tell","please","under","over","between","according","then","else",
  "also","such","any","other","more","some","only","just","very","than","because",
]);

/**
 * Plans the search. Never throws: a planning failure degrades to the
 * heuristic, because the answer that matters is the one built on retrieved
 * law, and the plan is only how we go and find it.
 */
export async function planQuery(
  question: string,
  history: AskTurn[],
  model: AskModel = getAskModel(),
  config: AskConfig = askConfig(),
  onUsage?: (usage: { inputTokens?: number; outputTokens?: number }) => void
): Promise<QueryPlan> {
  try {
    const plan = await model.extract<QueryPlan>({
      system: PLAN_SYSTEM,
      messages: [...history, { role: "user", content: question }],
      maxTokens: config.planMaxTokens,
      effort: config.planEffort,
      onUsage,
      tool: {
        name: "plan_search",
        description: "Record the search plan for this question.",
        schema: PLAN_SCHEMA as unknown as Record<string, unknown>,
      },
      parse: (input) => parsePlan(input, question),
    });
    return plan ? mergeHeuristics(plan, question) : heuristicPlan(question, history);
  } catch (e) {
    console.error("Ask: planning failed, falling back to keywords:", e);
    return heuristicPlan(question, history);
  }
}

/**
 * What the question says for itself, folded into what the model said about it.
 *
 * A case number and a quoted phrase are facts about the question, not
 * judgements about it: the user typed "Hrd. 22/2023" or put a term in quotes,
 * and losing that because a model did not repeat it back costs an exact match
 * we would otherwise have had.
 */
export function mergeHeuristics(plan: QueryPlan, question: string): QueryPlan {
  const typedCases = Array.from(new Set(question.match(CASE_NUMBER_RE) ?? []));
  const typedPhrases = Array.from(question.matchAll(QUOTED_RE), (m) => m[1].trim());

  return {
    ...plan,
    decisionQueries: Array.from(new Set([...typedCases, ...plan.decisionQueries])).slice(0, 5),
    phrases: Array.from(new Set([...typedPhrases, ...plan.phrases])).slice(0, 5),
    sourceCategories: plan.sourceCategories.length
      ? plan.sourceCategories
      : (["legislation", "decisions"] as AskSourceCategory[]),
  };
}

/**
 * A list of terms as one query for websearch_to_tsquery.
 *
 * OR, not AND: the terms are alternative ways of naming the same subject, and
 * requiring all of them would match only a document that happened to use
 * every synonym. Multi-word terms are quoted so they match as phrases —
 * "veiting ríkisborgararéttar" as those two words together, not as two common
 * words scattered through a judgment.
 */
export function termsToQuery(terms: string[]): string {
  return terms
    .map((t) => t.replace(/["']/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((t) => (t.includes(" ") ? `"${t}"` : t))
    .join(" OR ");
}

/**
 * One term as its own query, phrase-quoted when it has spaces.
 *
 * The difference from `termsToQuery` is the whole point of running focused
 * searches: this is what a single concept, or a single phrase, is searched as
 * on its own, so its ranking is its own rather than an average.
 */
export function termToQuery(term: string): string {
  const clean = term.replace(/["']/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  return clean.includes(" ") ? `"${clean}"` : clean;
}
