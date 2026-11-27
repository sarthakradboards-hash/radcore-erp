// TDS sections and rates (M5-10, RAD-158; ADR-009 §4): read and set as GST's rates are (lib-gst's rates.ts). A row is
// never deleted: a later one supersedes, a wrong one is corrected in place, the reason kept by the handler.
import { accountsTx, after, tdsRates, tdsSections } from '@radcore/db/accounts';
import { decodeCursor, encodeCursor, type Ctx } from '@radcore/lib-platform';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { listTdsRates, listTdsSections, setTdsRate } from '../contract-tds.ts';

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;

/** GET /tds/sections. */
export async function tdsSectionsList(ctx: Ctx): Promise<Out<typeof listTdsSections>> {
  const rows = await accountsTx(ctx).select().from(tdsSections).orderBy(asc(tdsSections.code));
  return { items: rows.map((s) => ({ id: s.id, code: s.code, name: s.name, act2025: s.act2025, act1961: s.act1961, payee: s.payee as 'any' })) };
}

/** GET /tds/rates: by section code, then start date, then id. */
export async function tdsRatesPage(ctx: Ctx, input: In<typeof listTdsRates>): Promise<Out<typeof listTdsRates>> {
  const key = input.after === undefined ? undefined
    : decodeCursor(z.object({ code: z.string().max(20), from: z.iso.date(), id: z.uuid() }), input.after);
  const rows = await accountsTx(ctx).select({ r: tdsRates, code: tdsSections.code }).from(tdsRates)
    .innerJoin(tdsSections, eq(tdsSections.id, tdsRates.sectionId))
    .where(and(input.filter.sectionId === undefined ? undefined : eq(tdsRates.sectionId, input.filter.sectionId),
      after([tdsSections.code, tdsRates.effectiveFrom, tdsRates.id], key && [key.code, key.from, key.id], 'asc')))
    .orderBy(asc(tdsSections.code), asc(tdsRates.effectiveFrom), asc(tdsRates.id)).limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  return {
    items: page.map(({ r, code }) => ({ id: r.id, sectionId: r.sectionId, sectionCode: code, effectiveFrom: r.effectiveFrom, rate: r.rate as never,
      rateNoPan: r.rateNoPan as never, singleLimit: r.singleLimit as never, yearlyLimit: r.yearlyLimit as never, limitKind: r.limitKind as 'whole',
      source: r.source, note: r.note, confirmed: r.confirmed })),
    next: rows.length > input.limit && last ? encodeCursor({ code: last.code, from: last.r.effectiveFrom, id: last.r.id }) : null,
  };
}

/** PUT /tds/rates: a new row, or the same section and date corrected. */
export async function putTdsRate(ctx: Ctx, r: In<typeof setTdsRate>): Promise<Out<typeof setTdsRate>> {
  const set = { rate: r.rate, rateNoPan: r.rateNoPan, singleLimit: r.singleLimit, yearlyLimit: r.yearlyLimit, limitKind: r.limitKind,
    source: r.source, note: r.note, confirmed: r.confirmed };
  const [row] = await accountsTx(ctx).insert(tdsRates).values({ sectionId: r.sectionId, effectiveFrom: r.effectiveFrom, ...set })
    .onConflictDoUpdate({ target: [tdsRates.sectionId, tdsRates.effectiveFrom], set }).returning({ id: tdsRates.id });
  if (row === undefined) throw new Error('The rate was not saved');
  return row;
}
