// What a purchase bill's draft form holds and how it goes to createPurchaseBill / updatePurchaseBill (RAD-143 on RAD-138's
// contracts). A goods line keeps, for the screen only, what it shows (the item and PO it came from) and the receipt picked; it
// sends its PO line, the receipt line found on that receipt for it (or none while the goods aren't in), how many and at what
// rate, as the supplier's bill says. A charge line is its kind, description, HSN or SAC and amount. Empty boxes are none. Every
// money and tax figure is the server's: nothing is added up here.
import { createPurchaseBill, type getPurchaseBill } from '@radcore/lib-purchasing/contract';
import { indiaDate } from '@radcore/lib-common';
import { z } from 'zod';
import { t } from '../../../../lib/i18n/index.ts';

const CHARGES = ['freight', 'packing', 'insurance', 'other'] as const;
export type ChargeKind = (typeof CHARGES)[number];

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
});
const formLine = z.discriminatedUnion('kind', [goodsLine, chargeLine]);
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
}).transform((v) => ({
  supplierId: v.supplierId, businessDate: v.businessDate, supplierInvoiceNumber: v.supplierInvoiceNumber,
  supplierInvoiceDate: v.supplierInvoiceDate, supplierGstin: orNull(v.supplierGstin), statedTotal: v.statedTotal,
  fileId: orNull(v.fileId), notes: orNull(v.notes),
  lines: v.lines.map((l) => (l.kind === 'goods'
    ? { kind: 'goods' as const, poLineId: l.poLineId, receiptLineId: orNull(l.receiptLineId), qty: l.qty, rate: l.rate }
    : { kind: 'charge' as const, charge: l.charge, description: l.description, hsn: l.hsn, amount: l.amount })),
})).pipe(createPurchaseBill.input);
export type BillInput = z.input<typeof billSchema>;

export const blankBill = (): BillInput => ({
  supplierId: '', businessDate: indiaDate(new Date()), supplierInvoiceNumber: '', supplierInvoiceDate: '', supplierGstin: '',
  statedTotal: '', fileId: '', notes: '', lines: [],
});
export const blankCharge = (): BillLineInput => ({ kind: 'charge', charge: 'freight', description: '', hsn: '', amount: '' });

/** A saved draft, back into the form. */
export function billToForm(b: z.output<typeof getPurchaseBill.output>): BillInput {
  return {
    supplierId: b.supplierId, businessDate: b.businessDate, supplierInvoiceNumber: b.supplierInvoiceNumber,
    supplierInvoiceDate: b.supplierInvoiceDate, supplierGstin: b.supplierGstin ?? '', statedTotal: b.statedTotal,
    fileId: b.fileId ?? '', notes: b.notes ?? '',
    lines: b.lines.map((l) => (l.kind === 'goods'
      ? { kind: 'goods', label: `${l.name} (${l.sku}), ${l.poNumber}`, poLineId: l.poLineId, receiptId: '', receiptLineId: l.receiptLineId ?? '',
        qty: l.qty, rate: l.rate }
      : { kind: 'charge', charge: l.charge, description: l.description, hsn: l.hsn, amount: l.amount })),
  };
}
