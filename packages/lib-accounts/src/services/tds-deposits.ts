// TDS deposits (M5-10, RAD-158; ADR-009 §4, §7, F18): a challan paid from a bank account pays the deductions it names,
// each in full and once, and posts Dr TDS Payable, Cr the bank. Its payees' rows are held while it's paid, so a cancel of
// one of its bookings (reverseTds, which holds the same row) can't reverse it at the same moment.
//   locks (ADR-009 §7): the period FOR SHARE → the payees' party rows, by id → the series, the journal's first
import { accountsTx, after, tdsDeductions, tdsDepositLines, tdsDeposits } from '@radcore/db/accounts';
import { dec, indiaDate, roundMoney } from '@radcore/lib-common';
import { AppError, decodeCursor, defineSeries, encodeCursor, holdSeries, nextNumber, type Ctx } from '@radcore/lib-platform';
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, not } from 'drizzle-orm';
import { z } from 'zod';
import type { listTdsDeductions, recordTdsDeposit } from '../contract-tds.ts';
import { holdPeriod, JOURNAL_SERIES, postEntry } from './journal.ts';
import { holdParty } from './parties.ts';
import { moneyAccount } from './payments.ts';

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;

/** TDS deposits' numbers: TD/YY-YY/NNNN. */
export const TDS_DEPOSIT_SERIES = defineSeries('accounts.tds_deposit', 'TD', { label: 'TDS deposits' });
const refuseAt = (code: string, message: string, path: (string | number)[]) => new AppError(code, message, [{ path, code, message }]);

/** POST /tds/deposits. */
export async function depositTds(ctx: Ctx, d: In<typeof recordTdsDeposit>): Promise<Out<typeof recordTdsDeposit>> {
  if (d.businessDate > indiaDate(new Date())) throw refuseAt('date_in_future', 'The date is after today', ['businessDate']);
  await holdPeriod(ctx, d.businessDate);
  if ((await moneyAccount(ctx, d.accountId)).cash) throw refuseAt('not_bank_account', 'TDS is deposited from a bank account', ['accountId']);
  const tx = accountsTx(ctx);
  // Each payee's row, by id, as bookings and cancels take it: the deductions themselves are append-only, so not
  // row-locked. A cancel of one of these bookings waits, then sees it deposited.
  const which = inArray(tdsDeductions.id, [...d.deductionIds]);
  for (const p of [...new Set((await tx.select({ partyId: tdsDeductions.partyId }).from(tdsDeductions).where(which)).map((r) => r.partyId))].sort()) {
    await holdParty(ctx, p);
  }
  const rows = await tx.select().from(tdsDeductions).where(which).orderBy(asc(tdsDeductions.id));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const reversed = new Set((await tx.select({ id: tdsDeductions.reversesId }).from(tdsDeductions)
    .where(and(isNotNull(tdsDeductions.reversesId), inArray(tdsDeductions.reversesId, [...d.deductionIds])))).map((r) => r.id));
  const paid = new Set((await tx.select({ id: tdsDepositLines.deductionId }).from(tdsDepositLines)
    .where(inArray(tdsDepositLines.deductionId, [...d.deductionIds]))).map((r) => r.id));
  for (const [n, id] of d.deductionIds.entries()) {
    const r = byId.get(id);
    const at = ['deductionIds', n];
    if (r === undefined) throw refuseAt('unknown_deduction', 'There’s no such TDS deduction', at);
    if (r.reversesId !== null || reversed.has(id)) throw refuseAt('deduction_reversed', 'This deduction’s booking was cancelled', at);
    if (!dec(r.amount).gt(0)) throw refuseAt('nothing_to_deposit', 'This booking deducted nothing', at);
    if (paid.has(id)) throw refuseAt('already_deposited', 'This deduction is already deposited', at);
  }
  const amount = roundMoney(rows.reduce((s, r) => s.plus(dec(r.amount)), dec('0')));
  await holdSeries(ctx, [JOURNAL_SERIES, TDS_DEPOSIT_SERIES]);
  const number = await nextNumber(ctx, TDS_DEPOSIT_SERIES, d.businessDate);
  const [row] = await tx.insert(tdsDeposits).values({ number, businessDate: d.businessDate, challanNumber: d.challanNumber, bsrCode: d.bsrCode,
    accountId: d.accountId, amount }).returning({ id: tdsDeposits.id });
  const id = row?.id ?? '';
  await tx.insert(tdsDepositLines).values(d.deductionIds.map((deductionId) => ({ depositId: id, deductionId })));
  const entry = await postEntry(ctx, { kind: 'tds_deposit', businessDate: d.businessDate, source: { table: 'tds_deposits', id },
    lines: [{ account: { system: 'tds_payable' }, debit: amount }, { account: { id: d.accountId }, credit: amount }] });
  await tx.update(tdsDeposits).set({ postedEntryId: entry.id }).where(eq(tdsDeposits.id, id));
  return { id, number };
}

const PAGE_KEY = z.object({ date: z.iso.date(), id: z.uuid() });
/** GET /tds/deductions: newest business date first, then id. */
export async function tdsDeductionsPage(ctx: Ctx, input: In<typeof listTdsDeductions>): Promise<Out<typeof listTdsDeductions>> {
  const key = input.after === undefined ? undefined : decodeCursor(PAGE_KEY, input.after);
  const tx = accountsTx(ctx);
  // The rows a reversal names: an uncorrelated subquery, so the table needs no alias.
  const reversed = tx.select({ id: tdsDeductions.reversesId }).from(tdsDeductions).where(isNotNull(tdsDeductions.reversesId));
  const rows = await tx.select({ d: tdsDeductions, deposited: tdsDepositLines.depositId }).from(tdsDeductions)
    .leftJoin(tdsDepositLines, eq(tdsDepositLines.deductionId, tdsDeductions.id))
    .where(and(
      input.filter.open === true ? and(isNull(tdsDeductions.reversesId), gt(tdsDeductions.amount, '0'), isNull(tdsDepositLines.depositId),
        not(inArray(tdsDeductions.id, reversed))) : undefined,
      after([tdsDeductions.businessDate, tdsDeductions.id], key && [key.date, key.id], 'desc'),
    )).orderBy(desc(tdsDeductions.businessDate), desc(tdsDeductions.id)).limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  return { items: page.map(({ d, deposited }) => ({ id: d.id, sourceTable: d.sourceTable, sourceId: d.sourceId, partyId: d.partyId, sectionId: d.sectionId,
    businessDate: d.businessDate, base: d.base, rate: d.rate, amount: roundMoney(d.amount), deposited: deposited !== null })),
    next: rows.length > input.limit && last ? encodeCursor({ date: last.d.businessDate, id: last.d.id }) : null };
}
