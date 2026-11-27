// RAD-88's contracts: the company profile is read with company:read and set whole with company:write and a reason.
// The state isn't sent: it's the GSTIN's (RC-112).
import { describe, expect, it } from 'vitest';
import { piiPlan } from '@radcore/lib-common';
import {
  createParty, getCompany, getJournal, getParty, listAccounts, listJournal, listParties, postJournal, reverseJournal, setAccount,
  setCompany, setPartyCredit, updateParty,
} from './contract.ts';

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

  it('take an overseas supplier only as a supplier in 96, with no GSTIN or PAN, and 96 only for one (RAD-153)', () => {
    const abroad = { ...party, kinds: ['supplier'], gstin: null, pan: null, stateCode: '96', overseas: true };
    expect(ok(abroad)).toBe(true);
    expect([ok({ ...abroad, stateCode: '27' }), ok({ ...abroad, overseas: false }), ok({ ...abroad, kinds: ['supplier', 'customer'] }),
      ok({ ...abroad, pan: 'AAPFU0939F' }), ok({ ...abroad, stateCode: '95' })]).toEqual([false, false, false, false, false]);
  });

  it('mask the phone keeping its last 4, and the email and address whole, but never the name, unless seen with parties:contact', () => {
    expect(piiPlan(getParty.output)).toEqual({ table: 'parties', seenWith: 'parties:contact', fields: { phone: { kind: 'last4' }, email: { kind: 'whole' },
      addressLine1: { kind: 'whole' }, addressLine2: { kind: 'whole' }, city: { kind: 'whole' }, pincode: { kind: 'whole' } } });
  });
});

// RAD-86's routes (M2-16's screens): the chart and the journal read with journal:read; a manual journal posted with
// journal:post and an entry reversed with journal:reverse, each with a reason. There's no edit and no delete.
describe('the journal contracts', () => {
  const ID = '3f2b8c9e-1d4a-4f6b-9c2e-7a1b5d3e9f01';
  const manual = { businessDate: '2026-11-14', reason: 'Bank charges for October',
    lines: [{ accountId: ID, debit: '100.00' }, { accountId: '8c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f', credit: '100.00' }] };
  const ok = (input: unknown) => postJournal.input.safeParse(input).success;

  it('read with journal:read; post with journal:post and reverse with journal:reverse, as writes', () => {
    expect([listAccounts, listJournal, getJournal, postJournal, reverseJournal].map((c) => `${c.method} ${c.path} ${c.perm} ${c.tx.readOnly}`))
      .toEqual(['GET /accounts journal:read true', 'GET /journal journal:read true', 'GET /journal/:id journal:read true',
        'POST /journal journal:post false', 'POST /journal/:id/reverse journal:reverse false']);
  });

  it('take a manual journal of two lines or more, each a debit or a credit above zero, with a reason', () => {
    expect(ok(manual)).toBe(true);
    expect(ok({ ...manual, reason: ' ' })).toBe(false);
    expect(ok({ ...manual, lines: manual.lines.slice(0, 1) })).toBe(false);
    expect(ok({ ...manual, lines: [{ accountId: ID, debit: '1.00', credit: '1.00' }, manual.lines[1]] })).toBe(false);
    expect(ok({ ...manual, lines: [{ accountId: ID }, manual.lines[1]] })).toBe(false);
    expect(ok({ ...manual, lines: [{ accountId: ID, debit: '0.00' }, manual.lines[1]] })).toBe(false);
    expect(ok({ ...manual, lines: [{ accountId: ID, debit: '1.001' }, manual.lines[1]] })).toBe(false);
    // An amount that isn't money is refused, not thrown on (RAD-110's ad spend had dec() throw inside its refine).
    expect(ok({ ...manual, lines: [{ accountId: ID, debit: '' }, manual.lines[1]] })).toBe(false);
    expect(ok({ ...manual, lines: [{ accountId: ID, credit: 'abc' }, manual.lines[1]] })).toBe(false);
    expect(ok({ ...manual, businessDate: '2026-02-30' })).toBe(false);
  });

  it("name the engine's refusals, and take a reversal's date and reason", () => {
    expect(postJournal.errors).toEqual(['control_account', 'unbalanced', 'invalid_line', 'unknown_account', 'account_inactive', 'period_locked',
      'year_not_open']);
    expect(reverseJournal.errors).toEqual(['reverse_through_document', 'already_reversed', 'reversal_not_reversible', 'period_locked',
      'year_not_open']);
    expect(reverseJournal.input.safeParse({ id: ID, businessDate: '2026-11-14', reason: 'Posted twice' }).success).toBe(true);
    expect(reverseJournal.input.safeParse({ id: ID, businessDate: '2026-11-14' }).success).toBe(false);
  });

  it('filter the journal by business dates and kind', () => {
    const list = (filter: unknown) => listJournal.input.safeParse({ filter, limit: 50 }).success;
    expect([list({ from: '2026-04-01', to: '2027-03-31', kind: 'manual' }), list({ from: '2026-05-01', to: '2026-04-01' }),
      list({ kind: 'gift' })]).toEqual([true, false, false]);
  });
});

// RAD-86's chart follow-up (the architect's ruling): an account's code, and switching an account off or on, with
// accounts:write and a reason. A code is optional, upper case, at most 12 characters.
describe('the chart contracts', () => {
  const ID = '3f2b8c9e-1d4a-4f6b-9c2e-7a1b5d3e9f01';
  const ok = (input: unknown) => setAccount.input.safeParse(input).success;

  it('change an account with accounts:write, as a write, and name the refusals', () => {
    expect(`${setAccount.method} ${setAccount.path} ${setAccount.perm} ${setAccount.tx.readOnly}`).toBe('PATCH /accounts/:id accounts:write false');
    expect(setAccount.errors).toEqual(['code_taken', 'system_account', 'account_not_empty']);
  });

  it('take a code or null, a switch, or both, always with a reason', () => {
    expect([ok({ id: ID, code: '1001', reason: 'CA scheme' }), ok({ id: ID, code: 'EXP.TRAVEL-1', reason: 'r' }),
      ok({ id: ID, code: null, reason: 'r' }), ok({ id: ID, active: false, reason: 'r' }), ok({ id: ID, code: 'A1', active: true, reason: 'r' })])
      .toEqual([true, true, true, true, true]);
    expect([ok({ id: ID, code: 'exp1', reason: 'r' }), ok({ id: ID, code: '-1', reason: 'r' }), ok({ id: ID, code: 'ABCDEFGHIJKLM', reason: 'r' }),
      ok({ id: ID, code: '', reason: 'r' }), ok({ id: ID, active: false }), ok({ id: ID, reason: 'nothing to change' })])
      .toEqual([false, false, false, false, false, false]);
  });

  it('list each account with its code and whether it is switched on', () => {
    const shape = { id: ID, code: null, name: 'Cash', systemKey: 'cash', type: 'asset', controlKind: 'none', control: false, parentId: null, active: true };
    expect(listAccounts.output.safeParse({ items: [shape] }).success).toBe(true);
    expect(listAccounts.output.safeParse({ items: [{ ...shape, active: undefined }] }).success).toBe(false);
  });
});
