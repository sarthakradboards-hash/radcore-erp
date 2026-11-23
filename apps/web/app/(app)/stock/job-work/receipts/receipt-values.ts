// What a job work receipt's form holds and how it goes to createJobWorkReceipt (RAD-144 on RAD-142's contracts). One form line
// per challan line still out. Of its inputs, each part (used, back, lost) is a quantity box per batch the challan sent; a
// serialised input's units are each marked used, back or lost. Goods made are an item, a quantity, the job worker's charge rate
// and, for a serialised output, its serials. A line with nothing entered is left out. Quantities are only added up here (dec,
// exact); the server checks every total, batch and unit against the challan again (`over_challan`, `units_mismatch`, …).
import { dec, quantityString, unitPriceString } from '@radcore/lib-common';
import { createJobWorkReceipt } from '@radcore/lib-stock/contract';
import { z } from 'zod';
import { t } from '../../../../../lib/i18n/index.ts';

const serialsFromText = (text: string): string[] => text.split('\n').map((l) => l.trim()).filter((l) => l !== '');

export const PARTS = ['used', 'back', 'lost'] as const;
export type Part = (typeof PARTS)[number];

/** What the form needs of a challan line: its id, the batches it sent, and its units. */
export type ChallanLine = { id: string; batches: readonly { batchId: string | null }[]; serials: readonly string[] };

/** The key a batch's box has: its id, or "unknown" for goods whose batch isn't known (as the delivery picker's batchKey). */
export const batchKey = (batchId: string | null) => batchId ?? 'unknown';

const qtyBox = z.string().trim().refine((v) => v === '' || quantityString().safeParse(v).success, t('stock.jobWork.err.qty'));
// Checked on its own box: the contract's own check runs after untouched lines are left out, so its path would name the wrong line.
const rateBox = z.string().trim().refine((v) => v === '' || unitPriceString().safeParse(v).success, t('stock.jobWork.err.rateBad'));
const formLine = z.object({
  made: z.object({ itemId: z.string(), qty: qtyBox, chargeRate: rateBox, serialsText: z.string() }),
  used: z.record(z.string(), qtyBox), back: z.record(z.string(), qtyBox), lost: z.record(z.string(), qtyBox),
  fates: z.array(z.enum(['', 'used', 'back', 'lost'])),
});
export type ReceiptLineInput = z.input<typeof formLine>;

export const blankReceiptLine = (l: ChallanLine): ReceiptLineInput => ({
  made: { itemId: '', qty: '', chargeRate: '', serialsText: '' }, used: {}, back: {}, lost: {}, fates: l.serials.map(() => ''),
});

/** The form's schema for one challan: its open lines, in the order the form shows them. */
export function receiptSchema(challanId: string, open: readonly ChallanLine[]) {
  return z.object({
    locationId: z.string().min(1, t('stock.jobWork.to.pick')),
    businessDate: z.string(),
    notes: z.string().trim(),
    lines: z.array(formLine).length(open.length),
  }).transform((v, ctx) => {
    const lines = v.lines.flatMap((l, i) => {
      const source = open[i]!;
      const part = (p: Part) => {
        const serials = source.serials.filter((_, k) => l.fates[k] === p);
        let batches = Object.entries(l[p]).filter(([, qty]) => qty !== '' && !dec(qty).isZero())
          .map(([key, qty]) => ({ batchId: key === 'unknown' ? null : key, qty }));
        // A serialised input sent from one batch: its marked units say how many, so the box needn't be filled too.
        if (batches.length === 0 && serials.length > 0 && source.batches.length === 1) {
          batches = [{ batchId: source.batches[0]!.batchId, qty: String(serials.length) }];
        }
        const qty = batches.reduce((sum, b) => sum.plus(b.qty), dec('0')).toString();
        return { qty, batches, serials };
      };
      const [used, back, lost] = PARTS.map(part) as [ReturnType<typeof part>, ReturnType<typeof part>, ReturnType<typeof part>];
      const m = l.made;
      const madeEmpty = m.itemId === '' && m.qty === '' && m.chargeRate === '' && m.serialsText.trim() === '';
      if (madeEmpty && [used, back, lost].every((p) => p.batches.length === 0 && p.serials.length === 0)) return [];
      if (!madeEmpty) {
        if (m.itemId === '') ctx.addIssue({ code: 'custom', message: t('stock.jobWork.err.madeItem'), path: ['lines', i, 'made', 'itemId'] });
        if (m.qty === '') ctx.addIssue({ code: 'custom', message: t('stock.jobWork.err.madeQty'), path: ['lines', i, 'made', 'qty'] });
        if (m.chargeRate === '') ctx.addIssue({ code: 'custom', message: t('stock.jobWork.err.rate'), path: ['lines', i, 'made', 'chargeRate'] });
      }
      const made = madeEmpty ? null : { itemId: m.itemId, qty: m.qty, chargeRate: m.chargeRate, serials: serialsFromText(m.serialsText) };
      return [{ challanLineId: source.id, made, used, back, lost }];
    });
    if (lines.length === 0) ctx.addIssue({ code: 'custom', message: t('stock.jobWork.err.nothing'), path: ['lines'] });
    return { challanId, locationId: v.locationId, businessDate: v.businessDate, notes: v.notes === '' ? null : v.notes, lines };
  }).pipe(createJobWorkReceipt.input);
}
export type ReceiptInput = z.input<ReturnType<typeof receiptSchema>>;
