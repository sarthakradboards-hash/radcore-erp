import { expect, it } from 'vitest';
import { blankExpense, blankLine, expenseSchema, expenseToForm, keeping, NO_TDS } from './form-values.ts';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const line = { ...blankLine(), categoryId: id(1), accountId: id(2), taxable: '1000', gstRate: '18', cgst: '90', sgst: '90' };
const filled = { ...blankExpense(), supplierInvoiceNumber: 'B-7', supplierInvoiceDate: '2026-11-20', statedTotal: '1180', lines: [line] };

it('sends empty boxes as none, empty tax as nothing charged, and leaves the TDS and SAC to their defaults', () => {
  const sent = expenseSchema.parse(filled);
  expect(sent).toMatchObject({ supplierId: null, supplierGstin: null, payFromAccountId: null, fileId: null, notes: null });
  expect(sent.lines[0]).toMatchObject({ description: null, cgst: '90', igst: '0' });
  expect(sent.lines[0]).not.toHaveProperty('tdsSectionId');
  expect(sent.lines[0]).not.toHaveProperty('sac');
});

it('sends “no TDS” as null and a chosen section as its id', () => {
  expect(expenseSchema.parse({ ...filled, lines: [{ ...line, tds: NO_TDS }] }).lines[0]?.tdsSectionId).toBeNull();
  expect(expenseSchema.parse({ ...filled, lines: [{ ...line, tds: id(3) }] }).lines[0]?.tdsSectionId).toBe(id(3));
});

it('puts each problem on its own box: what’s missing, and CGST and SGST that differ', () => {
  const paths = (v: unknown) => expenseSchema.safeParse(v).error?.issues.map((i) => i.path.join('.')) ?? [];
  expect(paths({ ...filled, statedTotal: '', lines: [{ ...line, categoryId: '', taxable: '' }] }))
    .toEqual(expect.arrayContaining(['statedTotal', 'lines.0.categoryId', 'lines.0.taxable']));
  expect(paths({ ...filled, lines: [{ ...line, sgst: '80' }] })).toEqual(['lines.0.cgst']);
  expect(paths({ ...filled, lines: [] })).toEqual(['lines']);
});

it('keeps a saved draft as stored: no section stays no TDS, and a choice that’s gone is still offered', () => {
  const saved = { ...expenseSchema.parse(filled), id: id(9), number: null, status: 'draft', supplierName: null, onCredit: true, awaitingApproval: false,
    tds: '0.00', createdAt: '2026-11-20T10:00:00Z', cancelReason: null,
    lines: [{ ...expenseSchema.parse(filled).lines[0], id: id(8), lineNo: 1, tdsSectionId: null, sac: null, credit: null, reverseCharge: null }] };
  expect(expenseToForm(saved as unknown as Parameters<typeof expenseToForm>[0]).lines[0]).toMatchObject({ tds: NO_TDS, sac: '' });
  expect(keeping([{ value: 'a', label: 'A' }], 'b', 'Saved')).toEqual([{ value: 'a', label: 'A' }, { value: 'b', label: 'Saved' }]);
  expect(keeping([{ value: 'a', label: 'A' }], '', 'Saved')).toHaveLength(1);
});
