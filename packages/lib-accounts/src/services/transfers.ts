// Transfers between the company's own money accounts (RAD-165's first PR; the architect on RAD-168; ADR-006 §6, F19):
// cash paid into the bank, one bank to another. Posted as it's recorded, in ADR-006 §1's order: the period FOR SHARE,
// then the transfer's own row, then the series, the journal's first, then `accounts.transfer`.
//   record: both money accounts, not the same -> draft row -> entry `transfer` (Dr to, Cr from) -> number -> posted
//   cancel: the period, the row FOR UPDATE -> the entry mirrored, dated that day -> cancelled
// shortcut: M5-13 adds the `bank_matched` refusal to the cancel once statement lines can be matched.
import { accounts, accountsTx, after, transfers } from '@radcore/db/accounts';
import { dec, indiaDate, roundMoney } from '@radcore/lib-common';
import { AppError, decodeCursor, defineSeries, encodeCursor, isoMoment, momentKey, nextNumber, principalId, type Ctx } from '@radcore/lib-platform';
import { and, desc, eq, inArray, or } from 'drizzle-orm';
import { z } from 'zod';
import type { cancelTransferContract, getTransferContract, listTransfersContract, recordTransferContract } from '../contract-transfers.ts';
import { holdPeriod, postEntry, reverseEntry } from './journal.ts';
import { refuseIfMatched } from './bank-matching.ts';
import { moneyAccount } from './payments.ts';

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;
const refuse = (code: string, message: string): never => { throw new AppError(code, message); };
const today = () => indiaDate(new Date());

/** A transfer's numbering series (RAD-87): "TR/26-27/00001". */
export const TRANSFER_SERIES = defineSeries('accounts.transfer', 'TR', { label: 'Transfers between own accounts' });

/** POST /transfers: checked, then posted at once (F19). */
export async function recordTransfer(ctx: Ctx, t: In<typeof recordTransferContract>): Promise<Out<typeof recordTransferContract>> {
  if (!dec(t.amount).gt(0)) refuse('amount_not_positive', 'Enter an amount above 0');
  if (t.fromAccountId === t.toAccountId) refuse('same_account', 'Move money from one account to another one');
  if (t.businessDate > today()) refuse('date_in_future', 'The date is after today');
  await holdPeriod(ctx, t.businessDate);
  await moneyAccount(ctx, t.fromAccountId);
  await moneyAccount(ctx, t.toAccountId);
  const tx = accountsTx(ctx);
  const [row] = await tx.insert(transfers).values({ businessDate: t.businessDate, fromAccountId: t.fromAccountId, toAccountId: t.toAccountId,
    amount: roundMoney(t.amount), reference: t.reference ?? null, notes: t.notes ?? null }).returning({ id: transfers.id });
  if (row === undefined) throw new Error('The transfer was not saved');
  const entry = await postEntry(ctx, { kind: 'transfer', businessDate: t.businessDate, source: { table: 'transfers', id: row.id },
    lines: [{ account: { id: t.toAccountId }, debit: roundMoney(t.amount) }, { account: { id: t.fromAccountId }, credit: roundMoney(t.amount) }] });
  const number = await nextNumber(ctx, TRANSFER_SERIES, t.businessDate);
  await tx.update(transfers).set({ status: 'posted', number, postedEntryId: entry.id }).where(eq(transfers.id, row.id));
  return { id: row.id, number };
}

