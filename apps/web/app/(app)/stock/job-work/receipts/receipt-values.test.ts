import { describe, expect, it } from 'vitest';
import { blankReceiptLine, receiptSchema, type ChallanLine } from './receipt-values.ts';

const id = (n: number) => `0193b1c2-3d4e-7f80-9a1b-${String(n).padStart(12, '0')}`;
const plain: ChallanLine = { id: id(1), batches: [{ batchId: id(11) }, { batchId: null }], serials: [] };
const units: ChallanLine = { id: id(2), batches: [{ batchId: id(12) }], serials: ['S1', 'S2', 'S3'] };
const base = { locationId: id(5), businessDate: '2026-11-23', notes: '' };

describe('the job work receipt form', () => {
  const schema = receiptSchema(id(9), [plain, units]);

  it('sends what was made and each part by batch, adding the boxes exactly, and leaves untouched lines out', () => {
    const line = { ...blankReceiptLine(plain), made: { itemId: id(20), qty: '4', chargeRate: '150', serialsText: '' },
      used: { [id(11)]: '1.25', unknown: '2.75' }, back: { [id(11)]: '0.5' } };
    const r = schema.parse({ ...base, lines: [line, blankReceiptLine(units)] });
    expect(r.challanId).toBe(id(9));
    expect(r.lines).toEqual([{
      challanLineId: id(1), made: { itemId: id(20), qty: '4', chargeRate: '150', serials: [] },
      used: { qty: '4', batches: [{ batchId: id(11), qty: '1.25' }, { batchId: null, qty: '2.75' }], serials: [] },
      back: { qty: '0.5', batches: [{ batchId: id(11), qty: '0.5' }], serials: [] },
      lost: { qty: '0', batches: [], serials: [] },
    }]);
  });

  it('counts marked units into the only batch they were sent from', () => {
    const line = { ...blankReceiptLine(units), fates: ['back', '', 'lost'] as const };
    const r = schema.parse({ ...base, lines: [blankReceiptLine(plain), { ...line, fates: [...line.fates] }] });
    expect(r.lines[0]).toMatchObject({ challanLineId: id(2), made: null,
      back: { qty: '1', batches: [{ batchId: id(12), qty: '1' }], serials: ['S1'] },
      lost: { qty: '1', batches: [{ batchId: id(12), qty: '1' }], serials: ['S3'] }, used: { qty: '0', serials: [] } });
  });

  it('refuses a form with nothing entered, a bad box, and goods made with no rate, in words, without throwing', () => {
    expect(schema.safeParse({ ...base, lines: [blankReceiptLine(plain), blankReceiptLine(units)] }).error?.issues[0]?.path).toEqual(['lines']);
    const bad = schema.safeParse({ ...base, lines: [{ ...blankReceiptLine(plain), used: { [id(11)]: 'abc' } }, blankReceiptLine(units)] });
    expect(bad.error?.issues[0]?.path).toEqual(['lines', 0, 'used', id(11)]);
    const noRate = schema.safeParse({ ...base, lines: [{ ...blankReceiptLine(plain), made: { itemId: id(20), qty: '2', chargeRate: '', serialsText: '' } },
      blankReceiptLine(units)] });
    expect(noRate.error?.issues.map((i) => i.path)).toEqual([['lines', 0, 'made', 'chargeRate']]);
  });
});

describe('a bad charge rate', () => {
  it('is refused on its own line, even with an earlier line left blank', () => {
    const plain: ChallanLine = { id: id(1), batches: [{ batchId: id(11) }], serials: [] };
    const other: ChallanLine = { id: id(3), batches: [{ batchId: id(13) }], serials: [] };
    const schema = receiptSchema(id(9), [plain, other]);
    const r = schema.safeParse({ ...base, lines: [blankReceiptLine(plain),
      { ...blankReceiptLine(other), made: { itemId: id(20), qty: '2', chargeRate: '1,50', serialsText: '' }, used: { [id(13)]: '2' } }] });
    expect(r.error?.issues.map((i) => i.path)).toEqual([['lines', 1, 'made', 'chargeRate']]);
  });
});
