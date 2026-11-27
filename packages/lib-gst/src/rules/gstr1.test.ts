// RAD-154's GSTR-1 tables (ADR-010 §3, §15's M5-04 tests), without a database: rows as gst_outward_lines answers them.
import { randomInt, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildGstr1, type IssuedDocument, type OutwardLine } from './gstr1.ts';

const OURS = '27';
/** An invoice line, in our state to an unregistered buyer at 5% unless `o` says otherwise; a note's with `note`. Each
 * call its own ids and number (RC-222: no counter shared between tests). */
function line(o: Partial<OutwardLine> & { id?: string; note?: string } = {}): OutwardLine {
  const n = randomInt(1, 100_000);
  const id = o.id ?? `inv-${randomUUID()}`;
  const isNote = o.note !== undefined;
  return {
    documentTable: isNote ? 'credit_notes' : 'invoices', documentId: isNote ? (o.note ?? '') : id,
    documentNumber: isNote ? `CN/26-27/${String(n).padStart(5, '0')}` : `INV/26-27/${String(n).padStart(5, '0')}`, status: 'posted',
    documentDate: '2026-11-10', invoiceId: id, invoiceNumber: `INV/26-27/${id}`, invoiceDate: '2026-11-05', invoiceValue: '1050.00',
    buyerGstin: null, placeOfSupply: OURS, issuerStateCode: OURS, ecommerceGstin: null, late: false, hsn: '87116020', uqc: 'NOS', qty: '1',
    gstRate: '5.000000', supplyKind: 'taxable', taxable: '1000.00', cgst: '25.00', sgst: '25.00', igst: '0.00', cess: '0.00', ...o,
    // An invoice's own total is its invoice value; a note's is its own.
    documentValue: o.documentValue ?? (isNote ? '1050.00' : (o.invoiceValue ?? '1050.00')),
  };
}
const build = (rows: OutwardLine[], hsnDigits = 6, issued: IssuedDocument[] = []) => buildGstr1(rows, { b2clLimit: '100000.00', hsnDigits, issued });
const interState = { placeOfSupply: '29', cgst: '0.00', sgst: '0.00', igst: '5000.00', taxable: '100000.00', qty: '1' } as const;

