// The books check (M2-07, RAD-95, ADR-006 §7, RC-063), across modules: lib-service is the lowest library that may read
// every side (ADR-001 §3, the architect on RAD-95). Each side is its own module's read: lib-stock's stock figures,
// lib-accounts' Goods Received Not Billed and Job Work Charges to be Billed balances, lib-purchasing's receipt lines and
// bills, and lib-stock's job-work charges. The route runs it in one REPEATABLE
// READ snapshot, so every figure is from the same moment; lib-stock's rules/books.ts compares them.
// shortcut: §7's GDNI and party comparisons, and serialised units, join as their own pieces (RAD-95).
import { systemBalance } from '@radcore/lib-accounts';
import { dec } from '@radcore/lib-common';
import type { Ctx } from '@radcore/lib-platform';
import { grniByReceiptLine, jwcbClearedByLine } from '@radcore/lib-purchasing';
import { booksProblems, jobWorkChargesByLine, stockBooksFigures } from '@radcore/lib-stock';
import type { checkBooksContract } from '@radcore/lib-stock/contract';
import type { z } from 'zod';

type In = z.output<(typeof checkBooksContract)['input']>;
type Out = z.input<(typeof checkBooksContract)['output']>;

/** GET /books/check: what disagrees, none when the books are healthy. */
export async function checkBooks(ctx: Ctx, { asAt }: In): Promise<Out> {
  const stock = await stockBooksFigures(ctx, asAt);
  const grni = await systemBalance(ctx, 'grni', asAt);
  const lines = await grniByReceiptLine(ctx, asAt);
  // Job Work Charges to be Billed: each job-work line's charge, less what bills cleared; a bill naming a line no receipt
  // counts shows as accrued 0, open below it.
  const jw = await systemBalance(ctx, 'jw_accrued', asAt);
  const charges = await jobWorkChargesByLine(ctx, asAt);
  const cleared = await jwcbClearedByLine(ctx, asAt);
  const accrued = new Map(charges.map((c) => [c.jobWorkLineId, dec(c.charge)]));
  const jwLines = [...new Set([...accrued.keys(), ...cleared.keys()])].map((jobWorkLineId) => {
    const a = accrued.get(jobWorkLineId) ?? dec('0');
    return { jobWorkLineId, accrued: a.toFixed(2), open: a.minus(dec(cleared.get(jobWorkLineId) ?? '0')).toFixed(2) };
  });
  return { problems: booksProblems({ ...stock, grni: { books: dec(grni.credit).minus(dec(grni.debit)).toString(), lines },
    jwcb: { books: dec(jw.credit).minus(dec(jw.debit)).toString(), lines: jwLines } }) };
}
