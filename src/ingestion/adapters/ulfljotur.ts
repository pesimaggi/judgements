import { load, type CheerioAPI } from "cheerio";
import { prisma } from "@/lib/db";
import type { IngestionAdapter, IngestContext, IngestStats } from "../adapter";

/**
 * Vefrit Úlfljóts adapter — ulfljotur.com.
 *
 * VERIFIED against the live site:
 *
 *  - The site runs on WordPress.com, which serves no `/wp-json/` on the
 *    custom domain (it answers 404) but does expose the same content through
 *    the platform's public REST API:
 *      https://public-api.wordpress.com/rest/v1.1/sites/ulfljotur.com/posts/
 *    That endpoint returns the *whole* post, rendered HTML body included, so
 *    one request lists the journal and carries every article with it. There
 *    are 48 posts at the time of writing, well inside the API's 100-per-page
 *    limit, which makes a complete run a single HTTP request.
 *
 *  - Article bodies are published in full on the web — abstract (Ágrip), an
 *    English Abstract on the newer ones, the argument, footnotes and the
 *    bibliography. There is no paywall and no PDF-only article, so unlike the
 *    EFTA Court and Tímarit Lögréttu this source needs no opt-in flag to be
 *    genuinely full-text.
 *
 *  - Authorship is written into the body rather than into the post's author
 *    field, which is the shared "ulfljotur" editorial account for every post.
 *    The first paragraph is the byline: "Eftir Ragnheiði Bragadóttur,
 *    prófessor við lagadeild Háskóla Íslands" (or "By …" on the English
 *    article). It is lifted out of the body and stored under its own heading.
 *
 *  - Peer review is stated in the body too, as a footnote to the title, and
 *    it is stated both ways: "Grein þessi hefur verið ritrýnd og staðist þær
 *    fræðilegu kröfur sem gerðar eru samkvæmt reglum Vefrits Úlfljóts" on a
 *    reviewed article, "Grein þessi hefur ekki verið ritrýnd" on one that was
 *    not, and half a dozen other phrasings on the older ones. The statement is
 *    therefore left exactly where the journal put it, in the body, rather than
 *    boiled down to a flag this adapter would have to get right — a footnote
 *    that reads the same to a searcher as to a reader, and no claim of ours.
 *
 * The site also posts occasional news items (tagged "Frétt"). Those are not
 * scholarship and are left out.
 */

const API =
  process.env.ULFLJOTUR_API ??
  "https://public-api.wordpress.com/rest/v1.1/sites/ulfljotur.com/posts/";

/** The API's ceiling; the journal is well under it, but paging is followed anyway. */
const PAGE_SIZE = 100;

/** Below this a post is a note or a notice rather than an article. */
const MIN_TEXT_CHARS = 1200;

/** Categories and tags marking a post as news rather than scholarship. */
const NEWS_TERMS = new Set(["frétt", "fréttir", "tilkynning"]);

/** Terms too generic to be worth a subject tag of their own. */
const IGNORED_TAGS = new Set(["uncategorized", "óflokkað"]);

/** The byline the journal opens every article with. */
const BYLINE_RE = /^(?:eftir|by)\s+\S/i;

interface WpPost {
  ID: number;
  title: string;
  URL: string;
  date: string;
  modified?: string;
  content: string;
  categories?: Record<string, unknown>;
  tags?: Record<string, unknown>;
}

function squish(text: string): string {
  return text.replace(/ /g, " ").replace(/\s+/g, " ").trim();
}

/**
 * WordPress renders titles with HTML entities in them ("&#8211;"), and the
 * body is markup. Both are decoded through cheerio rather than by hand.
 */
function decodeEntities(text: string): string {
  return squish(load(`<p>${text}</p>`)("p").text());
}

interface Body {
  byline: string;
  pdfUrl?: string;
  text: string;
}

/**
 * The article body as paragraph-per-line text, with the byline and the
 * journal's own furniture (the PDF download block, share buttons) taken out.
 */
function parseBody(html: string): Body {
  const $: CheerioAPI = load(html);

  // The PDF is the same article in print layout; keep the link, drop the
  // block, whose visible text is only "Sækja pdf-útgáfu Download".
  const pdfUrl = $("a[href$='.pdf']").first().attr("href");
  $(".wp-block-file, .sharedaddy, .jp-relatedposts, script, style, figure, img").remove();

  // The table of contents is one paragraph of <br>-separated entries, and
  // cheerio's .text() drops the breaks — leaving "1 Inngangur2 Um
  // verðtryggingu". Turning them into newlines first keeps the entries apart.
  $("br").replaceWith("\n");

  const blocks = $("p, li, h1, h2, h3, h4, h5, h6, blockquote")
    .map((_, el) => $(el).text().split("\n").map(squish).filter(Boolean).join("\n"))
    .get()
    .filter(Boolean);

  let byline = "";
  const text: string[] = [];
  for (const block of blocks) {
    // The byline is the opening line, so only the head of the article is
    // searched for one — "Eftir" turns up mid-argument as an ordinary word.
    if (!byline && text.length < 3 && BYLINE_RE.test(block)) {
      byline = block;
      continue;
    }
    text.push(block);
  }

  return { byline, pdfUrl, text: text.join("\n") };
}

/** Category and tag names, which the API returns as an object keyed by name. */
function termNames(post: WpPost): string[] {
  return [...Object.keys(post.categories ?? {}), ...Object.keys(post.tags ?? {})].map((t) =>
    t.trim()
  );
}

function isNews(post: WpPost): boolean {
  return termNames(post).some((t) => NEWS_TERMS.has(t.toLowerCase()));
}

