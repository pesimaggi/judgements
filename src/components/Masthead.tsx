"use client";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { HelpDialog } from "./HelpDialog";
import { HelpIcon, SearchIcon } from "./icons";

/**
 * The masthead: the wordmark, the search box and the nav, on every page.
 *
 * The search box lives here rather than on the search page because it is the
 * way into the app from anywhere in it — reading an act and wanting the
 * judgments on a phrase should not mean going back first. Submitting always
 * lands on `/?q=…`, and the search page reads the query from there, so the
 * URL is the one place the current search is written down and a result page
 * can be linked, bookmarked and reloaded.
 */
function MastheadInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlQuery = searchParams.get("q") ?? "";

  const [query, setQuery] = useState(urlQuery);
  const [helpOpen, setHelpOpen] = useState(false);

  // The box follows the URL, not the other way round: Back, a tag link, or a
  // fresh visit all change `?q=`, and the box would otherwise keep showing
  // what was last typed into it.
  useEffect(() => setQuery(urlQuery), [urlQuery]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) {
      // An empty search is usually someone working out what the box is for.
      // Offered once, then never again — a dialog that reappears on every
      // stray Enter is worse than no dialog.
      try {
        if (!localStorage.getItem("logbrunnur.help.seen")) {
          localStorage.setItem("logbrunnur.help.seen", "1");
          setHelpOpen(true);
          return;
        }
      } catch {
        /* storage blocked — just run the search */
      }
    }
    router.push(query.trim() ? `/?q=${encodeURIComponent(query.trim())}` : "/");
  };

  const navLink = (href: string, label: string, active: boolean) => (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={
        active
          ? "border-b border-gold pb-0.5 font-medium text-white"
          : "text-[#B9C7D4] transition-colors hover:text-white"
      }
    >
      {label}
    </Link>
  );

  return (
    <>
      <header className="bg-ink text-white">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-[15px] lg:px-[30px]">
          <Link href="/" className="flex shrink-0 flex-col gap-[3px] whitespace-nowrap">
            <span className="font-heading text-[23px] font-medium leading-none text-white">
              Lögbrunnur
            </span>
            <span className="text-[9px] uppercase tracking-[.22em] text-gold">
              Réttarheimildasafn
            </span>
          </Link>

          <form onSubmit={onSubmit} className="order-last flex w-full flex-1 gap-2.5 lg:order-none lg:w-auto lg:max-w-[720px]">
            <div className="relative flex-1">
              <SearchIcon className="pointer-events-none absolute left-[13px] top-[11px] h-[17px] w-[17px] text-inkSoft" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Leitarorð"
                placeholder="Leitaðu að úrlausnum, lögum eða málsnúmeri"
                lang="is"
                className="w-full rounded-[3px] border border-inkSoft bg-white py-2.5 pl-[38px] pr-3.5 font-serif text-[15px] text-text placeholder:text-textMuted"
              />
            </div>
            <button
              type="submit"
              className="shrink-0 rounded-[3px] border border-gold px-[22px] text-sm font-medium text-white transition-colors hover:bg-[rgba(176,141,87,.18)]"
            >
              Leita
            </button>
          </form>

          <nav className="ml-auto flex items-center gap-5 text-[13px]">
            {navLink("/", "Úrlausnir", pathname === "/")}
            {navLink("/log", "Lög", pathname.startsWith("/log"))}
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent("logbrunnur:open-well"))}
              className="text-[#B9C7D4] transition-colors hover:text-white"
            >
              Brunnurinn AI
            </button>
            <button
              type="button"
              onClick={() => setHelpOpen(true)}
              className="inline-flex items-center gap-[7px] rounded-full border border-inkSoft py-1 pl-[9px] pr-3 text-white transition-colors hover:bg-[rgba(59,91,122,.35)]"
            >
              <HelpIcon className="h-3.5 w-3.5 text-gold" />
              Leiðbeiningar
            </button>
          </nav>
        </div>
      </header>

      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
    </>
  );
}

/**
 * Wrapped because `useSearchParams` opts a component out of static rendering
 * unless it sits under a Suspense boundary, and this one is in the layout of
 * every page — including the ones that are prerendered.
 */
export function Masthead() {
  return (
    <Suspense fallback={<MastheadFallback />}>
      <MastheadInner />
    </Suspense>
  );
}

/** The masthead without its search box: the same bar, before hydration. */
function MastheadFallback() {
  return (
    <header className="bg-ink text-white">
      <div className="flex items-center gap-x-6 px-4 py-[15px] lg:px-[30px]">
        <span className="flex flex-col gap-[3px]">
          <span className="font-heading text-[23px] font-medium leading-none text-white">
            Lögbrunnur
          </span>
          <span className="text-[9px] uppercase tracking-[.22em] text-gold">
            Réttarheimildasafn
          </span>
        </span>
      </div>
    </header>
  );
}
