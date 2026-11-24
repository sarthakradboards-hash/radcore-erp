// The books check (M2-07, RAD-95, ADR-006 §7, RC-063), across modules: lib-service is the lowest library that may read
// every side (ADR-001 §3, the architect on RAD-95). Each side is its own module's read: lib-stock's stock figures,
// lib-accounts' Goods Received Not Billed balance and lib-purchasing's receipt lines. The route runs it in one REPEATABLE
// READ snapshot, so every figure is from the same moment; lib-stock's rules/books.ts compares them.
// shortcut: §7's GDNI, job-work and party comparisons, and serialised units, join as their own pieces (RAD-95).
import { systemBalance } from '@radcore/lib-accounts';
import { dec } from '@radcore/lib-common';
import type { Ctx } from '@radcore/lib-platform';
import { grniByReceiptLine } from '@radcore/lib-purchasing';
import { booksProblems, stockBooksFigures } from '@radcore/lib-stock';
import type { checkBooksContract } from '@radcore/lib-stock/contract';
import type { z } from 'zod';

type In = z.output<(typeof checkBooksContract)['input']>;
type Out = z.input<(typeof checkBooksContract)['output']>;

/** GET /books/check: what disagrees, none when the books are healthy. */
export async function checkBooks(ctx: Ctx, { asAt }: In): Promise<Out> {
  const stock = await stockBooksFigures(ctx, asAt);
  const grni = await systemBalance(ctx, 'grni', asAt);
  const lines = await grniByReceiptLine(ctx, asAt);
  return { problems: booksProblems({ ...stock, grni: { books: dec(grni.credit).minus(dec(grni.debit)).toString(), lines } }) };
}
