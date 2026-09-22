"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { HelpDialog } from "./HelpDialog";
import { HelpIcon } from "./icons";

/**
 * The masthead: the wordmark and the nav, on every page.
 *
 * The search box is not here. It was, briefly, and it read as a site-wide
 * utility bar disconnected from the sources and dates that narrow it — so it
 * moved down into the page, level with Heimildir, where the three controls
 * that make up one question sit together. What stayed is the URL: the search
 * page keeps its query in `?q=`, so a result page can still be linked,
 * bookmarked and reloaded.
 */
export function Masthead() {
  const pathname = usePathname();
  const [helpOpen, setHelpOpen] = useState(false);

  // The search page asks for the dialog the first time somebody submits an
  // empty query. An event rather than lifted state, because the dialog
  // belongs to the masthead and the search box no longer does.
  useEffect(() => {
    const open = () => setHelpOpen(true);
    window.addEventListener("logbrunnur:open-help", open);
    return () => window.removeEventListener("logbrunnur:open-help", open);
  }, []);

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
