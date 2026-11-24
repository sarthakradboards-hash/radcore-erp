// What a supplier return's draft form holds and how it goes to createSupplierReturn / updateSupplierReturn (RAD-143 on RAD-140's
// contracts). A line names the receipt line its goods came in on; it goes back in the batches its boxes name (each a quantity)
// and, for a serialised item, the units ticked. Its quantity is its boxes added up (exactly, with dec); the server checks it
// against what came in less what's gone back already (`over_received`) and the units against the batches.
import { dec, indiaDate, quantityString } from '@radcore/lib-common';
import { createSupplierReturn, type getSupplierReturn } from '@radcore/lib-purchasing/contract';
import { z } from 'zod';
import { t } from '../../../../lib/i18n/index.ts';

const qtyBox = z.string().trim().refine((v) => v === '' || quantityString().safeParse(v).success, t('purchases.return.err.qty'));
const formLine = z.object({
  receiptLineId: z.string(),
  /** Shown only: the item and the receipt it came in on. */
  label: z.string(),
  /** Shown only: the batches it may go back from, by id, with their numbers and what's there to return. */
  batchOptions: z.array(z.object({ batchId: z.string(), batchNo: z.string(), qty: z.string() })),
  /** Shown only: the units it may name. */
  serialOptions: z.array(z.string()),
  batches: z.record(z.string(), qtyBox),
  serials: z.array(z.string()),
});
export type ReturnLineInput = z.input<typeof formLine>;

const line = formLine.transform((l, ctx) => {
  const batches = Object.entries(l.batches).filter(([, q]) => q !== '' && !dec(q).isZero()).map(([batchId, qty]) => ({ batchId, qty }));
  if (batches.length === 0) {
    ctx.addIssue({ code: 'custom', message: t('purchases.return.err.pick'), path: ['batches'] });
    return z.NEVER;
  }
  const qty = batches.reduce((sum, b) => sum.plus(b.qty), dec('0')).toString();
  return { receiptLineId: l.receiptLineId, qty, batches, serials: l.serials };
});

export const returnSchema = z.object({
  supplierId: z.string().min(1, t('purchases.return.err.supplier')),
  businessDate: z.string(),
  locationId: z.string().min(1, t('purchases.return.err.place')),
  reason: z.string().trim().min(1, t('purchases.return.err.reason')),
  notes: z.string().trim(),
  lines: z.array(line).min(1, t('purchases.return.err.lines')),
}).transform((v) => ({ ...v, notes: v.notes === '' ? null : v.notes })).pipe(createSupplierReturn.input);
export type ReturnInput = z.input<typeof returnSchema>;

export const blankReturn = (): ReturnInput => ({ supplierId: '', businessDate: indiaDate(new Date()), locationId: '', reason: '', notes: '', lines: [] });

/** A saved draft, back into the form: each line offers the batches and units it already names. */
export function returnToForm(r: z.output<typeof getSupplierReturn.output>): ReturnInput {
  return {
    supplierId: r.supplierId, businessDate: r.businessDate, locationId: r.locationId, reason: r.reason, notes: r.notes ?? '',
    lines: r.lines.map((l) => ({
      receiptLineId: l.receiptLineId, label: `${l.name} (${l.sku})${l.receiptNumber === null ? '' : `, ${l.receiptNumber}`}`,
      // A saved line knows its own batches but not what was rejected in them, so its boxes say no total.
      batchOptions: l.batches.map((b) => ({ batchId: b.batchId, batchNo: b.batchNo, qty: '' })), serialOptions: l.serials,
      batches: Object.fromEntries(l.batches.map((b) => [b.batchId, b.qty])), serials: l.serials,
    })),
  };
}
