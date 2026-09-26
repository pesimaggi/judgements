/**
 * Field guidance for the research loop: what a specialist would do that the
 * general method in lib/ask/research.ts does not say.
 *
 * WHY THIS IS A REGISTRY AND NOT MORE PARAGRAPHS IN THE PROMPT
 *
 * Each entry is distilled from a document in `docs/research-skills/`, which is
 * where the method is actually written down and argued for — by a lawyer, in
 * prose, at a length no prompt can carry. EU/EEA law is the first of those
 * documents and pointedly not the last: it hands competition law and State aid
 * to specialist skills of their own, and the documents already written will be
 * revised as the corpus grows into legislative history it does not yet hold.
 * So a field is one entry here, naming the document it came from, and the next
 * field is a new entry rather than another seam cut into a template literal.
 *
 * WHAT A DISTILLATION LEAVES OUT
 *
 * Everything the general method already covers: how to open a source, that only
 * an opened document may be cited, following what a judgment cites, the weight
 * of the three Icelandic courts, how to finish. A repeated instruction is not
 * free. It is paid for on every round of a loop that runs a dozen of them, and
 * an instruction given twice reads as emphasis — which moves weight away from
 * the specialist point that is the only reason the section exists. What belongs
 * here is what no general method could know: that incorporation decides whether
 * an EU act counts at all, that three rows in this corpus hold one EEA
 * Agreement, which authorities a State-liability question is not researched
 * without.
 *
 * WHY THE SECTIONS ARE GATED, AND GATED GENEROUSLY
 *
 * With one field, always-on would be harmless. With six it is most of the
 * prompt, and a competition-law digression on a fæðingarorlof question is noise
 * the loop pays for by the round. So each entry says when its field is in play,
 * and says it generously, on the trade `scopeFilter()` makes for acts: a section
 * wrongly included costs tokens, where a section wrongly left out switches the
 * specialist method off silently and looks exactly like a model that researched
 * the question badly. A question that so much as mentions Europe gets the EEA
 * section. That is the intended behaviour, not a loose pattern.
 */
import { wordAlternation } from "../word-boundary";
import type { QueryPlan } from "./types";

/** What a field is matched against: the question as planned, and the scope. */
export interface ResearchSkillContext {
  plan: QueryPlan;
  /** The act scope the loop searches under; "eu" is the whole EU library. */
  scope: "eea" | "eu";
}

export interface ResearchSkill {
  /** Stable key, for tests and for saying which sections a run carried. */
  key: string;
  /** The document this is distilled from. The two are meant to stay in step. */
  doc: string;
  /** The section heading, in the shouted style the rest of the prompt uses. */
  heading: string;
  /** Whether the question is in this field. Err towards true; see above. */
  applies(context: ResearchSkillContext): boolean;
  /** The guidance itself, as it is rendered into the system prompt. */
  guidance: string;
}

/**
 * Everything the planner understood about the question, as one string to look
 * for words in.
 *
 * The planner's own output is in here and not merely the user's sentence,
 * because it has already translated the question into the corpus's vocabulary:
 * a question that never says "EES" can still arrive with a tilskipun in
 * `actQueries` or E-5/21 in `decisionQueries`.
 */
function planText(plan: QueryPlan): string {
  return [
    plan.standalone,
    ...plan.concepts,
    ...plan.phrases,
    ...plan.actQueries,
    ...plan.provisionQueries,
    ...plan.decisionQueries,
  ].join(" · ");
}

/**
 * The words that put a question in EEA or EU territory.
 *
 * Built with `wordAlternation` because half of them are Icelandic and
 * JavaScript's `\b` does not fire next to á ð é í ó ú ý þ æ ö: written the
 * obvious way, `/\bfjórfrelsi/` and `/\bbókun 35\b/` match nothing and the
 * section simply never appears, with no error anywhere. See lib/word-boundary.ts.
 *
 * The stems are deliberate — tilskipun, tilskipunar and tilskipunum are one
 * word to a reader — and so is the last alternative: an EFTA Court or CJEU case
 * number is the strongest signal there is that a question is here, and it is
 * the one thing a planner extracts reliably.
 */
