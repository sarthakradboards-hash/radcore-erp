// RAD-139's input-credit rule (ADR-009 §2, F28), without a database.
import { roundMoney } from '@radcore/lib-common';
import { describe, expect, it } from 'vitest';
import { inputCredit, supplierKind, type SupplierKind } from './credit.ts';

const m = roundMoney;
const intra = { cgst: m('120'), sgst: m('120'), igst: m('0') };
const inter = { cgst: m('0'), sgst: m('0'), igst: m('360') };
const regular: SupplierKind[] = ['regular'];
const none = (reason: string) => ({ cgst: '0.00', sgst: '0.00', igst: '0.00', reason });

describe('supplierKind', () => {
  it('reads unregistered from no GSTIN, then composition, else regular', () => {
    expect(supplierKind({ gstin: null, composition: true })).toBe('unregistered');
    expect(supplierKind({ gstin: '27AAAAA0000A1Z5', composition: true })).toBe('composition');
    expect(supplierKind({ gstin: '27AAAAA0000A1Z5', composition: false })).toBe('regular');
  });
});

describe('inputCredit', () => {
  it('claims every head from a regular supplier whose heads fit its state', () => {
    expect(inputCredit({ tax: intra, kind: 'regular', creditFrom: regular, blocked: false, intraState: true }))
      .toEqual({ ...intra, reason: null });
    expect(inputCredit({ tax: inter, kind: 'regular', creditFrom: regular, blocked: false, intraState: false }))
      .toEqual({ ...inter, reason: null });
  });
  it('claims nothing from a kind not in gst.credit_from, and does once it is added', () => {
    expect(inputCredit({ tax: intra, kind: 'composition', creditFrom: regular, blocked: false, intraState: true })).toEqual(none('supplier_kind'));
    expect(inputCredit({ tax: intra, kind: 'unregistered', creditFrom: regular, blocked: false, intraState: true })).toEqual(none('supplier_kind'));
    expect(inputCredit({ tax: intra, kind: 'composition', creditFrom: ['regular', 'composition'], blocked: false, intraState: true }))
      .toEqual({ ...intra, reason: null });
  });
  it('claims nothing on a blocked line', () => {
    expect(inputCredit({ tax: intra, kind: 'regular', creditFrom: regular, blocked: true, intraState: true })).toEqual(none('blocked'));
  });
  it('claims nothing where a head doesn’t fit the state: an out-of-state hotel’s CGST and SGST (F28), or IGST within it', () => {
    expect(inputCredit({ tax: intra, kind: 'regular', creditFrom: regular, blocked: false, intraState: false })).toEqual(none('state'));
    expect(inputCredit({ tax: inter, kind: 'regular', creditFrom: regular, blocked: false, intraState: true })).toEqual(none('state'));
    expect(inputCredit({ tax: { ...inter, cgst: m('0'), sgst: m('1') }, kind: 'regular', creditFrom: regular, blocked: false, intraState: false }))
      .toEqual(none('state'));
  });
  it('a 0% line claims its nothing, with no reason', () => {
    const zero = { cgst: m('0'), sgst: m('0'), igst: m('0') };
    expect(inputCredit({ tax: zero, kind: 'regular', creditFrom: regular, blocked: false, intraState: false })).toEqual({ ...zero, reason: null });
  });
});
