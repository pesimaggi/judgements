/**
 * Word boundaries that work in Icelandic.
 *
 * JavaScript's `\b` is defined against the ASCII word class, so it does not
 * fire next to á ð é í ó ú ý þ æ ö. That makes it not merely imprecise but
 * *inverted* for this corpus: `/\bþágildandi\b/` never matches "þágildandi",
 * because there is no ASCII word character on either side of it, and
 * `/\bað\b/` never matches "að" at the end of a phrase for the same reason.
 *
 * A regex written that way looks correct, passes review, and silently matches
 * nothing — which for a recogniser that decides whether a sentence states a
 * rule means the recogniser is simply switched off. The lookarounds below use
 * the Unicode letter and number classes instead, and are what every
 * word-boundary match over Icelandic text in this app should be built from.
 */

/** Nothing that is a letter or a digit immediately before. */
export const BEFORE = "(?<![\\p{L}\\p{N}])";
/** Nothing that is a letter or a digit immediately after. */
export const AFTER = "(?![\\p{L}\\p{N}])";

/**
 * A case-insensitive alternation of whole words or phrases.
 *
 * Each alternative may itself contain regex — `ber\\s+(?:\\S+\\s+)?að` is a
 * phrase with a hole in it — so what is guaranteed is only that the whole
 * alternation begins and ends on a word boundary.
 */
export function wordAlternation(alternatives: string[], flags = "iu"): RegExp {
  return new RegExp(`${BEFORE}(?:${alternatives.join("|")})${AFTER}`, flags);
}

/** One whole word or phrase, anchored the same way. */
export function wholeWord(pattern: string, flags = "iu"): RegExp {
  return new RegExp(`${BEFORE}(?:${pattern})${AFTER}`, flags);
}
