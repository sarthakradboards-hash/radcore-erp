import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  cost, idString, isMasked, listOf, looksLikeCardNumber, maskedInputPath, maskOf, maskOutput, sightOf, pii, piiPlan, piiRecord,
} from './index.ts';

const person = piiRecord('people', z.object({ id: idString(), name: pii(), phone: pii(z.string(), 'last4'),
  salary: pii(z.string(), 'pay').nullable() }));
const ALL = ['pii:read', 'pay:read'];
const planOf = (schema: z.ZodType) => {
  const plan = piiPlan(schema);
  if (plan === null) throw new Error('no pii() fields');
  return plan;
};
const SIX = '••••••';

describe('pii()', () => {
  it('lets a value through as it is, or as a mask, and nothing else', () => {
    const phone = pii();
    expect(phone.parse('+919876543210')).toBe('+919876543210');
    expect(phone.parse({ masked: '••••••3210' })).toEqual({ masked: '••••••3210' });
    expect(phone.safeParse({ masked: SIX, extra: 1 }).success).toBe(false);
    expect(phone.safeParse(12).success).toBe(false);
  });

  it('isMasked tells a mask from a value', () => {
    expect(isMasked({ masked: SIX })).toBe(true);
    expect(isMasked(SIX)).toBe(false);
    expect(isMasked({ masked: 1 })).toBe(false);
    expect(isMasked(null)).toBe(false);
  });
});

describe('maskOf', () => {
  it('is six bullets whatever the length; last4 keeps the last 4 of a value with at least 8 (the architect on RAD-40)', () => {
    expect(maskOf('Asha Rao, 12 MG Road', 'whole')).toEqual({ masked: SIX });
    expect(maskOf('+919876543210', 'last4')).toEqual({ masked: '••••••3210' });
    expect(maskOf('ABCDE1234F', 'last4')).toEqual({ masked: '••••••234F' });
    expect(maskOf('1234567', 'last4')).toEqual({ masked: SIX });
    expect(maskOf('12345678', 'last4')).toEqual({ masked: '••••••5678' });
    expect(maskOf('125000.00', 'pay')).toEqual({ masked: SIX });
  });

  it('counts the last 4 in characters, not UTF-16 units', () => {
    expect(maskOf('खाता-संख्या-𝟗𝟖𝟕𝟔', 'last4')).toEqual({ masked: '••••••𝟗𝟖𝟕𝟔' });
  });
});

