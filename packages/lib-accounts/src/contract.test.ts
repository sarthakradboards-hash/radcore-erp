// RAD-88's contracts: the company profile is read with company:read and set whole with company:write and a reason.
// The state isn't sent: it's the GSTIN's (RC-112).
import { describe, expect, it } from 'vitest';
import { piiPlan } from '@radcore/lib-common';
import { createParty, getCompany, getParty, listParties, setCompany, setPartyCredit, updateParty } from './contract.ts';

const profile = {
  legalName: 'Radboards Pvt Ltd', gstin: '27AAPFU0939F1ZV', addressLine1: 'Plot 4, MIDC', addressLine2: null, city: 'Pune',
  pincode: '411019', reason: 'Setting up the books',
};

describe('the company profile contracts', () => {
  it('read with company:read and set with company:write, each a session route', () => {
    expect([getCompany.method, getCompany.path, getCompany.perm, setCompany.method, setCompany.path, setCompany.perm])
      .toEqual(['GET', '/admin/company', 'company:read', 'PUT', '/admin/company', 'company:write']);
    expect([getCompany.tx.readOnly, setCompany.tx.readOnly]).toEqual([true, false]);
  });

  it('take every field at once, a valid GSTIN and PIN, and a reason; never a state', () => {
    const ok = (input: unknown) => setCompany.input.safeParse(input).success;
    expect(ok(profile)).toBe(true);
    expect(ok({ ...profile, gstin: '27AAPFU0939F1ZX' })).toBe(false); // wrong check character
    expect(ok({ ...profile, pincode: '011019' })).toBe(false);
    expect(ok({ ...profile, legalName: '  ' })).toBe(false);
    expect(ok({ ...profile, reason: undefined })).toBe(false);
    expect(ok({ ...profile, city: undefined })).toBe(false);
    expect(setCompany.input.parse({ ...profile, stateCode: '29' })).not.toHaveProperty('stateCode');
  });

  it('answer null until the profile is set', () => {
    expect(getCompany.output.safeParse({ company: null }).success).toBe(true);
  });
});

// RAD-90's contracts: parties read and changed with their own keys, credit terms only with parties:manage, the tax
// fields checked together, and the personal fields masked (RAD-40).
describe('the party contracts', () => {
  const party = {
    name: 'Shree Motors', kinds: ['dealer'], gstin: '27AAPFU0939F1ZV', pan: 'AAPFU0939F', composition: false, stateCode: '27',
    phone: '9876543210', email: 'a@b.in', addressLine1: null, addressLine2: null, city: null, pincode: null,
  };
  const ok = (input: unknown) => createParty.input.safeParse(input).success;

  it('read with parties:read, change with parties:write, and set credit only with parties:manage', () => {
    expect([listParties, getParty, createParty, updateParty, setPartyCredit].map((c) => `${c.method} ${c.path} ${c.perm}`)).toEqual([
      'GET /parties parties:read', 'GET /parties/:id parties:read', 'POST /parties parties:write', 'PATCH /parties/:id parties:write',
      'PUT /parties/:id/credit parties:manage']);
    expect(createParty.input.parse({ ...party, creditDays: 30, creditLimit: '1000.00' })).not.toHaveProperty('creditLimit');
    expect(setPartyCredit.input.safeParse({ id: '3f2b8c9e-1d4a-4f6b-9c2e-7a1b5d3e9f01', creditDays: 30, creditLimit: '1000.00' }).success)
      .toBe(false); // a reason is required
  });

  it('take one or more kinds, a PAN that is the GSTIN’s, the GSTIN’s state, and composition only with a GSTIN', () => {
    expect(ok(party)).toBe(true);
    expect([ok({ ...party, kinds: [] }), ok({ ...party, kinds: ['dealer', 'dealer'] }), ok({ ...party, kinds: ['agent'] })]).toEqual([false, false, false]);
    expect(ok({ ...party, pan: 'AAAPA1234A' })).toBe(false);
    expect(ok({ ...party, stateCode: '29' })).toBe(false);
    expect(ok({ ...party, gstin: null, pan: null, stateCode: '29' })).toBe(true);
    expect(ok({ ...party, gstin: null, pan: null, composition: true })).toBe(false);
    expect(ok({ ...party, phone: '12' })).toBe(false);
  });

  it('mask the phone keeping its last 4, and the email and address whole, but never the name', () => {
    expect(piiPlan(getParty.output)).toEqual({ table: 'parties', fields: { phone: { kind: 'last4' }, email: { kind: 'whole' },
      addressLine1: { kind: 'whole' }, addressLine2: { kind: 'whole' }, city: { kind: 'whole' }, pincode: { kind: 'whole' } } });
  });
});