describe('buildGstr1', () => {
  it('files a 0% line in Table 8, never 4 or 7, and a taxable B2B line in 4A (RC-107)', () => {
    const g = build([
      line({ id: 'b2b', buyerGstin: '27AAPFU0939F1ZV' }),
      line({ id: 'nil', buyerGstin: '27AAPFU0939F1ZV', gstRate: '0.000000', supplyKind: 'nil', cgst: '0.00', sgst: '0.00' }),
      line({ id: 'exempt', gstRate: '0.000000', supplyKind: 'exempt', cgst: '0.00', sgst: '0.00', taxable: '300.00' }),
    ]);
    expect(g.table4a.map((d) => [d.buyerGstin, d.items.map((i) => [i.rate, i.taxable, i.cgst])])).toEqual([['27AAPFU0939F1ZV', [['5.000000', '1000.00', '25.00']]]]);
    expect(g.table8).toEqual([{ supply: 'intra', buyer: 'registered', kind: 'nil', value: '1000.00' },
      { supply: 'intra', buyer: 'unregistered', kind: 'exempt', value: '300.00' }]);
    expect([g.table5, g.table7]).toEqual([[], []]);
  });

  it('keeps a B2C inter-state invoice at the limit in Table 7, and one 0.01 over in Table 5', () => {
    const g = build([line({ id: 'at', ...interState, invoiceValue: '100000.00' }),
      line({ id: 'over', ...interState, invoiceValue: '100000.01', taxable: '95238.11', igst: '4761.90' })]);
    expect(g.table5.map((d) => [d.value, d.placeOfSupply, d.items[0]?.igst])).toEqual([['100000.01', '29', '4761.90']]);
    expect(g.table7).toEqual([{ placeOfSupply: '29', rate: '5.000000', ecommerceGstin: null, taxable: '100000.00', igst: '5000.00', cgst: '0.00',
      sgst: '0.00', cess: '0.00' }]);
  });

  it('puts a note on a B2C large invoice in CDNUR, and one on a small B2C invoice into Table 7, lowering it', () => {
    const g = build([
      line({ id: 'large', ...interState, invoiceValue: '200000.00' }),
      line({ id: 'large', note: 'cn-large', ...interState, invoiceValue: '200000.00', taxable: '1000.00', igst: '50.00' }),
      line({ id: 'small' }),
      line({ id: 'small', note: 'cn-small', taxable: '100.00', cgst: '2.50', sgst: '2.50' }),
    ]);
    expect(g.table9b.cdnur.map((d) => [d.invoiceNumber, d.items[0]?.taxable, d.items[0]?.igst])).toEqual([['INV/26-27/large', '1000.00', '50.00']]);
    expect(g.table9b.cdnr).toEqual([]);
    expect(g.table7.map((r) => [r.placeOfSupply, r.taxable, r.cgst])).toEqual([['27', '900.00', '22.50']]);
  });

  it('files a note on a registered buyer’s invoice in CDNR, note by note', () => {
    const g = build([line({ id: 'b', buyerGstin: '27AAPFU0939F1ZV' }), line({ id: 'b', note: 'cn-b', buyerGstin: '27AAPFU0939F1ZV', taxable: '200.00',
      cgst: '5.00', sgst: '5.00', documentValue: '210.00' })]);
    // The note's own value, never its invoice's (the auditor on #457).
    expect(g.table9b.cdnr.map((d) => [d.buyerGstin, d.invoiceNumber, d.value, d.items[0]?.taxable])).toEqual([['27AAPFU0939F1ZV', 'INV/26-27/b', '210.00',
      '200.00']]);
  });

  it('reports a note past section 34’s limit in no table', () => {
    const g = build([line({ id: 's' }), line({ id: 's', note: 'cn-late', late: true, taxable: '100.00', cgst: '2.50', sgst: '2.50' })]);
    expect([g.table7[0]?.taxable, g.table9b.cdnur, g.table12[0]?.taxable]).toEqual(['1000.00', [], '1000.00']);
  });

  const issued = (documentType: IssuedDocument['documentType'], documentNumber: string, status = 'posted'): IssuedDocument =>
    ({ documentType, documentNumber, status });
  it('counts Table 13 per document type and series with a cancelled invoice, and leaves the cancelled one out of every other table', () => {
    const rows = [line({ id: 'a' }), line({ id: 'b', status: 'cancelled' }), line({ id: 'c' }), line({ id: 'c', hsn: '87120010' }),
      line({ id: 'c', note: 'cn-c', taxable: '10.00', cgst: '0.25', sgst: '0.25' })];
    const g = build(rows, 6, [issued('Invoices for outward supply', 'INV/26-27/00007'), issued('Invoices for outward supply', 'INV/26-27/00009', 'cancelled'),
      issued('Invoices for outward supply', 'INV/26-27/00008'), issued('Credit Note', 'CN/26-27/00002')]);
    expect(g.table13).toEqual([
      { documentType: 'Credit Note', series: 'CN/26-27/', from: 'CN/26-27/00002', to: 'CN/26-27/00002', count: 1, cancelled: 0 },
      { documentType: 'Invoices for outward supply', series: 'INV/26-27/', from: 'INV/26-27/00007', to: 'INV/26-27/00009', count: 3, cancelled: 1 },
    ]);
    expect(g.table7[0]?.taxable).toBe('2990.00');
  });

  // The architect on #457: job-work challans are their own Table 13 row.
  it('counts two job-work challans, one cancelled, as their own Table 13 row, and a month with none has no challan row', () => {
    const challans = [issued('Delivery Challan for job work', 'JWC/26-27/00001'), issued('Delivery Challan for job work', 'JWC/26-27/00002', 'cancelled')];
    expect(build([], 6, challans).table13).toEqual([{ documentType: 'Delivery Challan for job work', series: 'JWC/26-27/', from: 'JWC/26-27/00001',
      to: 'JWC/26-27/00002', count: 2, cancelled: 1 }]);
    expect(build([], 6, [issued('Invoices for outward supply', 'INV/26-27/00001')]).table13.map((r) => r.documentType))
      .toEqual(['Invoices for outward supply']);
  });

  it('sums Table 12 by HSN at 6 digits by default, and at 4 when gst.hsn_digits says so, net of notes, in B2B and B2C parts', () => {
    const rows = [line({ hsn: '87116020' }), line({ hsn: '87116090', qty: '2', taxable: '2000.00', cgst: '50.00', sgst: '50.00' }),
      line({ hsn: '87120010' }), line({ id: 'r', hsn: '87116020', buyerGstin: '27AAPFU0939F1ZV' }),
      line({ id: 'q', hsn: '87120010', note: 'cn-q', qty: '0', taxable: '100.00', cgst: '2.50', sgst: '2.50' })];
    expect(build(rows).table12.map((r) => [r.part, r.hsn, r.qty, r.taxable])).toEqual([
      ['b2c', '871160', '3', '3000.00'], ['b2c', '871200', '1', '900.00'], ['b2b', '871160', '1', '1000.00']]);
    expect(build(rows, 4).table12.map((r) => [r.part, r.hsn, r.qty, r.taxable])).toEqual([['b2c', '8711', '3', '3000.00'], ['b2c', '8712', '1', '900.00'],
      ['b2b', '8711', '1', '1000.00']]);
  });

  it('reports an operator’s sale in 4C and Table 14, and keeps 11A and 11B empty for goods', () => {
    const g = build([line({ id: 'e', buyerGstin: '27AAPFU0939F1ZV', ecommerceGstin: '27AAACR5055K1C5' }), line({ id: 'x', ecommerceGstin: '27AAACR5055K1C5' })]);
    expect([g.table4a, g.table4c.map((d) => d.ecommerceGstin), g.table14.map((r) => [r.ecommerceGstin, r.taxable]), g.table11a, g.table11b])
      .toEqual([[], ['27AAACR5055K1C5'], [['27AAACR5055K1C5', '2000.00']], [], []]);
  });
});