describe('piiPlan and maskOutput', () => {
  const asha = { id: 'p-1', name: 'Asha', phone: '+919876543210', salary: '125000.00' };

  it('masks personal data without pii:read, and pay without pay:read', () => {
    const plan = planOf(person);
    expect(maskOutput(plan, asha, sightOf([])).value).toEqual({ id: 'p-1', name: { masked: SIX }, phone: { masked: '••••••3210' },
      salary: { masked: SIX } });
    expect(maskOutput(plan, asha, sightOf(['pii:read'])).value).toEqual({ ...asha, salary: { masked: SIX } });
    expect(maskOutput(plan, asha, sightOf(['pay:read'])).value).toEqual({ id: 'p-1', name: { masked: SIX }, phone: { masked: '••••••3210' },
      salary: '125000.00' });
    expect(maskOutput(plan, asha, sightOf(ALL)).value).toEqual(asha);
  });

  it('logs a look at each record shown with an unmasked value, once, and none when all is masked', () => {
    const plan = planOf(listOf(person));
    const page = { items: [asha, { ...asha, id: 'p-2', salary: null }, asha], next: null };
    expect(maskOutput(plan, page, sightOf(ALL)).looks).toEqual([{ table: 'people', id: 'p-1' }, { table: 'people', id: 'p-2' }]);
    expect(maskOutput(plan, page, sightOf(['pay:read'])).looks).toEqual([{ table: 'people', id: 'p-1' }]);
    expect(maskOutput(plan, page, sightOf([])).looks).toEqual([]);
  });

  it('logs a value reached through a relation against its own record, and masks it the same way', () => {
    const order = piiRecord('sales_orders', z.object({ id: idString(), note: pii(),
      customer: piiRecord('customers', z.object({ id: idString(), phone: pii(z.string(), 'last4') })),
      contacts: z.array(z.object({ phone: pii(z.string(), 'last4').optional() })) }));
    const plan = planOf(order);
    const one = { id: 'o-1', note: 'Call first', customer: { id: 'c-1', phone: '+919876543210' },
      contacts: [{ phone: '+911234567890' }, {}] };
    expect(maskOutput(plan, one, sightOf([])).value).toEqual({ id: 'o-1', note: { masked: SIX },
      customer: { id: 'c-1', phone: { masked: '••••••3210' } }, contacts: [{ phone: { masked: '••••••7890' } }, {}] });
    // The contact sits in the order's record, with no record of its own: a look at the order.
    expect(maskOutput(plan, { ...one, note: null }, sightOf(ALL)).looks).toEqual([{ table: 'customers', id: 'c-1' },
      { table: 'sales_orders', id: 'o-1' }]);
  });

  it('follows a union of records of one table', () => {
    const either = z.union([piiRecord('parties', z.object({ id: idString(), kind: z.literal('a'), phone: pii() })),
      piiRecord('parties', z.object({ id: idString(), kind: z.literal('b'), email: pii() }))]);
    expect(maskOutput(planOf(either), { id: 'x', kind: 'b', email: 'a.person@example.in' }, sightOf([])).value)
      .toEqual({ id: 'x', kind: 'b', email: { masked: SIX } });
  });

  it('leaves a mask and a null alone', () => {
    const masked = { ...asha, phone: { masked: '••••••3210' }, salary: null };
    expect(maskOutput(planOf(person), masked, sightOf(ALL))).toEqual({ value: masked, looks: [{ table: 'people', id: 'p-1' }] });
  });

  it("still masks a field zod has copied: described, given meta, refined (the auditor on #156)", () => {
    for (const email of [pii().describe('Their address'), pii().meta({ title: 'Email' }), pii().refine(() => true),
      pii(z.string(), 'pay').describe('x').optional()]) {
      const plan = planOf(piiRecord('users', z.object({ id: idString(), email })));
      expect(maskOutput(plan, { id: 'u-1', email: 'a.person@example.in' }, sightOf([])).value).toEqual({ id: 'u-1', email: { masked: SIX } });
    }
    const kept = planOf(piiRecord('users', z.object({ id: idString(), phone: pii(z.string(), 'last4').describe('Phone') })));
    expect(maskOutput(kept, { id: 'u-1', phone: '+919876543210' }, sightOf([])).value).toEqual({ id: 'u-1', phone: { masked: '••••••3210' } });
  });

  it('refuses a pii() field behind a lazy, which the walk would otherwise miss', () => {
    expect(() => piiPlan(piiRecord('users', z.object({ id: idString(), email: z.lazy(() => pii()) })))).toThrow(/lazy can't be masked/);
  });

  it("shows a record's own whole and last4 fields to its seenWith key, never pay or a record nested in it (RAD-90)", () => {
    const party = piiRecord('parties', z.object({ id: idString(), phone: pii(z.string(), 'last4'),
      address: z.object({ city: pii() }), bank: pii(z.string(), 'pay'),
      contact: piiRecord('users', z.object({ id: idString(), email: pii() })) }), { seenWith: 'parties:contact' });
    const one = { id: 'p-1', phone: '+919876543210', address: { city: 'Pune' }, bank: '1234567890', contact: { id: 'u-1', email: 'a@b.in' } };
    const shown = maskOutput(planOf(party), one, sightOf(['parties:contact']));
    expect(shown.value).toEqual({ ...one, bank: { masked: SIX }, contact: { id: 'u-1', email: { masked: SIX } } });
    expect(shown.looks).toEqual([{ table: 'parties', id: 'p-1' }]);
    // pii:read shows both records' whole fields; pay:read alone shows only pay.
    expect(maskOutput(planOf(party), one, sightOf(['pii:read'])).value).toEqual({ ...one, bank: { masked: SIX } });
    expect(maskOutput(planOf(party), one, sightOf(['pay:read'])).value).toEqual({ id: 'p-1', phone: { masked: '••••••3210' },
      address: { city: { masked: SIX } }, bank: '1234567890', contact: { id: 'u-1', email: { masked: SIX } } });
    expect(() => piiRecord('parties', z.object({ id: idString() }), { seenWith: 'Contact' })).toThrow(/permission key/);
    expect(() => piiPlan(z.union([party, piiRecord('parties', z.object({ id: idString(), phone: pii() }))])))
      .toThrow(/seen with different keys/);
  });

  it('shows nothing to a request that is not direct, whatever its keys (ADR-005 §7c)', () => {
    const sight = sightOf(['pii:read', 'pay:read', 'parties:contact'], false);
    expect([sight('whole'), sight('last4', 'parties:contact'), sight('pay')]).toEqual([false, false, false]);
    expect(maskOutput(planOf(person), asha, sight).looks).toEqual([]);
  });

  it('has no plan for an output without pii()', () => {
    expect(piiPlan(listOf(z.object({ id: idString(), name: z.string() })))).toBeNull();
  });

  it('refuses a pii() field outside a piiRecord, a piiRecord without an id, and a wrapper it cannot follow', () => {
    expect(() => piiPlan(z.object({ id: idString(), phone: pii() }))).toThrow(/outside any piiRecord/);
    expect(() => piiPlan(piiRecord('people', z.object({ phone: pii() }) as never))).toThrow(/has no id/);
    expect(() => piiPlan(piiRecord('people', z.object({ id: idString(), more: z.record(z.string(), pii()) })))).toThrow(/can't be masked/);
    expect(() => piiPlan(piiRecord('people', z.object({ id: idString(), more: z.tuple([pii()]) })))).toThrow(/can't be masked/);
    expect(() => piiRecord('People', z.object({ id: idString() }))).toThrow(/table/);
  });
});

// RAD-89: a cost (a purchase price) is masked whole without cost:read, and is nobody's personal data.
describe('cost()', () => {
  const item = z.object({ id: idString(), sku: z.string(), purchasePrice: cost(z.string().nullable()) });
  const row = { id: '3f2b8c9e-1d4a-4f6b-9c2e-7a1b5d3e9f01', sku: 'P-1', purchasePrice: '64000.000000' };

  it('may sit outside any piiRecord, and is masked whole without cost:read, whatever else is held', () => {
    const plan = planOf(listOf(item));
    const shown = (keys: string[], direct = true) => maskOutput(plan, { items: [row], next: null }, sightOf(keys, direct));
    expect(shown(['pii:read', 'pay:read']).value).toEqual({ items: [{ ...row, purchasePrice: { masked: SIX } }], next: null });
    expect(shown(['cost:read']).value).toEqual({ items: [row], next: null });
    // Not direct: masked whatever the keys, as personal data is.
    expect(shown(['cost:read'], false).value).toEqual({ items: [{ ...row, purchasePrice: { masked: SIX } }], next: null });
  });

  it('logs no look when shown, in a record or not, and leaves a null alone', () => {
    const inRecord = piiRecord('stock_items', z.object({ id: idString(), name: pii(), purchasePrice: cost(z.string()) }));
    const shown = maskOutput(planOf(inRecord), { id: row.id, name: 'Scooter', purchasePrice: '1.5' }, sightOf(['cost:read']));
    expect([shown.value, shown.looks]).toEqual([{ id: row.id, name: { masked: SIX }, purchasePrice: '1.5' }, []]);
    expect(maskOutput(planOf(item), { ...row, purchasePrice: null }, sightOf([])).value).toEqual({ ...row, purchasePrice: null });
  });

  it('lets a value or a mask through, and masks a cost whole, never keeping its last 4', () => {
    const price = cost(z.string());
    expect([price.parse('12.50'), price.parse({ masked: SIX }), price.safeParse(12.5).success]).toEqual(['12.50', { masked: SIX }, false]);
    expect(maskOf('123456789.000000', 'cost')).toEqual({ masked: SIX });
  });
});

describe('maskedInputPath', () => {
  it('finds a string starting with the six bullets, at any depth, and lets bulleted text through', () => {
    expect(maskedInputPath({ name: 'Asha', phone: '••••••3210' })).toEqual(['phone']);
    expect(maskedInputPath({ lines: [{ a: 1 }, { phone: SIX }] })).toEqual(['lines', 1, 'phone']);
    expect(maskedInputPath({ note: '• first\n• second', short: '•••••x', n: 1, none: null })).toBeNull();
  });
});

describe('looksLikeCardNumber', () => {
  it('finds a Luhn-valid number of 13 to 19 digits, spaces and dashes ignored', () => {
    // Published test numbers (Visa 16, Amex 15, Visa 13), and a Luhn-valid 19.
    expect(['4111 1111 1111 1111', '3782-822463-10005', '4222222222222', '6011 0009 9013 9424 009'].map(looksLikeCardNumber))
      .toEqual([true, true, true, true]);
  });
  it('lets an approval code through: letters, a failed check digit, or a Luhn-valid 12 or 20 digits', () => {
    expect(['A1B2C3', '123456', '4111 1111 1111 1112', '411111111117', '41111111111111111115'].map(looksLikeCardNumber))
      .toEqual([false, false, false, false, false]);
  });
});
