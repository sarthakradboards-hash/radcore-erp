import { describe, expect, it } from 'vitest';
import { billSchema, blankBill, blankCharge, categoryChoices } from './bill-values.ts';

const id = (n: number) => `0193b1c2-3d4e-7f80-9a1b-${String(n).padStart(12, '0')}`;
const filled = { ...blankBill(), supplierId: id(1), businessDate: '2026-11-24', supplierInvoiceNumber: 'VM/2611/0042',
  supplierInvoiceDate: '2026-11-20', statedTotal: '14160.00' };

describe('the purchase bill form', () => {
  it('sends goods lines without their screen-only fields, empty boxes as none, and the GSTIN in capitals', () => {
    const r = billSchema.parse({ ...filled, supplierGstin: '27aapfu0939f1zv', lines: [
      { kind: 'goods', label: '48 V battery (BAT-48V), PO/26-27/00007', poLineId: id(11), receiptId: id(30), receiptLineId: id(31), qty: '10', rate: '1200' },
      { kind: 'goods', label: 'Cable', poLineId: id(12), receiptId: '', receiptLineId: '', qty: '5', rate: '40' },
      { ...blankCharge(), description: 'Road freight', hsn: '996511', amount: '900.00' },
    ] });
    expect(r).toMatchObject({ supplierGstin: '27AAPFU0939F1ZV', fileId: null, notes: null });
    expect(r.lines).toEqual([
      { kind: 'goods', poLineId: id(11), receiptLineId: id(31), qty: '10', rate: '1200' },
      { kind: 'goods', poLineId: id(12), receiptLineId: null, qty: '5', rate: '40' },
      { kind: 'charge', charge: 'freight', description: 'Road freight', hsn: '996511', amount: '900.00', expenseCategoryId: null, expenseAccountId: null },
    ]);
  });

  it('refuses a bill with no lines, and a supplier’s date after the bill’s, on their own boxes', () => {
    expect(billSchema.safeParse(filled).error?.issues.map((i) => i.path)).toEqual([['lines']]);
    const late = billSchema.safeParse({ ...filled, supplierInvoiceDate: '2026-11-25',
      lines: [{ ...blankCharge(), description: 'Freight', hsn: '996511', amount: '100', expenseCategoryId: id(40), expenseAccountId: id(41) }] });
    expect(late.error?.issues.map((i) => i.path)).toEqual([['supplierInvoiceDate']]);
  });
});

describe('a job worker’s charge line', () => {
  it('sends its job-work receipt line, quantity, rate and SAC, and is refused without a SAC on its own box', () => {
    const jw = { kind: 'job_work' as const, label: 'Painted frame (FRM-PNT), JWR/26-27/00001', jobWorkReceiptLineId: id(41), qty: '8', rate: '150.00', hsn: '998898' };
    expect(billSchema.parse({ ...filled, lines: [jw] }).lines).toEqual([{ kind: 'job_work', jobWorkReceiptLineId: id(41), qty: '8', rate: '150.00', hsn: '998898' }]);
    expect(billSchema.safeParse({ ...filled, lines: [{ ...jw, hsn: '' }] }).error?.issues.map((i) => i.path)).toEqual([['lines', 0, 'hsn']]);
  });
});

describe('a charge’s expense category (#436)', () => {
  const charge = { ...blankCharge(), description: 'Transport, Pune to Nashik', hsn: '996511', amount: '4500.00' };
  const paths = (lines: unknown[]) => billSchema.safeParse({ ...filled, lines }).error?.issues.map((i) => i.path.join('.')) ?? [];

  it('lets a draft of charges only save without one (posting asks for it), and goes with one of its accounts', () => {
    // Someone without expenses:read sees no picker; posting refuses it as charge_needs_category (auditor-3 on #450).
    expect(paths([charge])).toEqual([]);
    expect(billSchema.parse({ ...filled, lines: [charge] }).lines).toEqual([expect.objectContaining({ expenseCategoryId: null, expenseAccountId: null })]);
    expect(paths([{ ...charge, expenseCategoryId: id(40) }])).toEqual(['lines.0.expenseAccountId']);
    expect(billSchema.parse({ ...filled, lines: [{ ...charge, expenseCategoryId: id(40), expenseAccountId: id(41) }] }).lines)
      .toEqual([expect.objectContaining({ expenseCategoryId: id(40), expenseAccountId: id(41) })]);
  });

  it('is optional beside goods, and still goes with an account when chosen', () => {
    const goods = { kind: 'goods', label: 'Cable', poLineId: id(12), receiptId: '', receiptLineId: '', qty: '5', rate: '40' };
    expect(paths([goods, charge])).toEqual([]);
    expect(paths([goods, { ...charge, expenseCategoryId: id(40) }])).toEqual(['lines.1.expenseAccountId']);
  });
});

describe('a charge’s category choices', () => {
  const cat = (n: number, active: boolean) => ({ id: id(n), name: `Cat ${n}`, credit: 'allowed' as const, blockedClause: null, active, accounts: [] });
  it('are none while loading, so a saved category is never drawn as None (e2e-playwright on #450)', () => {
    expect(categoryChoices(undefined, id(40))).toBeNull();
  });
  it('are the switched-on categories, and the line’s own even when switched off since', () => {
    const items = [cat(40, false), cat(41, true), cat(42, false)];
    expect(categoryChoices(items, id(40))?.map((c) => c.value)).toEqual([id(40), id(41)]);
    expect(categoryChoices(items, '')?.map((c) => c.value)).toEqual([id(41)]);
  });
});