/** POST /transfers/:id/cancel: the period first, then the row (ADR-006 §1), then the mirror, dated `businessDate`. */
export async function cancelTransfer(ctx: Ctx, c: In<typeof cancelTransferContract>): Promise<Out<typeof cancelTransferContract>> {
  if (c.businessDate > today()) refuse('date_in_future', 'The date is after today');
  await holdPeriod(ctx, c.businessDate);
  const tx = accountsTx(ctx);
  const [t] = await tx.select().from(transfers).where(eq(transfers.id, c.id)).limit(1).for('update');
  if (t === undefined) return refuse('not_found', 'There’s no such transfer');
  if (t.status !== 'posted' || t.postedEntryId === null) return refuse('not_posted', 'Only a posted transfer is cancelled');
  if (c.businessDate < t.businessDate) refuse('date_before_source', 'A cancellation is dated on or after what it cancels');
  // Matched to the bank statement: unmatch first (ADR-009 §12). The row is held FOR UPDATE, so a match waits or is seen.
  await refuseIfMatched(ctx, t.postedEntryId);
  const mirror = await reverseEntry(ctx, { entryId: t.postedEntryId, businessDate: c.businessDate, reason: c.reason });
  await tx.update(transfers).set({ status: 'cancelled', cancelledAt: new Date(), cancelledBy: principalId(ctx.principal), cancelReason: c.reason,
    cancelEntryId: mirror.id }).where(eq(transfers.id, t.id));
  return {};
}

const columns = {
  id: transfers.id, status: transfers.status, number: transfers.number, businessDate: transfers.businessDate, fromId: transfers.fromAccountId,
  toId: transfers.toAccountId, amount: transfers.amount, reference: transfers.reference, notes: transfers.notes, recordedAt: transfers.createdAt,
  cancelReason: transfers.cancelReason,
};
const select = (ctx: Ctx) => accountsTx(ctx).select(columns).from(transfers);
type Row = Awaited<ReturnType<ReturnType<typeof select>['execute']>>[number];

/** How to answer each row, with both accounts' names in one read. */
async function shownOf(ctx: Ctx, rows: readonly Row[]) {
  const ids = [...new Set(rows.flatMap((r) => [r.fromId, r.toId]))];
  const names = new Map(ids.length === 0 ? [] : (await accountsTx(ctx).select({ id: accounts.id, name: accounts.name }).from(accounts)
    .where(inArray(accounts.id, ids))).map((a) => [a.id, a.name]));
  return (r: Row) => ({
    id: r.id, status: r.status === 'cancelled' ? 'cancelled' as const : 'posted' as const, number: r.number ?? '', businessDate: r.businessDate,
    from: { id: r.fromId, name: names.get(r.fromId) ?? '' }, to: { id: r.toId, name: names.get(r.toId) ?? '' }, amount: roundMoney(r.amount),
    reference: r.reference, notes: r.notes, recordedAt: isoMoment(r.recordedAt),
  });
}

// Newest first: by date, then the moment each was recorded (its microseconds kept, momentKey), then id.
const PAGE_KEY = z.object({ date: z.iso.date(), at: momentKey(), id: z.uuid() });

/** GET /transfers: posted and cancelled ones (a draft lives only inside its own save), newest first. */
export async function transfersPage(ctx: Ctx, input: In<typeof listTransfersContract>): Promise<Out<typeof listTransfersContract>> {
  const key = input.after === undefined ? undefined : decodeCursor(PAGE_KEY, input.after);
  const account = input.filter.accountId;
  const rows = await select(ctx).where(and(
    account === undefined ? undefined : or(eq(transfers.fromAccountId, account), eq(transfers.toAccountId, account)),
    after([transfers.businessDate, transfers.createdAt, transfers.id], key && [key.date, key.at, key.id], 'desc'),
  )).orderBy(desc(transfers.businessDate), desc(transfers.createdAt), desc(transfers.id)).limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  return { items: page.map(await shownOf(ctx, page)), next: rows.length > input.limit && last ? encodeCursor({ date: last.businessDate, at: last.recordedAt, id: last.id }) : null };
}

/** GET /transfers/:id. */
export async function transferById(ctx: Ctx, { id }: In<typeof getTransferContract>): Promise<Out<typeof getTransferContract>> {
  const [row] = await select(ctx).where(eq(transfers.id, id)).limit(1);
  if (row === undefined || row.status === 'draft') return refuse('not_found', 'There’s no such transfer');
  return { ...(await shownOf(ctx, [row]))(row), cancelReason: row.cancelReason };
}
