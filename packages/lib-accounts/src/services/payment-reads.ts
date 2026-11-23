// Receipts, payments and refunds as they're read (M3-12, RAD-116; for ui-2's RAD-126): a page of them, newest first,
// and one with what it's applied to. Under payments:read, an all-only key, as receipts:print: payments isn't a scoped
// table, so a role sees every one or none.
import { accounts, accountsTx, after, parties, paymentAllocations, payments } from '@radcore/db/accounts';
import { dec, roundMoney, sum } from '@radcore/lib-common';
import { AppError, decodeCursor, encodeCursor, momentKey, type Ctx } from '@radcore/lib-platform';
import { and, asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { getPaymentContract, listPaymentsContract } from '../contract.ts';
import { paymentUsed } from './allocations.ts';

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;
type Row = Out<typeof listPaymentsContract>['items'][number];

// Newest first: by date, then the moment each was recorded, then id.
const PAGE_KEY = z.object({ date: z.iso.date(), at: momentKey(), id: z.uuid() });
const columns = {
  id: payments.id, kind: payments.kind, status: payments.status, number: payments.number, partyId: payments.partyId, partyName: parties.name,
  businessDate: payments.businessDate, amount: payments.amount, tds: payments.tds, accountId: payments.accountId, accountName: accounts.name,
  reference: payments.reference, refundOf: payments.refundOfId, creditTable: payments.creditTable, creditId: payments.creditId,
  recordedAt: payments.createdAt, narration: payments.narration, cancelReason: payments.cancelReason,
};
const select = (ctx: Ctx) => accountsTx(ctx).select(columns).from(payments).innerJoin(parties, eq(parties.id, payments.partyId))
  .innerJoin(accounts, eq(accounts.id, payments.accountId));
const shown = (r: Awaited<ReturnType<ReturnType<typeof select>['execute']>>[number]): Row => ({
  id: r.id, kind: r.kind as Row['kind'], status: r.status as Row['status'], number: r.number, partyId: r.partyId, partyName: r.partyName,
  businessDate: r.businessDate, amount: roundMoney(r.amount), tds: roundMoney(r.tds), accountId: r.accountId, accountName: r.accountName,
  reference: r.reference, refundOf: r.refundOf, credit: r.creditTable === null || r.creditId === null ? null : { table: r.creditTable, id: r.creditId },
  recordedAt: r.recordedAt,
});

/** GET /payments (payments:read): newest first, a page at a time. */
export async function listPaymentsPage(ctx: Ctx, input: In<typeof listPaymentsContract>): Promise<Out<typeof listPaymentsContract>> {
  const key = input.after === undefined ? undefined : decodeCursor(PAGE_KEY, input.after);
  const rows = await select(ctx).where(and(
    input.filter.kind === undefined ? undefined : eq(payments.kind, input.filter.kind),
    input.filter.status === undefined ? undefined : eq(payments.status, input.filter.status),
    input.filter.partyId === undefined ? undefined : eq(payments.partyId, input.filter.partyId),
    after([payments.businessDate, payments.createdAt, payments.id], key && [key.date, key.at, key.id], 'desc'),
  )).orderBy(desc(payments.businessDate), desc(payments.createdAt), desc(payments.id)).limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  return {
    items: page.map(shown),
    next: rows.length > input.limit && last ? encodeCursor({ date: last.businessDate, at: last.recordedAt, id: last.id }) : null,
  };
}

/** GET /payments/:id (payments:read): one, with its live allocations
 * (each one applied and not reversed) and what's left of it after those and its posted refunds. */
export async function getPaymentById(ctx: Ctx, { id }: In<typeof getPaymentContract>): Promise<Out<typeof getPaymentContract>> {
  const [row] = await select(ctx).where(eq(payments.id, id)).limit(1);
  if (row === undefined) throw new AppError('not_found', 'There is no such payment');
  const tx = accountsTx(ctx);
  const applied = await tx.select({ id: paymentAllocations.id, documentTable: paymentAllocations.documentTable, documentId: paymentAllocations.documentId,
    amount: paymentAllocations.amount, businessDate: paymentAllocations.businessDate, direction: paymentAllocations.direction,
    reversesId: paymentAllocations.reversesId }).from(paymentAllocations).where(eq(paymentAllocations.paymentId, id))
    .orderBy(asc(paymentAllocations.businessDate), asc(paymentAllocations.postedAt), asc(paymentAllocations.id));
  const reversed = new Set(applied.flatMap((a) => (a.reversesId === null ? [] : [a.reversesId])));
  const live = applied.filter((a) => a.direction === 'apply' && !reversed.has(a.id));
  const used = await paymentUsed(ctx, id);
  return {
    ...shown(row), narration: row.narration, cancelReason: row.cancelReason,
    allocations: live.map((a) => ({ id: a.id, documentTable: a.documentTable, documentId: a.documentId, amount: roundMoney(a.amount),
      businessDate: a.businessDate })),
    allocated: roundMoney(used.allocated), refunded: roundMoney(used.refunded),
    left: roundMoney(dec(row.amount).minus(sum([used.allocated, used.refunded]))),
  };
}
