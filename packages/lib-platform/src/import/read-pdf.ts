// Reading an uploaded PDF's text (M5-11, RAD-159; ADR-003 §2, §7; RC-135): only in the worker, and there only in
// pdf-thread.ts's worker thread, never in the api. unpdf (pdf.js bundled) gives each page's text items with their positions;
// they're grouped into lines, top of the page first, each line's pieces left to right with where they start, so a
// bank's layout (lib-accounts) can tell a withdrawal column from a deposit one even where a cell is empty.
import { extractTextItems, getDocumentProxy } from 'unpdf';
import { ImportFileError, PDF_LIMITS } from './read.ts';

/** One line of a page: its pieces of text, left to right, each with its x position (PDF units from the left edge). */
export type PdfLine = readonly { readonly text: string; readonly x: number }[];
/** Every page's lines, top first. */
export type PdfPages = readonly (readonly PdfLine[])[];

// Pieces whose baselines are this close (PDF units) sit on one line.
const SAME_LINE = 2;

/** A page's text items as lines: by baseline, top first, then left to right; empty pieces dropped. */
export function linesOf(items: readonly { str: string; x: number; y: number }[]): PdfLine[] {
  const lines: { y: number; pieces: { text: string; x: number }[] }[] = [];
  for (const item of items.filter((i) => i.str.trim() !== '').toSorted((a, b) => b.y - a.y || a.x - b.x)) {
    const line = lines.find((l) => Math.abs(l.y - item.y) <= SAME_LINE);
    if (line === undefined) lines.push({ y: item.y, pieces: [{ text: item.str.trim(), x: item.x }] });
    else line.pieces.push({ text: item.str.trim(), x: item.x });
  }
  return lines.map((l) => l.pieces.toSorted((a, b) => a.x - b.x));
}

/** Reads a PDF's text as lines, refusing one past 200 pages, a password-protected one, and one pdf.js can't open. In
 * this thread: callers use isolate.ts's readPdf, which runs this in pdf-thread.ts's worker.
 * shortcut: a password-protected statement is refused; the bank account's stored statement password (ADR-009 §11,
 * `secrets`) joins when a bank that sends one is set up. */
export async function parsePdf(bytes: Uint8Array): Promise<PdfPages> {
  let doc: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    // A copy: pdf.js takes the buffer it's given. Eval off (ADR-003 §2's row): unpdf passes the option on to pdf.js
    // though its types don't name it, and its bundled build has no eval path besides.
    doc = await getDocumentProxy(new Uint8Array(bytes), { isEvalSupported: false } as Parameters<typeof getDocumentProxy>[1]);
  } catch (e) {
    if ((e as { name?: string }).name === 'PasswordException') {
      throw new ImportFileError('The PDF is password-protected. Download the statement without a password, or as CSV or Excel.');
    }
    throw new ImportFileError("The PDF couldn't be read. Download the statement again, or as CSV or Excel.");
  }
  // The worker thread ends with the read, and its memory with it (isolate.ts), so the document isn't closed here.
  if (doc.numPages > PDF_LIMITS.maxPages) {
    throw new ImportFileError(`The PDF has more than ${PDF_LIMITS.maxPages} pages. Download a shorter period and import each part.`);
  }
  const { items } = await extractTextItems(doc);
  return items.map(linesOf);
}
