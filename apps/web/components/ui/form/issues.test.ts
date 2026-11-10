import { describe, expect, it } from 'vitest';
import { omitFields, placeIssues, unshownErrors } from './issues.ts';

const issue = (path: (string | number)[], message: string) => ({ path, code: 'custom', message });

describe('placeIssues', () => {
  it('puts each issue on the field its path names, and the rest in the form alert', () => {
    const mounted = new Set(['name', 'lines.0.qty']);
    const got = placeIssues([
      issue(['lines', 0, 'qty'], 'Too many'), issue(['gstin'], 'Not a GSTIN'), issue([], 'Period is locked'),
      issue(['name'], 'Taken'), issue(['name'], 'Too long'),
    ], mounted);
    expect(got.fields).toEqual([{ name: 'lines.0.qty', message: 'Too many' }, { name: 'name', message: 'Taken' }]);
    expect(got.rest).toEqual(['Not a GSTIN', 'Period is locked']);
  });
});

describe('unshownErrors', () => {
  it('names the check errors no mounted field can show, nested and in lists too', () => {
    const errors = {
      name: { type: 'too_small', message: 'Enter a name' },
      phone: { type: 'invalid_type', message: 'Required' },
      bank: { account: { type: 'invalid_type', message: 'Required' } },
      lines: [{ qty: { type: 'custom', message: 'Too many' } }, { qty: { type: 'custom', message: 'Hidden' } }],
    };
    expect(unshownErrors(errors, new Set(['name', 'lines.0.qty'])))
      .toEqual(['phone: Required', 'bank.account: Required', 'lines.1.qty: Hidden']);
    expect(unshownErrors({}, new Set())).toEqual([]);
  });
});

describe('omitFields', () => {
  it('drops masked fields, nested ones too, without touching the values it was given', () => {
    const values = { name: 'Asha', phone: '••••••3210', bank: { account: '••••1234', ifsc: 'HDFC0001234' }, lines: [{ qty: '1' }] };
    const got = omitFields(values, ['phone', 'bank.account', 'missing.path']);
    expect(got).toEqual({ name: 'Asha', bank: { ifsc: 'HDFC0001234' }, lines: [{ qty: '1' }] });
    expect(values.phone).toBe('••••••3210');
    expect(values.bank.account).toBe('••••1234');
  });
});