const EU_EEA_MARKERS = wordAlternation([
  "ees\\p{L}*",
  "eea",
  "esb",
  "eu",
  "efta\\p{L}*",
  "esa",
  // Evrópusambandið, Evrópudómstóllinn, evrópskur. This also fires on
  // Evrópuráðið and the mannréttindasáttmáli, which is the generous half of the
  // trade above: a section of prompt that does not apply, rather than a missing
  // one.
  "evróp\\p{L}*",
  "tilskipun\\p{L}*",
  "fjórfrelsi\\p{L}*",
  "innri\\s+marka\\p{L}*",
  "bókun\\s+(?:nr\\.\\s*)?35",
  "protocol\\s+35",
  // lög nr. 2/1993, which is the whole of the domestic-effect question.
  "2\\/1993",
  "european\\s+union",
  "internal\\s+market",
  "free\\s+movement",
  "fundamental\\s+freedoms?",
  "directives?",
  "cjeu",
  "ecj",
  // E-9/97, C-6/64: an EFTA Court or CJEU number, never an Icelandic one.
  "[ce]-\\d{1,4}\\/\\d{2,4}",
]);

/**
 * EU and EEA law, from docs/research-skills/eu-eea-law.md.
 *
 * Competition and State aid are outside it by the document's own terms: they
 * are to have specialist skills of their own, and until those exist a question
 * about them gets this section and the general method, which is the same thing
 * it got before.
 */
