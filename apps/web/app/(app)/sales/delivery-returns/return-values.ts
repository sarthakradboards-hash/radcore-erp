// What a delivery return's form holds and how it goes to the contract (RAD-125): the schema, its types, and what a new return
// starts from. A return line names the batches the goods go back into (the ones they left with) with a quantity for each, and
// for a serialised item the serials coming back.
import { indiaDate, quantityString } from '@radcore/lib-common';
import { createDeliveryReturn } from '@radcore/lib-sales/contract';
import { z } from 'zod';
import { t } from '../../../../lib/i18n/index.ts';

const shape = createDeliveryReturn.input.shape;
const lineShape = shape.lines.element.shape;
/** An empty box means none: the contract takes null, not an empty string. */
const emptyIsNull = <T extends z.ZodType<unknown, string | null>>(inner: T) => z.string().trim().transform((s) => (s === '' ? null : s)).pipe(inner);
const qtyBox = z.string().trim().refine((v) => v === '' || quantityString().safeParse(v).success, t('sales.return.err.qty'));

/** The key a batch's quantity box has in the form: the batch's id, or "unknown" for goods whose batch wasn't known. */
export const batchKey = (batchId: string | null) => batchId ?? 'unknown';

// A line as the form holds it: the delivery line it takes back, its item (to name it), a quantity, how many go back into each
// batch (by batchKey) and the serials coming back. It goes to the contract as batches with their quantities.
const line = z.object({
  deliveryLineId: lineShape.deliveryLineId, itemId: z.string(), qty: lineShape.qty, pick: z.record(z.string(), qtyBox), serials: z.array(z.string()),
}).transform((l, ctx) => {
  const batches = Object.entries(l.pick).filter(([, qty]) => qty !== '').map(([key, qty]) => ({ batchId: key === 'unknown' ? null : key, qty }));
  if (batches.length === 0) {
    // On the quantity box, a field that is always drawn: `pick` itself has no box, so the form would show it as a bare path.
    ctx.addIssue({ code: 'custom', message: t('sales.return.err.pick'), path: ['qty'] });
    return z.NEVER;
  }
  return { deliveryLineId: l.deliveryLineId, qty: l.qty, batches, serials: l.serials };
});
export const returnSchema = z.object({
  deliveryId: z.string().min(1, t('sales.return.form.delivery.none')).pipe(shape.deliveryId),
  locationId: z.string().min(1, t('sales.return.form.place.none')).pipe(shape.locationId),
  businessDate: shape.businessDate,
  notes: emptyIsNull(shape.notes),
  lines: z.array(line).min(1, t('sales.return.form.lines.none')).max(200, t('sales.lines.max')),
});
export type ReturnInput = z.input<typeof returnSchema>;
export type ReturnValues = z.output<typeof returnSchema>;
export type ReturnLineInput = ReturnInput['lines'][number];

/** What a new return starts from: today, nothing chosen. */
export const NEW_RETURN: ReturnInput = { deliveryId: '', locationId: '', businessDate: indiaDate(new Date()), notes: '', lines: [] };
