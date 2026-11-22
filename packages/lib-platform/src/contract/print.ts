// Printouts (RAD-120, RC-152), re-exported by lib-platform's contract entry: a document's PDF, made by the server so
// the paper size is right and no browser header is on the page. Like every contract file it imports only zod and
// lib-common (D5).
import { defineContract, idString, pdfBytes } from '@radcore/lib-common';
import { z } from 'zod';

/** A4, and the 80 mm thermal roll (Sarthak, 22 Nov). 58 mm waits until the shop's printer is tried (A-6). */
export const PAPER_SIZES = ['a4', 'thermal80'] as const;
export type Paper = (typeof PAPER_SIZES)[number];

/**
 * A document's printout, declared in its module's contract (`lib-sales/src/contract/print.ts`): `GET <path>` with
 * `paper`, under the document's own read key and scope. The answer is the PDF, never kept, and each one is logged as a
 * look at `table`'s record. A document past 50 pages is refused `too_large`; `errors` are the document's own.
 */
export const printContract = <const E extends string = never>(path: string, perm: `${string}:${string}`, table: string,
  errors: readonly E[] = []) => defineContract({
  method: 'GET', path, auth: 'session', perm, tx: { readOnly: true, isolation: 'read committed' }, print: { table },
  input: z.object({ id: idString(), paper: z.enum(PAPER_SIZES) }), output: pdfBytes(), errors: ['too_large', ...errors],
});
