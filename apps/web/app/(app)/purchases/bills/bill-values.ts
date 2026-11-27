// What a purchase bill's draft form holds and how it goes to createPurchaseBill / updatePurchaseBill (RAD-143 on RAD-138's
// contracts). A goods line keeps, for the screen only, what it shows (the item and PO it came from) and the receipt picked; it
// sends its PO line, the receipt line found on that receipt for it (or none while the goods aren't in), how many and at what
// rate, as the supplier's bill says. A charge line is its kind, description, HSN or SAC and amount, and its expense category
// with one of that category's accounts (#436): both or neither, and both on a bill of charges only, which posts to them. A job worker's charge line
// (#408) names the job-work receipt line whose made goods it bills, how many, at what rate, and the service's SAC. Empty boxes are none. Every
// money and tax figure is the server's: nothing is added up here.
import { createPurchaseBill, type getPurchaseBill } from '@radcore/lib-purchasing/contract';
import { indiaDate } from '@radcore/lib-common';
import { z } from 'zod';
import { t } from '../../../../lib/i18n/index.ts';
import { asPrice, asWritten } from '../../admin/decimal.ts';

const CHARGES = ['freight', 'packing', 'insurance', 'other'] as const;

const goodsLine = z.object({
  kind: z.literal('goods'),
  /** Shown only: the item and the PO it's for. */
  label: z.string(),
  poLineId: z.string(),
  /** Shown only: the goods receipt picked; its line for this PO line is looked up into receiptLineId. */
  receiptId: z.string(),
  receiptLineId: z.string(),
  qty: z.string().trim().min(1, t('purchases.bill.err.qty')),
  rate: z.string().trim().min(1, t('purchases.bill.err.rate')),
});
const chargeLine = z.object({
  kind: z.literal('charge'),
  charge: z.enum(CHARGES),
  description: z.string().trim().min(1, t('purchases.bill.err.description')),
  hsn: z.string().trim(),
  amount: z.string().trim().min(1, t('purchases.bill.err.amount')),
  expenseCategoryId: z.string(),
  expenseAccountId: z.string(),
});
const jobWorkLine = z.object({
  kind: z.literal('job_work'),
  /** Shown only: the goods made and the job-work receipt they came back on. */
  label: z.string(),
  jobWorkReceiptLineId: z.string(),
  qty: z.string().trim().min(1, t('purchases.bill.err.qty')),
  rate: z.string().trim().min(1, t('purchases.bill.err.rate')),
  hsn: z.string().trim().min(1, t('purchases.bill.err.sac')),
});
const formLine = z.discriminatedUnion('kind', [goodsLine, chargeLine, jobWorkLine]);
export type BillLineInput = z.input<typeof formLine>;

const orNull = (s: string) => (s === '' ? null : s);
export const billSchema = z.object({
  supplierId: z.string().min(1, t('purchases.bill.err.supplier')),
  businessDate: z.string(),
  supplierInvoiceNumber: z.string(),
  supplierInvoiceDate: z.string().min(1, t('purchases.bill.err.invoiceDate')),
  supplierGstin: z.string().trim().toUpperCase(),
  statedTotal: z.string().trim().min(1, t('purchases.bill.err.statedTotal')),
  fileId: z.string(),
  notes: z.string().trim(),
  lines: z.array(formLine).min(1, t('purchases.bill.err.lines')),
}).superRefine((v, ctx) => {
  // A bill of charges only (a transporter's) has no goods to spread them over, so each charge names where it posts; on any
  // other bill the category is optional. Either way a category goes with one of its accounts (#436).
  const chargesOnly = v.lines.every((l) => l.kind === 'charge');
  v.lines.forEach((l, i) => {
    if (l.kind !== 'charge') return;
    if (l.expenseCategoryId === '' && chargesOnly) {
      ctx.addIssue({ code: 'custom', path: ['lines', i, 'expenseCategoryId'], message: t('purchases.bill.err.category') });
    } else if (l.expenseCategoryId !== '' && l.expenseAccountId === '') {
      ctx.addIssue({ code: 'custom', path: ['lines', i, 'expenseAccountId'], message: t('purchases.bill.err.expenseAccount') });
    }
  });
}).transform((v): z.input<typeof createPurchaseBill.input> => ({
  supplierId: v.supplierId, businessDate: v.businessDate, supplierInvoiceNumber: v.supplierInvoiceNumber,
  supplierInvoiceDate: v.supplierInvoiceDate, supplierGstin: orNull(v.supplierGstin), statedTotal: v.statedTotal,
  fileId: orNull(v.fileId), notes: orNull(v.notes),
  lines: v.lines.map((l) => (l.kind === 'goods'
    ? { kind: 'goods' as const, poLineId: l.poLineId, receiptLineId: orNull(l.receiptLineId), qty: l.qty, rate: l.rate }
    : l.kind === 'charge' ? { kind: 'charge' as const, charge: l.charge, description: l.description, hsn: l.hsn, amount: l.amount,
      expenseCategoryId: orNull(l.expenseCategoryId), expenseAccountId: l.expenseCategoryId === '' ? null : orNull(l.expenseAccountId) }
      : { kind: 'job_work' as const, jobWorkReceiptLineId: l.jobWorkReceiptLineId, qty: l.qty, rate: l.rate, hsn: l.hsn })),
})).pipe(createPurchaseBill.input);
export type BillInput = z.input<typeof billSchema>;

export const blankBill = (): BillInput => ({
  supplierId: '', businessDate: indiaDate(new Date()), supplierInvoiceNumber: '', supplierInvoiceDate: '', supplierGstin: '',
  statedTotal: '', fileId: '', notes: '', lines: [],
});
export const blankCharge = (): BillLineInput => ({ kind: 'charge', charge: 'freight', description: '', hsn: '', amount: '', expenseCategoryId: '',
  expenseAccountId: '' });

/** A saved draft, back into the form. */
export function billToForm(b: z.output<typeof getPurchaseBill.output>): BillInput {
  return {
    supplierId: b.supplierId, businessDate: b.businessDate, supplierInvoiceNumber: b.supplierInvoiceNumber,
    supplierInvoiceDate: b.supplierInvoiceDate, supplierGstin: b.supplierGstin ?? '', statedTotal: b.statedTotal,
    fileId: b.fileId ?? '', notes: b.notes ?? '',
    lines: b.lines.map((l): BillLineInput => (l.kind === 'goods'
      ? { kind: 'goods', label: `${l.name} (${l.sku}), ${l.poNumber}`, poLineId: l.poLineId, receiptId: '', receiptLineId: l.receiptLineId ?? '',
        qty: asWritten(l.qty), rate: asPrice(l.rate) }
      : l.kind === 'charge' ? { kind: 'charge', charge: l.charge, description: l.description, hsn: l.hsn, amount: l.amount,
        expenseCategoryId: l.expenseCategoryId ?? '', expenseAccountId: l.expenseAccountId ?? '' }
        : { kind: 'job_work', label: `${l.name} (${l.sku})${l.receiptNumber === null ? '' : `, ${l.receiptNumber}`}`,
          jobWorkReceiptLineId: l.jobWorkReceiptLineId, qty: asWritten(l.qty), rate: asPrice(l.rate), hsn: l.hsn })),
  };
}
