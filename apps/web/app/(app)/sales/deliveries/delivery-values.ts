// What a delivery's form holds and how it goes to the contract (RAD-125): the schema, its types, and what a new delivery starts
// from. Apart from the form so the stock picker can read the types without importing the form that imports it.
import { indiaDate, quantityString } from '@radcore/lib-common';
import { createDelivery } from '@radcore/lib-sales/contract';
import { z } from 'zod';
import { t } from '../../../../lib/i18n/index.ts';

const shape = createDelivery.input.shape;
const lineShape = shape.lines.element.shape;
/** An empty box means none: the contract takes null, not an empty string. */
const emptyIsNull = <T extends z.ZodType<unknown, string | null>>(inner: T) => z.string().trim().transform((s) => (s === '' ? null : s)).pipe(inner);
const qtyBox = z.string().trim().refine((v) => v === '' || quantityString().safeParse(v).success, t('sales.delivery.err.qty'));

// A line as the form holds it: the item (to name it and to read stock), a quantity, how many come from each batch (by the
// key stock-pick.tsx gives each), and the serials picked. It goes to the contract as batches with their quantities.
const line = z.object({
  orderLineId: lineShape.orderLineId, itemId: z.string(), qty: lineShape.qty, pick: z.record(z.string(), qtyBox), serials: z.array(z.string()),
}).transform((l, ctx) => {
  const batches = Object.entries(l.pick).filter(([, qty]) => qty !== '').map(([key, qty]) => ({ batchId: key === 'unknown' ? null : key, qty }));
  if (batches.length === 0) {
    ctx.addIssue({ code: 'custom', message: t('sales.delivery.err.pick'), path: ['pick'] });
    return z.NEVER;
  }
  return { orderLineId: l.orderLineId, qty: l.qty, batches, serials: l.serials };
});
export const deliverySchema = z.object({
  orderId: z.string().min(1, t('sales.delivery.form.order.none')).pipe(shape.orderId),
  locationId: z.string().min(1, t('sales.delivery.form.place.none')).pipe(shape.locationId),
  businessDate: shape.businessDate,
  notes: emptyIsNull(shape.notes),
  lines: z.array(line).min(1, t('sales.delivery.form.lines.none')).max(200, t('sales.lines.max')),
});
export type DeliveryInput = z.input<typeof deliverySchema>;
export type DeliveryValues = z.output<typeof deliverySchema>;
export type LineInput = DeliveryInput['lines'][number];

/** What a new delivery starts from: today, nothing chosen. */
export const NEW_DELIVERY: DeliveryInput = { orderId: '', locationId: '', businessDate: indiaDate(new Date()), notes: '', lines: [] };
