import type { Metadata } from "next";
import { Inter, Source_Serif_4 } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const sans = Inter({ subsets: ["latin", "latin-ext"], variable: "--font-sans" });
const serif = Source_Serif_4({ subsets: ["latin", "latin-ext"], variable: "--font-serif" });

export const metadata: Metadata = {
  title: "Lögbrunnur — Icelandic court judgment search",
  description:
    "Unofficial search across Icelandic court judgments (Hæstiréttur, Landsréttur, Héraðsdómar), sourced from island.is.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="is" className={`${sans.variable} ${serif.variable}`}>
      <body>
        <header className="border-b border-line bg-white">
          <div className="mx-auto flex max-w-7xl items-baseline justify-between px-4 py-3">
            <Link href="/" className="flex items-baseline gap-3">
              <span className="font-serif text-2xl font-semibold tracking-tight">Lögbrunnur</span>
              <span className="hidden text-xs text-inkSoft sm:inline">
                Icelandic court judgment search
              </span>
            </Link>
            <nav className="flex items-center gap-4 text-sm">
              <Link href="/admin/ingestion" className="text-inkSoft hover:text-ink">
                Ingestion status
              </Link>
            </nav>
          </div>
          <div className="border-t border-line bg-paper">
            <p className="mx-auto max-w-7xl px-4 py-1.5 text-[11px] text-inkSoft">
              This is an unofficial research tool. Always verify text against the official source.
            </p>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
