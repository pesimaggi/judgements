import type { Metadata } from "next";
import { Playfair_Display, Public_Sans, Source_Serif_4 } from "next/font/google";
import { Masthead } from "@/components/Masthead";
import { IngestionStatusLine } from "@/components/ProgressBars";
import { WellChat } from "@/components/WellChat";
import { isAskEnabled } from "@/lib/ask/llm";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { clerkConfigured } from "@/lib/auth/clerk";
import "./globals.css";

// Three faces doing three jobs: Playfair for the wordmark and anything that
// titles a document, Public Sans for controls and metadata, Source Serif for
// what was written by a court — the snippets, the summaries, the case
// numbers. The search box is set in the serif too, because what goes into it
// is the language of the documents rather than the language of the interface.
const sans = Public_Sans({ subsets: ["latin", "latin-ext"], variable: "--font-sans" });
const serif = Source_Serif_4({ subsets: ["latin", "latin-ext"], variable: "--font-serif" });
const heading = Playfair_Display({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600"],
  variable: "--font-heading",
});

export const metadata: Metadata = {
  title: "Lögbrunnur — réttarheimildasafn",
  description:
    "Óopinber leit í íslenskum dómum, úrskurðum, álitum og fræðiritum, ásamt EES- og ESB-rétti.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="is"
      className={`${sans.variable} ${serif.variable} ${heading.variable}`}
    >
      <body className="flex min-h-screen flex-col">
        <AuthProvider publishableKey={clerkConfigured() ? process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY! : null}>
        <Masthead />
        <div className="flex-1">{children}</div>
        <footer>
          <IngestionStatusLine />
          {/* BÍN's attribution is a condition of its licence (CC BY-SA 4.0), not
              a courtesy: the search index is lemmatised with it, so the credit
              belongs where every page carries it. See
              prisma/sql/setup-lemmas.sql. */}
          <p className="border-t border-line bg-paper px-4 py-3 text-[11px] leading-relaxed text-textMuted lg:px-[30px]">
            Íslensk beygingargreining í leitinni byggir á{" "}
            <a
              href="https://bin.arnastofnun.is/"
              className="underline hover:text-ink"
              target="_blank"
              rel="noreferrer"
            >
              Beygingarlýsingu íslensks nútímamáls
            </a>
            . Stofnun Árna Magnússonar í íslenskum fræðum. Höfundur og ritstjóri Kristín
            Bjarnadóttir. Notað með{" "}
            <a
              href="https://creativecommons.org/licenses/by-sa/4.0/"
              className="underline hover:text-ink"
              target="_blank"
              rel="noreferrer"
            >
              CC BY-SA 4.0
            </a>{" "}
            leyfi.
          </p>
        </footer>
        {/* Read on the server: with no API key the launcher is never rendered
            at all, rather than offered and then failing when it is clicked. */}
        <WellChat enabled={isAskEnabled()} />
        </AuthProvider>
      </body>
    </html>
  );
}
