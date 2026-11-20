// Allocations and credit applications (M3-12, RAD-116 part 2; ADR-005 §7a, the architect's ruling). A receipt or
// payment is applied to documents another module owns, named by table and id; a credit to a charge on its side. What
// lib-accounts can say first, it says first: the payment's kind, that it's posted, and its own cap. The document's
// side, party, status and total are another module's, so the database checks them at commit (RA006), each rule by its
// constraint name, which the route's contract maps to a code (ADR-005 §9). A mistake is undone by a reverse row.
import { accountsTx, creditApplications, paymentAllocations, payments } from '@radcore/db/accounts';
import { vDocumentPaid } from '@radcore/db/views';
import { dec, roundMoney, sum, type Money } from '@radcore/lib-common';
import { AppError, type Ctx } from '@radcore/lib-platform';
import { and, eq, inArray } from 'drizzle-orm';
import type { z } from 'zod';
import type {
  allocatePaymentContract, applyCreditContract, reverseAllocationContract, reverseCreditApplicationContract,
} from '../contract.ts';

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;

const refuse = (code: string, message: string): never => { throw new AppError(code, message); };
const net = (rows: readonly { direction: string; amount: string }[]) =>
  sum(rows.map((r) => (r.direction === 'apply' ? r.amount : dec(r.amount).neg())));

/** What a payment has used: its net allocations and its posted refunds, which share its amount (gross of TDS, F8). */
export async function paymentUsed(ctx: Ctx, paymentId: string) {
  const tx = accountsTx(ctx);
  const applied = await tx.select({ direction: paymentAllocations.direction, amount: paymentAllocations.amount }).from(paymentAllocations)
    .where(eq(paymentAllocations.paymentId, paymentId));
  const refunded = await tx.select({ amount: payments.amount }).from(payments)
    .where(and(eq(payments.refundOfId, paymentId), eq(payments.status, 'posted')));
  return { allocated: net(applied), refunded: sum(refunded.map((r) => r.amount)) };
}

/** POST /payments/:id/allocations: applies a posted receipt or payment to documents, within what's left of it. */
export async function allocatePayment(ctx: Ctx, a: In<typeof allocatePaymentContract>): Promise<Out<typeof allocatePaymentContract>> {
  const tx = accountsTx(ctx);
  const [p] = await tx.select().from(payments).where(eq(payments.id, a.id)).limit(1).for('update');
  if (p === undefined) return refuse('not_found', 'There’s no such payment');
  if (p.kind === 'refund') refuse('not_allocatable', 'A refund pays a receipt back; it isn’t applied to documents');
  if (p.status !== 'posted') refuse('not_posted', 'Only a posted payment is applied');
  const { allocated, refunded } = await paymentUsed(ctx, p.id);
  if (allocated.plus(refunded).plus(sum(a.lines.map((l) => l.amount))).gt(p.amount)) {
    refuse('exceeds_payment', 'That’s more than is left of the payment');
  }
  const rows = await tx.insert(paymentAllocations).values(a.lines.map((l) => ({ paymentId: p.id, documentTable: l.documentTable,
    documentId: l.documentId, direction: 'apply', amount: l.amount }))).returning({ id: paymentAllocations.id });
  return { ids: rows.map((r) => r.id) };
}

/** POST /allocations/:id/reverse: undoes one apply, whole, once. */
export async function reverseAllocation(ctx: Ctx, { id }: In<typeof reverseAllocationContract>): Promise<Out<typeof reverseAllocationContract>> {
  const tx = accountsTx(ctx);
  const [row] = await tx.select().from(paymentAllocations).where(and(eq(paymentAllocations.id, id), eq(paymentAllocations.direction, 'apply')))
    .limit(1);
  if (row === undefined) return refuse('not_found', 'There’s no such allocation');
  const [reversal] = await tx.insert(paymentAllocations).values({ paymentId: row.paymentId, documentTable: row.documentTable,
    documentId: row.documentId, direction: 'reverse', amount: row.amount, reversesId: row.id }).returning({ id: paymentAllocations.id });
  return { id: reversal?.id ?? refuse('server_error', 'The reversal was not stored') };
}

/** POST /credit-applications: applies a posted credit to a posted charge on its side, of its party (all checked at
 * commit, by name). */
export async function applyCredit(ctx: Ctx, c: In<typeof applyCreditContract>): Promise<Out<typeof applyCreditContract>> {
  const [row] = await accountsTx(ctx).insert(creditApplications).values({ creditTable: c.creditTable, creditId: c.creditId,
    documentTable: c.documentTable, documentId: c.documentId, direction: 'apply', amount: c.amount }).returning({ id: creditApplications.id });
  return { id: row?.id ?? refuse('server_error', 'The credit application was not stored') };
}

/** POST /credit-applications/:id/reverse: undoes one credit application, whole, once. */
export async function reverseCreditApplication(ctx: Ctx, { id }: In<typeof reverseCreditApplicationContract>):
  Promise<Out<typeof reverseCreditApplicationContract>> {
  const tx = accountsTx(ctx);
  const [row] = await tx.select().from(creditApplications)
    .where(and(eq(creditApplications.id, id), eq(creditApplications.direction, 'apply'))).limit(1);
  if (row === undefined) return refuse('not_found', 'There’s no such credit application');
  const [reversal] = await tx.insert(creditApplications).values({ creditTable: row.creditTable, creditId: row.creditId,
    documentTable: row.documentTable, documentId: row.documentId, direction: 'reverse', amount: row.amount, reversesId: row.id })
    .returning({ id: creditApplications.id });
  return { id: reversal?.id ?? refuse('server_error', 'The reversal was not stored') };
}

/** For a document's owner (lib-sales for invoices): what has been paid against each of these, allocated and credited.
 * The owner subtracts `paid` from its own `total`; a document with nothing applied isn't in the map. */
export async function paidOf(ctx: Ctx, documentTable: string, ids: readonly string[]):
  Promise<ReadonlyMap<string, { allocated: Money; credited: Money; paid: Money }>> {
  if (ids.length === 0) return new Map();
  const rows = await accountsTx(ctx).select().from(vDocumentPaid)
    .where(and(eq(vDocumentPaid.documentTable, documentTable), inArray(vDocumentPaid.documentId, [...ids])));
  return new Map(rows.map((r) => [r.documentId ?? '', { allocated: roundMoney(r.allocated ?? '0'), credited: roundMoney(r.credited ?? '0'),
    paid: roundMoney(r.paid ?? '0') }]));
}
