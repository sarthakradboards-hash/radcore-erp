// Reverse-charge rules by date (M5-03, RAD-153; ADR-010 §4): lib-gst's own table, read by the purchase documents that
// owe the tax, listed and set under the GST keys like the rates.
import { gstTx, rcmRules } from '@radcore/db/gst';
import type { Ctx } from '@radcore/lib-platform';
import { asc, lte } from 'drizzle-orm';
import type { z } from 'zod';
import type { listRcmRules, setRcmRule } from '../contract.ts';
import type { RcmRule } from '../rules/reverse-charge.ts';

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;

const columns = { id: rcmRules.id, prefix: rcmRules.prefix, supplier: rcmRules.supplier, effectiveFrom: rcmRules.effectiveFrom, source: rcmRules.source,
  note: rcmRules.note, confirmed: rcmRules.confirmed };

/** The rules started on or before `on`, for isReverseCharge. */
export async function rcmRulesOn(ctx: Ctx, on: string): Promise<RcmRule[]> {
  return (await gstTx(ctx).select({ prefix: rcmRules.prefix, supplier: rcmRules.supplier, effectiveFrom: rcmRules.effectiveFrom })
    .from(rcmRules).where(lte(rcmRules.effectiveFrom, on))) as RcmRule[];
}

/** GET /gst/rcm-rules: every rule, by prefix, then supplier, then start. A few dozen rows at most, so one answer. */
export async function listRcmRulesAll(ctx: Ctx): Promise<Out<typeof listRcmRules>> {
  const items = await gstTx(ctx).select(columns).from(rcmRules).orderBy(asc(rcmRules.prefix), asc(rcmRules.supplier), asc(rcmRules.effectiveFrom));
  return { items: items as Out<typeof listRcmRules>['items'] };
}

/** PUT /gst/rcm-rules (gst:write): a new rule, or the same prefix, supplier and date corrected. The reason was kept by
 * the handler. */
export async function putRcmRule(ctx: Ctx, { prefix, supplier, effectiveFrom, source, note, confirmed }: In<typeof setRcmRule>):
  Promise<Out<typeof setRcmRule>> {
  const [row] = await gstTx(ctx).insert(rcmRules).values({ prefix, supplier, effectiveFrom, source, note, confirmed })
    .onConflictDoUpdate({ target: [rcmRules.prefix, rcmRules.supplier, rcmRules.effectiveFrom], set: { source, note, confirmed } })
    .returning({ id: rcmRules.id });
  if (row === undefined) throw new Error('The rule was not saved');
  return row;
}
