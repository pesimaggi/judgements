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
 * The planner is also where a follow-up question is made whole: "and what
 * does it cost?" is unanswerable on its own and perfectly answerable once the
 * earlier turns are folded into it.
 */
import { getAskModel, type AskModel } from "./llm";
import type { AskTurn, QueryPlan } from "./types";

const PLAN_SYSTEM = `You prepare search queries for Lögbrunnur, a search engine over Icelandic law.

Its corpus is: Icelandic acts (lög) from Lagasafn, EU acts from EUR-Lex, and decisions of the Icelandic courts, the EFTA Court, the CJEU, Umboðsmaður Alþingis and the Icelandic administrative appeal boards. Icelandic material is indexed in Icelandic; EU material in English.

Given a question, produce the terms that will actually match that corpus.

Rules:
- Search terms must be in the language of the material, which for a question about Icelandic law means Icelandic — even when the question is in English. Translate the concept, do not transliterate the question.
- Prefer the terms the legislation itself uses over everyday wording: "ríkisborgararéttur", not "verða Íslendingur".
- Give 3-6 terms, from most to least specific. Multi-word terms are matched as phrases.
- Name the acts the question is likely governed by, as they would be cited ("lög um íslenskan ríkisborgararétt", "útlendingalög", "stjórnsýslulög"). Give 0-3. Never invent a number for an act you are not sure of — a name alone is looked up correctly, a wrong number is not.
- "language" is the language the ANSWER must be written in: the language the user asked in.
- "legal" is false only when the question has nothing to do with law or the legal system.
- "standalone" restates the question so it can be read on its own, resolving anything carried over from earlier turns. Keep the user's own language.`;

const PLAN_SCHEMA = {
  type: "object",
  properties: {
    terms: {
      type: "array",
      items: { type: "string" },
      description: "3-6 search terms in the language of the material.",
    },
    actQueries: {
      type: "array",
      items: { type: "string" },
      description: "0-3 acts the question is likely governed by, as they are cited.",
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
  required: ["terms", "actQueries", "language", "legal", "standalone"],
  additionalProperties: false,
} as const;

/**
 * Narrows the model's arguments to a plan, and drops anything unusable rather
 * than letting it through to the search: an empty term is a query for
 * everything, and forty terms is a query for nothing in particular.
 */
export function parsePlan(input: unknown, question: string): QueryPlan | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;

  const strings = (value: unknown, max: number): string[] =>
    Array.isArray(value)
      ? Array.from(
          new Set(
            value
              .filter((v): v is string => typeof v === "string")
              .map((v) => v.trim())
              .filter((v) => v.length > 1)
          )
        ).slice(0, max)
      : [];

  const terms = strings(raw.terms, 6);
  if (terms.length === 0) return null;

  const standalone = typeof raw.standalone === "string" ? raw.standalone.trim() : "";

  return {
    terms,
    actQueries: strings(raw.actQueries, 3),
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

  return {
    terms: terms.length ? terms : [question.trim()],
    actQueries: [],
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
  model: AskModel = getAskModel()
): Promise<QueryPlan> {
  try {
    const plan = await model.extract<QueryPlan>({
      system: PLAN_SYSTEM,
      messages: [...history, { role: "user", content: question }],
      maxTokens: 8000,
      effort: "low",
      tool: {
        name: "plan_search",
        description: "Record the search plan for this question.",
        schema: PLAN_SCHEMA as unknown as Record<string, unknown>,
      },
      parse: (input) => parsePlan(input, question),
    });
    return plan ?? heuristicPlan(question, history);
  } catch (e) {
    console.error("Ask: planning failed, falling back to keywords:", e);
    return heuristicPlan(question, history);
  }
}

/**
 * The plan's terms as one query for websearch_to_tsquery.
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
