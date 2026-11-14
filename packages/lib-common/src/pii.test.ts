import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineContract, idString, isMasked, listOf, maskedInputPath, maskOf, maskOutput, pii, piiPlan } from './index.ts';

const read = { readOnly: true, isolation: 'read committed' } as const;
const person = z.object({ id: idString(), name: z.string(), phone: pii(), salary: pii(z.string(), 'pay').nullable() });
const ALL = ['pii:read', 'pay:read'];
const planOf = (schema: z.ZodType) => {
  const plan = piiPlan(schema);
  if (plan === null) throw new Error('no pii() fields');
  return plan;
};

describe('pii()', () => {
  it('lets a value through as it is, or as a mask, and nothing else', () => {
    const phone = pii();
    expect(phone.parse('+919876543210')).toBe('+919876543210');
    expect(phone.parse({ masked: '••••••3210' })).toEqual({ masked: '••••••3210' });
    expect(phone.safeParse({ masked: '••••••', extra: 1 }).success).toBe(false);
    expect(phone.safeParse(12).success).toBe(false);
  });

  it('isMasked tells a mask from a value', () => {
    expect(isMasked({ masked: '••••••' })).toBe(true);
    expect(isMasked('••••••')).toBe(false);
    expect(isMasked({ masked: 1 })).toBe(false);
    expect(isMasked(null)).toBe(false);
  });
});

describe('maskOf', () => {
  it('shows six bullets whatever the length, and the last 4 only of personal data longer than 6', () => {
    expect(maskOf('+919876543210', 'personal')).toEqual({ masked: '••••••3210' });
    expect(maskOf('a@b.in', 'personal')).toEqual({ masked: '••••••' });
    expect(maskOf('1234567', 'personal')).toEqual({ masked: '••••••4567' });
    expect(maskOf('125000.00', 'pay')).toEqual({ masked: '••••••' });
    expect(maskOf('x'.repeat(40), 'personal').masked).toHaveLength(10);
  });

  it('counts the last 4 in characters, not UTF-16 units', () => {
    expect(maskOf('राम@उदाहरण.भारत', 'personal')).toEqual({ masked: '••••••भारत' });
  });
});

describe('piiPlan and maskOutput', () => {
  const sarah = { id: 'p-1', name: 'Sarah', phone: '+919876543210', salary: '125000.00' };

  it('masks personal data without pii:read, and pay without pay:read', () => {
    const plan = planOf(person);
    expect(maskOutput(plan, sarah, []).value).toEqual({ ...sarah, phone: { masked: '••••••3210' }, salary: { masked: '••••••' } });
    expect(maskOutput(plan, sarah, ['pii:read']).value).toEqual({ ...sarah, salary: { masked: '••••••' } });
    expect(maskOutput(plan, sarah, ['pay:read']).value).toEqual({ ...sarah, phone: { masked: '••••••3210' } });
    expect(maskOutput(plan, sarah, ALL).value).toEqual(sarah);
  });

  it('logs a look at each record shown with an unmasked value, and none when all is masked', () => {
    const plan = planOf(listOf(person));
    const page = { items: [sarah, { ...sarah, id: 'p-2', salary: null }], next: null };
    expect(maskOutput(plan, page, ALL).looks).toEqual(['p-1', 'p-2']);
    expect(maskOutput(plan, page, ['pay:read']).looks).toEqual(['p-1']);
    expect(maskOutput(plan, page, []).looks).toEqual([]);
  });

  it('masks a value reached through a relation, and counts it as a look at the outer record', () => {
    const invoice = z.object({ id: idString(), customer: z.object({ id: idString(), phone: pii() }),
      contacts: z.array(z.object({ phone: pii().optional() })) });
    const plan = planOf(invoice);
    const one = { id: 'i-1', customer: { id: 'c-1', phone: '+919876543210' }, contacts: [{ phone: '+911234567890' }, {}] };
    expect(maskOutput(plan, one, []).value).toEqual({ id: 'i-1', customer: { id: 'c-1', phone: { masked: '••••••3210' } },
      contacts: [{ phone: { masked: '••••••7890' } }, {}] });
    expect(maskOutput(plan, one, ALL).looks).toEqual(['i-1']);
  });

  it('follows a union of objects', () => {
    const either = z.union([z.object({ id: idString(), kind: z.literal('a'), phone: pii() }),
      z.object({ id: idString(), kind: z.literal('b'), email: pii() })]);
    expect(maskOutput(planOf(either), { id: 'x', kind: 'b', email: 'a.person@example.in' }, []).value)
      .toEqual({ id: 'x', kind: 'b', email: { masked: '••••••e.in' } });
  });

  it('leaves a mask and a null alone', () => {
    const plan = planOf(person);
    const masked = { ...sarah, phone: { masked: '••••••3210' }, salary: null };
    expect(maskOutput(plan, masked, ALL)).toEqual({ value: masked, looks: [], unattributed: false });
  });

  it('says when an unmasked value has no record id around it, so it cannot be logged', () => {
    const plan = planOf(z.object({ phone: pii() }));
    expect(maskOutput(plan, { phone: '+919876543210' }, ALL).unattributed).toBe(true);
    expect(maskOutput(plan, { phone: '+919876543210' }, []).unattributed).toBe(false);
  });

  it('has no plan for an output without pii()', () => {
    expect(piiPlan(listOf(z.object({ id: idString(), name: z.string() })))).toBeNull();
  });

  it('refuses a pii() field under a wrapper it cannot follow', () => {
    expect(() => piiPlan(z.record(z.string(), pii()))).toThrow(/can't be masked/);
    expect(() => piiPlan(z.tuple([pii()]))).toThrow(/can't be masked/);
  });
});

describe('maskedInputPath', () => {
  it('finds a value shaped like a mask, at any depth', () => {
    expect(maskedInputPath({ name: 'Sarah', phone: '••••••3210' })).toEqual(['phone']);
    expect(maskedInputPath({ lines: [{ a: 1 }, { phone: { masked: '••••••' } }] })).toEqual(['lines', 1, 'phone']);
    expect(maskedInputPath({ name: 'Sarah • team', n: 1, none: null })).toBeNull();
  });
});

describe('defineContract with pii()', () => {
  it('names the table its records are in', () => {
    const spec = { method: 'GET', path: '/hr/people/:id', auth: 'session', perm: 'people:read', tx: read,
      input: z.object({ id: idString() }), output: person } as const;
    expect(() => defineContract(spec)).toThrow(/pii\(\) fields, so it names its records' table/);
    expect(defineContract({ ...spec, records: 'people' }).records).toBe('people');
    expect(() => defineContract({ ...spec, records: 'People' })).toThrow(/records/);
  });
});
