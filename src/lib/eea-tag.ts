/**
 * The EEA tag: one sentence about where an EU act stands in relation to the
 * EEA Agreement, in the two words a list can carry.
 *
 * It lives in its own module, free of imports, because the same tag has to be
 * rendered by the act catalogue, the act reader and the act type-ahead — all
 * client components — and by the API that feeds them. Anything that reached
 * for `lib/acts.ts` would drag Prisma into the browser bundle.
 *
 * THREE STATES, AND THE DIFFERENCE MATTERS.
 *
 *   "incorporated" — a decision of the EEA Joint Committee names this act. The
 *     Committee is what actually takes an EU act into the Agreement, so this
 *     is the fact rather than an intention, and the decision numbers are
 *     carried with it so a reader can check.
 *   "relevant" — EUR-Lex marks the act "(Text with EEA relevance)" but no
 *     decision we know of names it. That is the Commission's view that the act
 *     belongs in the Agreement: often the same thing, sometimes a decision
 *     that has not been adopted yet, and occasionally a gap in what we hold.
 *   null — neither. The act is in this library because the ESB scope shows the
 *     whole EU corpus, not because it binds anything here.
 *
 * The two are not ranked by confidence, they are different claims, which is
 * why a marked act that a decision also names reads as incorporated: the fact
 * outranks the intention when both are present.
 */

export type EeaStatus = "incorporated" | "relevant";

export interface EeaTag {
  status: EeaStatus;
  /** Two words, for a list. */
  label: string;
  /** The whole claim, for a title attribute or a panel. */
  detail: string;
}

export interface EeaTaggable {
  jurisdiction?: string;
  eeaRelevant?: boolean;
  eeaIncorporatedBy?: string[];
}

/**
 * The tag for one act, or null where there is nothing to say.
 *
 * Icelandic acts never carry it: "is this part of EEA law" is not a question
 * about lög nr. 91/1991, and a tag on every row would say nothing.
 */
export function eeaTag(act: EeaTaggable): EeaTag | null {
  if (act.jurisdiction !== undefined && act.jurisdiction !== "eu") return null;

  const decisions = act.eeaIncorporatedBy ?? [];
  if (decisions.length > 0) {
    const shown = decisions.slice(0, 4).join(", ");
    const rest = decisions.length > 4 ? ` og ${decisions.length - 4} til viðbótar` : "";
    return {
      status: "incorporated",
      label: "EES",
      detail: `Nefnd í ákvörðun sameiginlegu EES-nefndarinnar nr. ${shown}${rest}.`,
    };
  }

  if (act.eeaRelevant) {
    return {
      status: "relevant",
      label: "EES?",
      detail:
        "Merkt „Text with EEA relevance“ í EUR-Lex, en engin ákvörðun sameiginlegu " +
        "EES-nefndarinnar sem nefnir hana er í safninu.",
    };
  }

  return null;
}
