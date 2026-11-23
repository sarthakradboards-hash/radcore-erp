// What QC's form holds and how it goes to the contract (RAD-143 on RAD-137's postGoodsReceipt): for each line of the arrival, its split
// into accepted and rejected by the supplier's batch, the units (a serial number, a chassis number, its batch, whether it was rejected)
// and why anything was rejected. An empty box is none: the contract takes null for a batch with no number of its own, a unit with no
// chassis and a line with nothing rejected. The sum of a line's batches and the reason are checked here so a slip is shown on its box;
// the server checks them again with the units, the stock and the ledger.
import { dec, quantityString } from '@radcore/lib-common';
import { postGoodsReceipt } from '@radcore/lib-purchasing/contract';
import { z } from 'zod';
import { t } from '../../../../lib/i18n/index.ts';
import { asWritten } from '../../admin/decimal.ts';

const lineShape = postGoodsReceipt.input.shape.lines.element.shape;
const orNull = (s: string): string | null => (s === '' ? null : s);
const qtyBox = z.string().trim().refine((v) => v === '' || quantityString().safeParse(v).success, t('inward.qc.err.qty'));
const sum = (boxes: readonly string[]) => boxes.reduce((total, b) => total.plus(b === '' ? '0' : b), dec('0'));

const batch = z.object({ batchNo: z.string().trim(), accepted: qtyBox, rejected: qtyBox });
const unit = z.object({
  serialNo: z.string().trim().min(1, t('inward.qc.err.serial')), chassisNo: z.string().trim(), batchNo: z.string(), rejected: z.boolean(),
});

// A line as the form holds it: the receipt line (to send), its item (to know whether its units are named) as a label and what was received (to check the split against).
const line = z.object({
  lineId: lineShape.lineId, itemId: z.string(), label: z.string(), received: z.string(),
  batches: z.array(batch).min(1, t('inward.qc.err.batches')), serials: z.array(unit), rejectReason: z.string().trim(),
}).transform((l, ctx) => {
  const accepted = sum(l.batches.map((b) => b.accepted));
  const rejected = sum(l.batches.map((b) => b.rejected));
  // On boxes that are always drawn: the first batch's accepted box and the reason, never a bare path.
  if (!accepted.plus(rejected).eq(l.received)) {
    ctx.addIssue({ code: 'custom', path: ['batches', 0, 'accepted'],
      message: t('inward.qc.err.sum', { sum: asWritten(accepted.plus(rejected).toString()), received: asWritten(l.received) }) });
  }
  if (rejected.gt(0) && l.rejectReason === '') ctx.addIssue({ code: 'custom', path: ['rejectReason'], message: t('inward.qc.err.reason') });
  return {
    lineId: l.lineId,
    batches: l.batches.filter((b) => b.accepted !== '' || b.rejected !== '').map((b) => ({
      batchNo: orNull(b.batchNo), accepted: b.accepted === '' ? '0' : b.accepted, rejected: b.rejected === '' ? '0' : b.rejected,
    })),
    serials: l.serials.map((u) => ({ serialNo: u.serialNo, chassisNo: orNull(u.chassisNo), batchNo: orNull(u.batchNo), rejected: u.rejected })),
    rejectReason: orNull(l.rejectReason),
  };
});

export const qcSchema = z.object({ lines: z.array(line).min(1).max(200) });
export type QcInput = z.input<typeof qcSchema>;
export type QcValues = z.output<typeof qcSchema>;

/** What QC starts from: each line's whole received quantity accepted in one batch with no number of its own, nothing rejected. */
export const qcStart = (lines: readonly { id: string; itemId: string; name: string; sku: string; received: string }[]): QcInput => ({
  lines: lines.map((l) => ({
    lineId: l.id, itemId: l.itemId, label: `${l.name} (${l.sku})`, received: l.received, rejectReason: '', serials: [],
    batches: [{ batchNo: '', accepted: asWritten(l.received), rejected: '' }],
  })),
});
