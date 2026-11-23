// What an arrival's form holds and how it goes to the contract (RAD-143 on RAD-137's contracts): the schema, its types and what a new
// arrival starts from. An arrival is what came in against one placed purchase order, as counted at the door; QC (qc-values.ts)
// splits it later. The checks are the contract's own; how much is left to receive on a line is the server's to judge.
import { dec, indiaDate, quantityString } from '@radcore/lib-common';
import { createGoodsReceipt } from '@radcore/lib-purchasing/contract';
import { z } from 'zod';
import { t } from '../../../../lib/i18n/index.ts';
import { asWritten } from '../../admin/decimal.ts';

const shape = createGoodsReceipt.input.shape;
const lineShape = shape.lines.element.shape;
/** An empty box means none: the contract takes null, not an empty string. */
const emptyIsNull = <T extends z.ZodType<unknown, string | null>>(inner: T) => z.string().trim().transform((s) => (s === '' ? null : s)).pipe(inner);
/** A quantity more than zero: a nought received is no line, and the server refuses it. */
const positive = (q: string) => quantityString().safeParse(q).success && dec(q).gt(0);

// A line as the form holds it: the PO line, its item as a label, a note of what is left to come (shown, never judged here) and the
// quantity received. It goes to the contract as the PO line and the quantity.
const line = z.object({
  orderLineId: lineShape.orderLineId, label: z.string(), info: z.string(),
  received: z.string().trim().refine(positive, t('inward.form.err.qty')).pipe(lineShape.received),
}).transform((l) => ({ orderLineId: l.orderLineId, received: l.received }));

export const arrivalSchema = z.object({
  orderId: z.string().min(1, t('inward.form.order.required')).pipe(shape.orderId),
  businessDate: shape.businessDate,
  locationId: z.string().min(1, t('inward.form.place.none')).pipe(shape.locationId),
  rejectsLocationId: z.string().min(1, t('inward.form.place.none')).pipe(shape.rejectsLocationId),
  supplierRef: emptyIsNull(shape.supplierRef),
  notes: emptyIsNull(shape.notes),
  lines: z.array(line).min(1, t('inward.form.lines.none')).max(200, t('inward.form.lines.max')),
});
export type ArrivalInput = z.input<typeof arrivalSchema>;
export type ArrivalValues = z.output<typeof arrivalSchema>;
export type ArrivalLine = ArrivalInput['lines'][number];

/** What a new arrival starts from: today, nothing chosen. */
export const NEW_ARRIVAL: ArrivalInput = {
  orderId: '', businessDate: indiaDate(new Date()), locationId: '', rejectsLocationId: '', supplierRef: '', notes: '', lines: [],
};

/** What is left to come on a PO line (ordered less received), as the quantity to start from: empty when nothing is. Only a suggestion. */
export const leftToCome = (ordered: string, received: string): string => {
  const left = dec(ordered).minus(received);
  return left.gt(0) ? asWritten(left.toString()) : '';
};

/** The hint under a line's quantity: what its order line asked for and has had so far. Empty when the order couldn't be read. */
export const orderLineInfo = (order: { lines: readonly { id: string; qty: string; received: string }[] } | undefined, orderLineId: string): string => {
  const l = order?.lines.find((x) => x.id === orderLineId);
  return l === undefined ? '' : t('inward.form.line.left', { ordered: asWritten(l.qty), received: asWritten(l.received) });
};
