// GST rates by date (M2-12, RAD-91; ADR-001 §5: lib-gst's). Rates come from our own table, built from the official
// notifications (RAD-81: no GST package or its data). The rule for which row applies (RC-115) is gstRateFor's.
import { after, gstRates, gstTx } from '@radcore/db/gst';
import { dec } from '@radcore/lib-common';
import { AppError, decodeCursor, encodeCursor, type Ctx } from '@radcore/lib-platform';
import { and, asc, desc, inArray, like, lte } from 'drizzle-orm';
import { z } from 'zod';
import type { getGstRateInForce, listGstRates, setGstRate } from '../contract.ts';
import { prefixesOf, rowInForce } from '../rules/rates.ts';

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;

const columns = {
  id: gstRates.id, hsn: gstRates.hsn, effectiveFrom: gstRates.effectiveFrom, rate: gstRates.rate, source: gstRates.source, note: gstRates.note,
  supplyKind: gstRates.supplyKind,
};

/**
 * The rate an item with HSN `hsn` takes on date `on` (RC-115): of the rows for any of its codes (its chapter, heading,
 * sub-heading or itself) that started on or before `on`, the newest start wins, so a newer short code beats an older
 * long one; a longer code breaks a tie on the same start. No row answers `no_gst_rate`, never 0%. Every document that
 * charges GST asks this for each line, on its business date.
 */
export async function gstRateFor(ctx: Ctx, hsn: string, on: string): Promise<Out<typeof getGstRateInForce>> {
  const rows = await gstTx(ctx).select(columns).from(gstRates)
    .where(and(inArray(gstRates.hsn, prefixesOf(hsn)), lte(gstRates.effectiveFrom, on))).orderBy(desc(gstRates.effectiveFrom));
  const row = rowInForce(rows);
  if (row === undefined) throw new AppError('no_gst_rate', `No GST rate covers HSN ${hsn} on ${on}: add it from its notification`);
  return row;
}

/** GET /gst/rates/in-force. */
export const rateInForce = (ctx: Ctx, { hsn, on }: In<typeof getGstRateInForce>) => gstRateFor(ctx, hsn, on);

/** GET /gst/rates: by HSN, then start, then id, so a page key is unique and paging never skips or repeats. */
export async function listRatesPage(ctx: Ctx, input: In<typeof listGstRates>): Promise<Out<typeof listGstRates>> {
  const key = input.after === undefined ? undefined
    : decodeCursor(z.object({ hsn: z.string().max(8), from: z.iso.date(), id: z.uuid() }), input.after);
  const { hsn } = input.filter;
  const rows = await gstTx(ctx).select(columns).from(gstRates)
    .where(and(hsn === undefined ? undefined : like(gstRates.hsn, `${hsn}%`),
      after([gstRates.hsn, gstRates.effectiveFrom, gstRates.id], key && [key.hsn, key.from, key.id], 'asc')))
    .orderBy(asc(gstRates.hsn), asc(gstRates.effectiveFrom), asc(gstRates.id)).limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  return { items: page, next: rows.length > input.limit && last ? encodeCursor({ hsn: last.hsn, from: last.effectiveFrom, id: last.id }) : null };
}

/** PUT /gst/rates (gst:write): a new row, or the same code and date corrected. The reason was kept by the handler. */
export async function putGstRate(ctx: Ctx, { hsn, effectiveFrom, rate, source, note, supplyKind }: In<typeof setGstRate>): Promise<Out<typeof setGstRate>> {
  // A 0% rate is nil-rated unless it's named exempt or non-GST (ADR-010 §2); the CHECK holds the pair.
  const kind = supplyKind ?? (dec(rate).gt(0) ? 'taxable' : 'nil');
  const [row] = await gstTx(ctx).insert(gstRates).values({ hsn, effectiveFrom, rate, source, note, supplyKind: kind })
    .onConflictDoUpdate({ target: [gstRates.hsn, gstRates.effectiveFrom], set: { rate, source, note, supplyKind: kind } }).returning({ id: gstRates.id });
  if (row === undefined) throw new Error('The rate was not saved');
  return row;
}
