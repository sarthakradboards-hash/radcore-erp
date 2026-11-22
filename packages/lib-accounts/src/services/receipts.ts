// A receipt for printing (RAD-120, the architect's ruling): one posted receipt by its id, for the slip handed to the
// person who paid. Its number, date, who paid, the amount and how (the account it went into, and its reference: a
// card machine's approval code or a UPI UTR, never card digits), and what it was applied to. Never what the party still
// owes, which is receivables:read's (RC-042), and no contact details. A draft, a payment out or a refund isn't one.
import { accounts, accountsTx, parties, paymentAllocations, payments } from '@radcore/db/accounts';
import { vSalesDocumentRefs } from '@radcore/db/views';
import { dec, roundMoney, type Money } from '@radcore/lib-common';
import { AppError, type Ctx } from '@radcore/lib-platform';
import { and, asc, eq } from 'drizzle-orm';

export type ReceiptForPrint = {
  number: string; businessDate: string; partyName: string; amount: Money; tds: Money; account: string; reference: string | null;
  appliedTo: readonly { document: string; amount: Money }[];
};

export async function receiptForPrint(ctx: Ctx, id: string): Promise<ReceiptForPrint> {
  const tx = accountsTx(ctx);
  const [r] = await tx.select({ number: payments.number, businessDate: payments.businessDate, amount: payments.amount, tds: payments.tds,
    reference: payments.reference, partyName: parties.name, account: accounts.name }).from(payments)
    .innerJoin(parties, eq(parties.id, payments.partyId)).innerJoin(accounts, eq(accounts.id, payments.accountId))
    .where(and(eq(payments.id, id), eq(payments.kind, 'receipt'), eq(payments.status, 'posted'))).limit(1);
  if (r?.number == null) throw new AppError('not_found', 'There is no such receipt');
  const rows = await tx.select({ table: paymentAllocations.documentTable, id: paymentAllocations.documentId, direction: paymentAllocations.direction,
    amount: paymentAllocations.amount, number: vSalesDocumentRefs.number }).from(paymentAllocations)
    .leftJoin(vSalesDocumentRefs, and(eq(vSalesDocumentRefs.documentTable, paymentAllocations.documentTable),
      eq(vSalesDocumentRefs.documentId, paymentAllocations.documentId)))
    .where(eq(paymentAllocations.paymentId, id)).orderBy(asc(paymentAllocations.postedAt), asc(paymentAllocations.id));
  // Each document's applications less their reversals; one reversed in full isn't listed.
  const net = new Map<string, { document: string; amount: ReturnType<typeof dec> }>();
  for (const a of rows) {
    const key = `${a.table}:${a.id}`;
    const was = net.get(key) ?? { document: a.number ?? a.table, amount: dec('0') };
    net.set(key, { ...was, amount: a.direction === 'reverse' ? was.amount.minus(a.amount) : was.amount.plus(a.amount) });
  }
  return { number: r.number, businessDate: r.businessDate, partyName: r.partyName, amount: r.amount as Money, tds: r.tds as Money,
    account: r.account, reference: r.reference,
    appliedTo: [...net.values()].filter((a) => a.amount.gt(0)).map((a) => ({ document: a.document, amount: roundMoney(a.amount) })) };
}
