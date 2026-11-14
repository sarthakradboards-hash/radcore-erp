import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { idString, isMasked, listOf, maskedInputPath, maskOf, maskOutput, pii, piiPlan, piiRecord } from './index.ts';

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
    expect(maskOutput(plan, asha, []).value).toEqual({ id: 'p-1', name: { masked: SIX }, phone: { masked: '••••••3210' },
      salary: { masked: SIX } });
    expect(maskOutput(plan, asha, ['pii:read']).value).toEqual({ ...asha, salary: { masked: SIX } });
    expect(maskOutput(plan, asha, ['pay:read']).value).toEqual({ id: 'p-1', name: { masked: SIX }, phone: { masked: '••••••3210' },
      salary: '125000.00' });
    expect(maskOutput(plan, asha, ALL).value).toEqual(asha);
  });

  it('logs a look at each record shown with an unmasked value, once, and none when all is masked', () => {
    const plan = planOf(listOf(person));
    const page = { items: [asha, { ...asha, id: 'p-2', salary: null }, asha], next: null };
    expect(maskOutput(plan, page, ALL).looks).toEqual([{ table: 'people', id: 'p-1' }, { table: 'people', id: 'p-2' }]);
    expect(maskOutput(plan, page, ['pay:read']).looks).toEqual([{ table: 'people', id: 'p-1' }]);
    expect(maskOutput(plan, page, []).looks).toEqual([]);
  });

  it('logs a value reached through a relation against its own record, and masks it the same way', () => {
    const order = piiRecord('sales_orders', z.object({ id: idString(), note: pii(),
      customer: piiRecord('customers', z.object({ id: idString(), phone: pii(z.string(), 'last4') })),
      contacts: z.array(z.object({ phone: pii(z.string(), 'last4').optional() })) }));
    const plan = planOf(order);
    const one = { id: 'o-1', note: 'Call first', customer: { id: 'c-1', phone: '+919876543210' },
      contacts: [{ phone: '+911234567890' }, {}] };
    expect(maskOutput(plan, one, []).value).toEqual({ id: 'o-1', note: { masked: SIX },
      customer: { id: 'c-1', phone: { masked: '••••••3210' } }, contacts: [{ phone: { masked: '••••••7890' } }, {}] });
    // The contact sits in the order's record, with no record of its own: a look at the order.
    expect(maskOutput(plan, { ...one, note: null }, ALL).looks).toEqual([{ table: 'customers', id: 'c-1' },
      { table: 'sales_orders', id: 'o-1' }]);
  });

  it('follows a union of records of one table', () => {
    const either = z.union([piiRecord('parties', z.object({ id: idString(), kind: z.literal('a'), phone: pii() })),
      piiRecord('parties', z.object({ id: idString(), kind: z.literal('b'), email: pii() }))]);
    expect(maskOutput(planOf(either), { id: 'x', kind: 'b', email: 'a.person@example.in' }, []).value)
      .toEqual({ id: 'x', kind: 'b', email: { masked: SIX } });
  });

  it('leaves a mask and a null alone', () => {
    const masked = { ...asha, phone: { masked: '••••••3210' }, salary: null };
    expect(maskOutput(planOf(person), masked, ALL)).toEqual({ value: masked, looks: [{ table: 'people', id: 'p-1' }] });
  });

  it("still masks a field zod has copied: described, given meta, refined (the auditor on #156)", () => {
    for (const email of [pii().describe('Their address'), pii().meta({ title: 'Email' }), pii().refine(() => true),
      pii(z.string(), 'pay').describe('x').optional()]) {
      const plan = planOf(piiRecord('users', z.object({ id: idString(), email })));
      expect(maskOutput(plan, { id: 'u-1', email: 'a.person@example.in' }, []).value).toEqual({ id: 'u-1', email: { masked: SIX } });
    }
    const kept = planOf(piiRecord('users', z.object({ id: idString(), phone: pii(z.string(), 'last4').describe('Phone') })));
    expect(maskOutput(kept, { id: 'u-1', phone: '+919876543210' }, []).value).toEqual({ id: 'u-1', phone: { masked: '••••••3210' } });
  });

  it('refuses a pii() field behind a lazy, which the walk would otherwise miss', () => {
    expect(() => piiPlan(piiRecord('users', z.object({ id: idString(), email: z.lazy(() => pii()) })))).toThrow(/lazy can't be masked/);
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

describe('maskedInputPath', () => {
  it('finds a string starting with the six bullets, at any depth, and lets bulleted text through', () => {
    expect(maskedInputPath({ name: 'Asha', phone: '••••••3210' })).toEqual(['phone']);
    expect(maskedInputPath({ lines: [{ a: 1 }, { phone: SIX }] })).toEqual(['lines', 1, 'phone']);
    expect(maskedInputPath({ note: '• first\n• second', short: '•••••x', n: 1, none: null })).toBeNull();
  });
});
