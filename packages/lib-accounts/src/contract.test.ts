// RAD-88's contracts: the company profile is read with company:read and set whole with company:write and a reason.
// The state isn't sent: it's the GSTIN's (RC-112).
import { describe, expect, it } from 'vitest';
import { getCompany, setCompany } from './contract.ts';

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
