// TDS at booking (M5-10, RAD-158; ADR-009 §4, §7; ADR-010 §4): a bill's or expense's lines with a section each write a
// tds_deductions row with the posting, even one that deducts nothing, and the document posts the sum to TDS Payable. The
// year's sums come from those rows alone, one indexed read on (party, section, year). Two bookings for one payee take
// turns on the party's row (holdParty), so two bills can't both catch up the same year. A cancel writes the reversals.
import { accountsTx, parties, partyTds, tdsDeductions, tdsRates } from '@radcore/db/accounts';
import { dec, financialYear, roundMoney, type Money } from '@radcore/lib-common';
import { AppError, type Ctx } from '@radcore/lib-platform';
import { and, desc, eq, inArray, isNotNull, isNull, lte } from 'drizzle-orm';
import { tdsFor } from '../rules/tds.ts';
import { holdParty } from './parties.ts';
import type { setPartyTds } from '../contract-tds.ts';
import type { z } from 'zod';

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;

/** One line deducted under a section: its base (the taxable value, before GST, CA-19) and what's payable on it. */
export type TdsLine = Readonly<{ lineId: string; sectionId: string; base: string; payable: string; path: (string | number)[] }>;
const refuseAt = (code: string, message: string, path: (string | number)[]) => new AppError(code, message, [{ path, code, message }]);

/** PUT /parties/:id/tds: the party's TDS terms, replaced. */
export async function setTdsTerms(ctx: Ctx, t: In<typeof setPartyTds>): Promise<Out<typeof setPartyTds>> {
  const [p] = await accountsTx(ctx).select({ id: parties.id }).from(parties).where(eq(parties.id, t.id)).limit(1);
  if (p === undefined) throw new AppError('not_found', 'There’s no such party');
  const set = { defaultSectionId: t.defaultSectionId, panInoperative: t.panInoperative };
  await accountsTx(ctx).insert(partyTds).values({ partyId: t.id, ...set }).onConflictDoUpdate({ target: partyTds.partyId, set });
  return {};
}

/** A party's default section (ADR-009 §4), which a line takes unless it names another; null when none. */
export async function defaultTdsSection(ctx: Ctx, partyId: string | null): Promise<string | null> {
  if (partyId === null) return null;
  const [row] = await accountsTx(ctx).select({ id: partyTds.defaultSectionId }).from(partyTds).where(eq(partyTds.partyId, partyId)).limit(1);
  return row?.id ?? null;
}

/** Writes each line's deduction and answers what each deducts and their sum. Refuses a line with a section but no
 * supplier (`tds_needs_party`), an overseas supplier's (`tds_overseas`, ADR-010 §4: section 195 waits on the CA), and a
 * section with no rate in force on the date (`no_tds_rate`). Takes the party's row after the document's (ADR-009 §7). */
export async function bookTds(ctx: Ctx, doc: Readonly<{ table: string; id: string; partyId: string | null; businessDate: string }>,
  lines: readonly TdsLine[]): Promise<{ total: Money; byLine: Map<string, Money> }> {
  const byLine = new Map<string, Money>();
  if (lines.length === 0) return { total: roundMoney('0'), byLine };
  const first = lines[0]?.path ?? [];
  if (doc.partyId === null) throw refuseAt('tds_needs_party', 'Name the supplier to deduct TDS from', first);
  const tx = accountsTx(ctx);
  const [p] = await tx.select({ pan: parties.pan, overseas: parties.overseas, inoperative: partyTds.panInoperative }).from(parties)
    .leftJoin(partyTds, eq(partyTds.partyId, parties.id)).where(eq(parties.id, doc.partyId)).limit(1);
  if (p?.overseas === true) throw refuseAt('tds_overseas', 'An overseas supplier takes no TDS section until the CA rules on section 195', first);
  await holdParty(ctx, doc.partyId);
  const year = financialYear(doc.businessDate).start;
  const noPan = p?.pan == null || p.inoperative === true;
  let total = dec('0');
  for (const l of lines) {
    const [rate] = await tx.select().from(tdsRates).where(and(eq(tdsRates.sectionId, l.sectionId), lte(tdsRates.effectiveFrom, doc.businessDate)))
      .orderBy(desc(tdsRates.effectiveFrom)).limit(1);
    if (rate === undefined) throw refuseAt('no_tds_rate', 'This TDS section has no rate in force on the date', l.path);
    const rows = await tx.select({ id: tdsDeductions.id, base: tdsDeductions.base, rate: tdsDeductions.rate, amount: tdsDeductions.amount,
      reversesId: tdsDeductions.reversesId }).from(tdsDeductions)
      .where(and(eq(tdsDeductions.partyId, doc.partyId), eq(tdsDeductions.sectionId, l.sectionId), eq(tdsDeductions.financialYear, year)));
    const reversed = new Set(rows.flatMap((r) => (r.reversesId === null ? [] : [r.reversesId])));
    const earlier = rows.filter((r) => r.reversesId === null && !reversed.has(r.id)).map((r) => ({ base: r.base, rate: r.rate }));
    const deducted = rows.reduce((s, r) => s.plus(dec(r.amount)), dec('0'));
    const d = tdsFor({ base: l.base, rate: { rate: rate.rate, rateNoPan: rate.rateNoPan, singleLimit: rate.singleLimit, yearlyLimit: rate.yearlyLimit,
      limitKind: rate.limitKind === 'excess' ? 'excess' : 'whole' }, noPan, earlier, deducted: deducted.toFixed(2), payable: l.payable });
    await tx.insert(tdsDeductions).values({ sourceTable: doc.table, sourceId: doc.id, sourceLineId: l.lineId, partyId: doc.partyId, sectionId: l.sectionId,
      financialYear: year, businessDate: doc.businessDate, base: l.base, rate: d.rate, noPanRate: d.noPanRate, amount: d.amount });
    byLine.set(l.lineId, d.amount);
    total = total.plus(dec(d.amount));
  }
  return { total: roundMoney(total), byLine };
}

/** A cancelled booking's reversals (ADR-009 §4): each of its rows negated, naming the row it reverses, so the year's
 * sums leave it out. */
export async function reverseTds(ctx: Ctx, doc: Readonly<{ table: string; id: string; businessDate: string }>): Promise<void> {
  const tx = accountsTx(ctx);
  const rows = await tx.select().from(tdsDeductions).where(and(eq(tdsDeductions.sourceTable, doc.table), eq(tdsDeductions.sourceId, doc.id),
    isNull(tdsDeductions.reversesId)));
  if (rows.length === 0) return;
  const done = new Set((await tx.select({ id: tdsDeductions.reversesId }).from(tdsDeductions).where(and(isNotNull(tdsDeductions.reversesId),
    inArray(tdsDeductions.reversesId, rows.map((r) => r.id))))).map((r) => r.id));
  const todo = rows.filter((r) => !done.has(r.id));
  if (todo.length === 0) return;
  await tx.insert(tdsDeductions).values(todo.map((r) => ({ sourceTable: r.sourceTable, sourceId: r.sourceId, sourceLineId: r.sourceLineId,
    partyId: r.partyId, sectionId: r.sectionId, financialYear: r.financialYear, businessDate: doc.businessDate,
    base: roundMoney(dec(r.base).negated()), rate: r.rate, noPanRate: r.noPanRate, amount: roundMoney(dec(r.amount).negated()), reversesId: r.id })));
}
