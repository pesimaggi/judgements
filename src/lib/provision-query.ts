/**
 * Reading what a user typed into the act/provision box.
 *
 * People reach for a provision the way they would write the citation —
 * "57. gr. a. laga um aðbúnað og hollustuhætti" — rather than by picking an
 * act and then an article from two separate controls. This splits that one
 * string into the article part and the act part so the lookup can answer with
 * the provision itself.
 *
 * Everything is optional: "lög um aðbúnað" is an act query with no article,
 * "57. gr." is an article with no act (useful once an act is already chosen),
 * and the article qualifiers ("1. mgr.", "2. tölul.") are accepted and kept
 * so the phrasing a lawyer would use does not have to be trimmed by hand.
 */

export interface ParsedProvisionQuery {
  /** The article number, if the text began with one. */
  articleNumber: number | null;
  /** The letter suffix in "57. gr. a". */
  articleLetter: string | null;
  /** "1. mgr." → 1. Captured for display; provisions are article-level. */
  paragraphNumber: number | null;
  /** What is left once the article reference is removed — the act's name. */
  actQuery: string;
  /** True when an article reference was recognised. */
  hasArticle: boolean;
}

/**
 * "1. mgr. 57. gr. a." and friends, anchored to the start of the input.
 *
 * The letter suffix must stand as its own word: without the guard, "57. gr.
 * laga um…" reads as article 57 letter "l", swallowing the first letter of
 * the following word. Same trap as in lib/legal-citations.ts.
 */
const LEADING_ARTICLE = new RegExp(
  String.raw`^\s*` +
    String.raw`(?:(\d+)\.\s*tölul\.\s*)?` +
    String.raw`(?:(\d+)\.\s*málsl\.\s*)?` +
    String.raw`(?:(\d+)\.\s*mgr\.\s*)?` +
    String.raw`(\d+)\.\s*gr\.?` +
    String.raw`(?:\s*([a-záðéíóúýþæö])(?![\p{L}]))?` +
    String.raw`\.?\s*`,
  "iu"
);

/**
 * The connective words between an article and its act — "57. gr. a. **laga
 * um** aðbúnað". Stripped so that what remains matches the act's stored
 * title, which does not include them in that form.
 */
const ACT_LEAD_IN = /^\s*(?:,?\s*sbr\.\s*)?(?:í\s+)?(?:lög|lögum|laga|laganna|lögunum|l\.)\s*/iu;

/**
 * "Article 6", "art. 6a" — the same reference written the EU way.
 *
 * The act library now holds EU regulations and directives alongside the
 * Icelandic acts, and their articles are cited "Article 6 of the GDPR", never
 * "6. gr.". Without this the box could find the act but never the article of
 * it, which is the half of the query that narrows.
 */
const LEADING_ARTICLE_EN = /^\s*art(?:icle)?\.?\s*(\d+)\s*([a-z])?(?![\p{L}])\.?\s*(?:of\s+(?:the\s+)?)?/iu;

export function parseProvisionQuery(raw: string): ParsedProvisionQuery {
  const input = raw.trim();
  const english = LEADING_ARTICLE_EN.exec(input);
  if (english) {
    return {
      articleNumber: Number(english[1]),
      articleLetter: english[2]?.toLowerCase() ?? null,
      paragraphNumber: null,
      actQuery: input.slice(english[0].length).trim(),
      hasArticle: true,
    };
  }
  const m = LEADING_ARTICLE.exec(input);

  if (!m) {
    return {
      articleNumber: null,
      articleLetter: null,
      paragraphNumber: null,
      actQuery: input,
      hasArticle: false,
    };
  }

  const rest = input.slice(m[0].length);
  return {
    articleNumber: Number(m[4]),
    articleLetter: m[5] ? m[5].toLowerCase() : null,
    paragraphNumber: m[3] ? Number(m[3]) : null,
    // "laga um aðbúnað" → "um aðbúnað"; the act titles are stored as "Lög um
    // aðbúnað …", so leaving "laga" in front would match nothing.
    actQuery: rest.replace(ACT_LEAD_IN, "").trim(),
    hasArticle: true,
  };
}

/** How the article part reads back, e.g. "1. mgr. 57. gr. a". */
export function formatArticleLabel(q: ParsedProvisionQuery): string {
  if (!q.hasArticle) return "";
  const parts: string[] = [];
  if (q.paragraphNumber) parts.push(`${q.paragraphNumber}. mgr.`);
  parts.push(`${q.articleNumber}. gr.`);
  if (q.articleLetter) parts.push(q.articleLetter);
  return parts.join(" ");
}