const EU_EEA_SKILL: ResearchSkill = {
  key: "eu-eea-law",
  doc: "docs/research-skills/eu-eea-law.md",
  heading: "EU AND EEA LAW, WHERE THE QUESTION TOUCHES IT",
  applies: ({ plan, scope }) =>
    // The ESB scope is switched on precisely to look at acts that may not be in
    // the Agreement, which is this field's first question.
    scope === "eu" ||
    // The planner asking for EU material is its own reading of the question,
    // and a better one than any word list.
    plan.sourceCategories.includes("eu") ||
    EU_EEA_MARKERS.test(planText(plan)),
  guidance: `An EEA problem asks four things, and the fourth does not follow from the first three: what rule is actually part of EEA law, how it reads in the EEA context, what the CJEU and the EFTA Court have made of it, and — where Iceland is concerned — what effect it has here.

**Incorporation is the first question about any EU act.** A regulation, directive or decision is not EEA law for governing the internal market or for carrying the EEA-relevance marker. Search the eea-joint-committee source for the decision that names the act, and read it for where in the Annexes or Protocols the act sits, whether the incorporation is in force, and what adaptations came with it. Adaptations move institutional references, territorial scope, deadlines and wording, so read the act together with them, and with bókun 1 and the horizontal adaptations where they bear on it. Where the corpus does not hold the decision, that is a gap to state, not licence to assume incorporation either way. Check too that the act still governs — repealed, recast, materially amended — and where it does not, whether the replacement was itself incorporated: repeal in EU law does not settle what applies in the EEA. Dates and transitional periods matter only where the question turns on them.

**The EEA Agreement is one instrument in three rows.** This corpus holds it in Icelandic, in English, and again as the annex to lög nr. 2/1993. The Icelandic Agreement is the canonical text. Deduplicate by Article or Protocol provision: the same Article from two or three rows is one provision and one authority, and giving the answer all of them does not make the proposition better supported. Open the English text where its wording does work — a term an EFTA Court or CJEU judgment turns on, an English answer that should carry the Agreement's own words — and leave the annex copy once you hold the canonical Article.

**The CJEU and the EFTA Court are both core authority** (sources: eftacourt, cjeu, eu-general-court). Neither outranks the other on the meaning of an EEA rule; which judgments illuminate the issue is the only question. 6. gr. EES speaks to CJEU case law predating the Agreement where the provisions are substantially the same, but a later CJEU judgment is not secondary for being later — homogeneous interpretation is the point — and the EFTA Court is where the rule's EEA application is worked out. Keep the real differences in view all the same: the Agreement's own wording, the adaptations, the two-pillar structure, fields outside or only partly within the EEA, domestic effect. And where a test has developed across a line of cases, as the free-movement tests have, the famous judgment alone states it out of date.

**Secondary legislation before the freedoms.** Ask whether an incorporated act governs the matter, whether it harmonises it exhaustively, what discretion it leaves the State and whether it carries its own derogation and proportionality regime. A generic 11., 28., 31., 36. or 40. gr. EES analysis is no substitute for the specific regime; where primary law still has work beside it, say why.

**Free movement: research the test that field actually applies.** Whether the situation is within the freedom at all and has the EEA cross-border element; the restriction test that field's case law uses — direct discrimination, indirect, indistinctly applicable measures, market access — rather than one assumed to serve every freedom; the justification available, an express derogation or an overriding reason in the public interest; and the proportionality the cases actually demand, suitability and necessity and less restrictive means, consistency in pursuit of the stated aim, and the procedural safeguards the case law folds into the assessment — objective criteria, transparency, reasons, review.

**Incorporation into the EEA is not implementation in Iceland.** Two questions kept apart, for regulations as much as for directives: Iceland is not a monist system, so an incorporated EU regulation becomes Icelandic law only through a national measure, with 7. gr. EES going to the form that measure takes. Find the implementing lög or reglugerð where the question turns on it, and do not make a mapping exercise the price of every EEA answer.

**Domestic effect is researched, never imported.** That the equivalent EU rule has direct effect or primacy tells you nothing about Iceland. Where conflict with an Icelandic Act, disapplication, bókun 35 or skýring til samræmis við EES-reglur is in issue, read the current wording of lög nr. 2/1993 — 3. gr. above all — and then the Icelandic line: Hrd. 477/2002 (15. maí 2003, advisory opinion E-1/01), which resolved a conflict over 14. gr. EES through 3. gr., the legislative history and bókun 35; Hrd. 220/2005 (tóbaksauglýsingar, 6. apríl 2006), where a breach of 11. and 36. gr. EES was held not of itself to make the statutory provision inoperative, though it might found State liability instead; Hrd. 274/2006 (24. maí 2006); and Hrd. 24/2023 (28. febrúar 2024) for where the position stands now. Anchors to read, not a doctrine of supremacy to quote.

**State liability has authorities the research must reach.** E-9/97 Sveinbjörnsdóttir with the judgment that followed it, Hrd. 236/1999; and for the modern development E-5/21 Einarsdóttir with Hrd. 50/2025 (23. september 2026). The EFTA Court opinion and the Icelandic judgment answer that question together, and general EU principle substitutes for neither.

**ESA material is research material, not a ruling** (source: eftasurv). Keep its stages apart — a letter, a letter of formal notice, a reasoned opinion, an ESA decision, an action brought before the EFTA Court, a judgment — and never present ESA's position as the law settled; it is sometimes disputed and sometimes not upheld. It is genuinely valuable on implementation, on the conformity of Icelandic legislation and on the history of a contested national measure. On bókun 35 and domestic effect, look for ESA's letter of formal notice no. 77038 where the corpus holds it.

**An institutional question is a mechanism, not an article.** Incorporation of new legislation, the Joint Committee, amendment of the Annexes, safeguard measures, suspension, surveillance, dispute settlement, the two-pillar structure: find the provisions, Protocols, Annex rules, Joint Committee decisions and the Surveillance and Court Agreement that make it work together, and ask whether the Agreement itself provides the rule before reaching for general international law.

**Know where the Agreement stops.** The customs union, the common agricultural policy and the common fisheries policy are not reproduced in the EEA — which does not put agriculture and fisheries outside it, because Protocols, product rules and incorporated acts still reach them. Check scope where the subject matter gives you a reason to.

**Recitals are legitimate interpretive material** — retrieve them for an act's objective and a provision's context, though a binding obligation still needs its operative provision identified. Read EU, incorporated, EFTA Court, CJEU and ESA material in English and Icelandic material in Icelandic; and where the proposition turns on EU or EEA wording, or on a test a judgment formulates, open the actual English passage, so the reader can check the law against its own words rather than an Icelandic paraphrase.

Not all of this belongs in every question — do the parts the issue turns on. What is wanted is research that is legally complete, not research that looks exhaustive.`,
};

/**
 * Every field guidance there is. Order is the order sections appear in the
 * prompt, which is why a new field goes on the end rather than in the middle.
 */
export const RESEARCH_SKILLS: ResearchSkill[] = [EU_EEA_SKILL];

/** The fields in play for one question, in registry order. */
export function researchSkillsFor(context: ResearchSkillContext): ResearchSkill[] {
  return RESEARCH_SKILLS.filter((skill) => skill.applies(context));
}

/** Those fields' sections, ready to drop into the system prompt. */
export function researchSkillSections(context: ResearchSkillContext): string[] {
  return researchSkillsFor(context).map((skill) => `${skill.heading}\n\n${skill.guidance.trim()}`);
}