function subjectTags(post: WpPost): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const name of termNames(post)) {
    const key = name.toLowerCase();
    if (IGNORED_TAGS.has(key) || seen.has(key) || name.length < 2) continue;
    seen.add(key);
    tags.push(name);
  }
  return tags;
}

/**
 * The record as it is stored and searched.
 *
 * "Ágrip" and "Abstract" are already section headings inside the body, and
 * "Ágrip" is one of the headings the shared summary extractor recognises — so
 * the abstract reaches result cards without this adapter having to find it.
 */
function composeRecord(title: string, body: Body, imprint: string): string {
  const lines: string[] = [title];
  if (body.byline) lines.push("", "Höfundur", body.byline);
  lines.push("", "Heimild", imprint);
  lines.push("", "Meginmál", body.text);
  return lines.join("\n");
}

/** WordPress.com hands out http:// URLs for custom domains that serve https. */
function canonicalUrl(url: string): string {
  return url.replace(/^http:\/\//, "https://");
}

function listUrl(page: number): string {
  const params = new URLSearchParams({
    number: String(PAGE_SIZE),
    page: String(page),
    // The default response carries every rendered variant of the post; only
    // these are used, and asking for them keeps a full listing to a few
    // hundred kilobytes.
    fields: "ID,title,URL,date,modified,content,categories,tags",
  });
  return `${API}?${params}`;
}

async function fetchPosts(ctx: IngestContext): Promise<WpPost[]> {
  const posts: WpPost[] = [];
  for (let page = 1; ; page++) {
    const body = JSON.parse(await ctx.fetchText(listUrl(page)));
    const batch: WpPost[] = body.posts ?? [];
    posts.push(...batch);
    const found = Number(body.found ?? posts.length);
    if (batch.length === 0 || posts.length >= found) break;
  }
  return posts;
}

/**
 * Reports what the API serves, without saving anything — the quick check to
 * run if the journal moves off WordPress.com and this adapter starts finding
 * nothing.
 */
async function probe(ctx: IngestContext): Promise<void> {
  const posts = await fetchPosts(ctx);
  ctx.log(`  ${posts.length} posts listed`);
  for (const post of posts.slice(0, 3)) {
    const body = parseBody(post.content);
    ctx.log(`  ${post.date.slice(0, 10)} ${decodeEntities(post.title).slice(0, 60)}`);
    ctx.log(
      `    byline: ${body.byline ? body.byline.slice(0, 60) : "NONE"}; ` +
        `${body.text.length} chars; pdf: ${body.pdfUrl ? "yes" : "no"}; tags: ${subjectTags(post).join(", ")}`
    );
  }
}

export const ulfljoturAdapter: IngestionAdapter = {
  key: "ulfljotur",
  name: "Úlfljótur — vefrit (ulfljotur.com)",
  sourceKeys: ["ulfljotur"],

  async run(ctx: IngestContext): Promise<IngestStats> {
    const stats: IngestStats = { indexed: 0, skipped: 0, errors: 0 };

    if (process.env.INGEST_PROBE === "1") {
      await probe(ctx);
      return stats;
    }

    let posts: WpPost[];
    try {
      posts = await fetchPosts(ctx);
    } catch (e) {
      stats.errors++;
      stats.errorSample = String(e);
      ctx.log(`Could not list the journal: ${String(e).slice(0, 200)}`);
      return stats;
    }

    if (posts.length === 0) {
      ctx.log("The API listed no posts — the site has moved off WordPress.com, or the domain has changed.");
      return stats;
    }

    const articles = posts.filter((p) => !isNews(p));
    ctx.log(`${posts.length} posts listed, ${articles.length} of them articles.`);

    // The API's own count, so the progress bar has an exact denominator.
    await prisma.source.updateMany({
      where: { key: "ulfljotur" },
      data: { totalAvailable: articles.length },
    });

    for (const post of articles) {
      try {
        const body = parseBody(post.content);
        if (body.text.length < MIN_TEXT_CHARS) {
          stats.skipped++;
          ctx.log(`  "${decodeEntities(post.title).slice(0, 60)}": only ${body.text.length} chars — skipped as a notice, not an article`);
          continue;
        }

        const title = decodeEntities(post.title);
        const date = new Date(post.date);
        const year = Number.isNaN(date.getTime()) ? undefined : date.getUTCFullYear();
        const imprint = ["Úlfljótur — vefrit", year ? String(year) : ""].filter(Boolean).join(" · ");

        const result = await ctx.save({
          source: "ulfljotur",
          court: "Úlfljótur (vefrit)",
          title,
          date: Number.isNaN(date.getTime()) ? undefined : date,
          year,
          // One article is written in English; the rest are Icelandic. The
          // journal states no language, so it is read off the text: ð and þ
          // appear in any Icelandic prose of this length and in no English.
          language: /[ðþ]/.test(body.text.slice(0, 4000)) ? "is" : "en",
          // The field the document page labels "Höfundur" for a journal.
          parties: body.byline || undefined,
          subjectTags: subjectTags(post),
          officialUrl: canonicalUrl(post.URL),
          pdfUrl: body.pdfUrl,
          fullText: composeRecord(title, body, imprint),
        });
        if (result === "indexed") stats.indexed++;
        else stats.skipped++;
      } catch (e) {
        stats.errors++;
        stats.errorSample = stats.errorSample ?? String(e);
        ctx.log(`  post ${post.ID}: ${String(e).slice(0, 150)}`);
      }
    }

    return stats;
  },
};
