/**
 * PDF text extraction, in the one place every adapter goes through.
 *
 * It wraps pdf-parse for two reasons, both of them things a production log
 * made obvious.
 *
 * IT IS QUIET. pdf.js writes a line to stdout for every malformed byte it
 * meets, and the documents this corpus ingests are full of them: one ESA run
 * emitted "Warning: Ignoring invalid character "255" in hex string" thousands
 * of times per document. Railway caps a replica at 500 log lines a second and
 * drops the rest, so those runs dropped 8,596 lines — taking the adapters' own
 * error lines down with them. A warning nobody can act on, printed at a rate
 * that hides the messages somebody can, is worse than no warning at all.
 *
 * IT KNOWS A PDF WHEN IT SEES ONE. See looksLikePdf.
 */
import pdfParse from "pdf-parse";

/**
 * pdf.js writes its warnings with `console.log('Warning: ' + msg)`, and that
 * is the only place they can be caught.
 *
 * Its supported switch — `PDFJS.verbosity = 0` — silences the copy loaded in
 * this thread and not the one doing the work. pdf-parse runs pdf.js with
 * `disableWorker`, which loads the separate pdf.worker.js bundle in process;
 * that bundle keeps its own module-private verbosity level and exports only
 * `WorkerMessageHandler`, so there is no lever to reach it by. Setting the
 * documented switch and checking the log is what showed this: the warnings
 * carried on regardless.
 *
 * So the filter goes where the writing happens. Only pdf.js's own prefix is
 * dropped, only for the duration of a parse, and errors — which pdf.js writes
 * differently — are untouched.
 */
const PDFJS_WARNING = "Warning: ";

/** Parses in flight, so concurrent calls cannot restore console.log twice. */
let quietDepth = 0;
let realLog: typeof console.log | null = null;

function beginQuiet(): void {
  if (quietDepth++ > 0) return;
  realLog = console.log;
  const write = realLog;
  console.log = (...args: unknown[]) => {
    if (typeof args[0] === "string" && args[0].startsWith(PDFJS_WARNING)) return;
    write(...(args as []));
  };
}

function endQuiet(): void {
  if (--quietDepth > 0) return;
  if (realLog) console.log = realLog;
  realLog = null;
}

/**
 * True when these bytes are a PDF.
 *
 * Checked from the content rather than from the URL because the URL lies:
 * ESA's document database serves spreadsheets, slide decks and scanned e-mails
 * from its PDF endpoint under their original names (".XLS", ".PPT", ".JPG"),
 * and some with no name at all. Handing those to pdf-parse produces
 * "InvalidPDFException: Invalid PDF structure", which reads like a corrupt
 * download — a transient failure — and was recorded and re-fetched as one on
 * every run.
 *
 * The signature is searched for in the first kilobyte rather than required at
 * byte zero, which is what pdf.js itself tolerates: a real PDF may carry a
 * short preamble before "%PDF-".
 */
export function looksLikePdf(bytes: Buffer): boolean {
  return bytes.subarray(0, 1024).includes("%PDF-");
}

/** The text of a PDF, without pdf.js's per-byte warnings. */
export async function pdfText(bytes: Buffer): Promise<string> {
  beginQuiet();
  try {
    const { text } = await pdfParse(bytes);
    return text;
  } finally {
    endQuiet();
  }
}
