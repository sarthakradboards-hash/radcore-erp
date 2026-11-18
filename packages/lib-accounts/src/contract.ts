// lib-accounts' route contracts (ADR-001 §6, §7a): declared once, shared by the API and the web app. Like every
// contract file it imports only zod and lib-common (D5), so the browser can load it.
import {
  defineContract, emailString, gstinString, idString, listInput, listOf, moneyString, panString, phoneString, pii, piiRecord,
  reason, searchText, stateCodeString,
} from '@radcore/lib-common';
import { z } from 'zod';

const read = { readOnly: true, isolation: 'read committed' } as const;
const write = { readOnly: false, isolation: 'read committed' } as const;

/** What the company profile holds (M2-02, RAD-88): everything an invoice prints about the seller. The state is the
 * GSTIN's own (its first two characters), so it's answered, never sent. */
const companyFields = z.object({
  legalName: z.string().trim().min(1, 'Enter the company’s legal name').max(200),
  gstin: gstinString(),
  addressLine1: z.string().trim().min(1, 'Enter the address').max(200),
  addressLine2: z.string().trim().max(200).nullable(),
  city: z.string().trim().min(1, 'Enter the city').max(100),
  pincode: z.string().regex(/^[1-9][0-9]{5}$/, 'Enter the 6-digit PIN code'),
});

/** GET /admin/company: the company profile, or null until it's set. Nothing is invoiced while it's null (RC-112). */
export const getCompany = defineContract({
  method: 'GET', path: '/admin/company', auth: 'session', perm: 'company:read', tx: read,
  input: z.object({}),
  output: z.object({ company: companyFields.extend({ stateCode: z.string().length(2) }).nullable() }),
});

/** PUT /admin/company: sets the one company's profile, every field at once (D-02 option A: there is no second
 * company to create, RC-010). A change is audited with the person's reason. */
export const setCompany = defineContract({
  method: 'PUT', path: '/admin/company', auth: 'session', perm: 'company:write', tx: write,
  input: companyFields.extend({ reason: reason() }),
  output: z.object({ stateCode: z.string().length(2) }),
});

// Parties (M2-11, RAD-90): everyone RadCore sells to or buys from.
export const PARTY_KINDS = ['customer', 'dealer', 'franchisee', 'supplier'] as const;
const partyKinds = () => z.array(z.enum(PARTY_KINDS)).min(1, 'Choose at least one kind').max(4)
  .refine((k) => new Set(k).size === k.length, 'Each kind once');

/** A party's own fields, as sent. A personal field is plain here: an edit leaves out what it can't see. */
const partyFields = {
  name: z.string().trim().min(1, 'Name the party').max(200),
  kinds: partyKinds(),
  gstin: gstinString().nullable(),
  pan: panString().nullable(),
  composition: z.boolean(),
  stateCode: stateCodeString(),
  phone: phoneString().nullable(),
  email: emailString().nullable(),
  addressLine1: z.string().trim().max(200).nullable(),
  addressLine2: z.string().trim().max(200).nullable(),
  city: z.string().trim().max(100).nullable(),
  pincode: z.string().regex(/^[1-9][0-9]{5}$/, 'Enter the 6-digit PIN code').nullable(),
};

/** The rules between a party's tax fields, for a whole party: the PAN is the GSTIN's own, the state is the GSTIN's,
 * and a composition dealer is registered. The database holds the same rules as CHECKs. */
export function partyTaxIssues(p: { gstin: string | null; pan: string | null; stateCode: string; composition: boolean }) {
  const issues: { path: string[]; code: string; message: string }[] = [];
  if (p.gstin !== null && p.pan !== null && p.gstin.slice(2, 12) !== p.pan) {
    issues.push({ path: ['pan'], code: 'pan_not_gstin', message: 'The PAN isn’t the one in the GSTIN' });
  }
  if (p.gstin !== null && p.gstin.slice(0, 2) !== p.stateCode) {
    issues.push({ path: ['stateCode'], code: 'state_not_gstin', message: 'The state isn’t the GSTIN’s' });
  }
  if (p.composition && p.gstin === null) {
    issues.push({ path: ['composition'], code: 'composition_needs_gstin', message: 'A composition dealer has a GSTIN' });
  }
  return issues;
}

/** A party as it's answered: phone, email and address are personal data, masked unless the person holds pii:read or
 * parties:contact (Sarthak: "via own permission"; #182's seenWith), and each record shown unmasked is logged as a look.
 * The name is a business's, on every document. */
const party = piiRecord('parties', z.object({
  id: idString(), name: z.string(), kinds: z.array(z.enum(PARTY_KINDS)), gstin: z.string().nullable(),
  pan: z.string().nullable(), composition: z.boolean(), stateCode: z.string(),
  phone: pii(z.string().nullable(), 'last4'), email: pii(z.string().nullable()),
  addressLine1: pii(z.string().nullable()), addressLine2: pii(z.string().nullable()), city: pii(z.string().nullable()),
  pincode: pii(z.string().nullable()),
  creditDays: z.number().int().nullable(), creditLimit: moneyString().nullable(), active: z.boolean(),
}), { seenWith: 'parties:contact' });

/** GET /parties (parties:read): by name, a page at a time, searched by name or GSTIN, filtered by kind and active. */
export const listParties = defineContract({
  method: 'GET', path: '/parties', auth: 'session', perm: 'parties:read', tx: read,
  input: listInput(z.object({ search: searchText().optional(), kind: z.enum(PARTY_KINDS).optional(), active: z.boolean().optional() })),
  output: listOf(party),
});

/** GET /parties/:id (parties:read). */
export const getParty = defineContract({
  method: 'GET', path: '/parties/:id', auth: 'session', perm: 'parties:read', tx: read,
  input: z.object({ id: idString() }), output: party,
});

/** POST /parties (parties:write). Credit terms aren't here: they're set with parties:manage (setPartyCredit).
 * gstin_taken: a GSTIN names one party. */
export const createParty = defineContract({
  method: 'POST', path: '/parties', auth: 'session', perm: 'parties:write', tx: write,
  input: z.object(partyFields).superRefine((p, c) => { for (const i of partyTaxIssues(p)) c.addIssue({ code: 'custom', path: i.path, message: i.message }); }),
  output: z.object({ id: idString() }), errors: ['gstin_taken'],
});

/** PATCH /parties/:id (parties:write): any of a party's own fields; the tax rules are checked on the party as it
 * will be. A party is switched off (`active: false`), never deleted (ADR-005 §3). */
export const updateParty = defineContract({
  method: 'PATCH', path: '/parties/:id', auth: 'session', perm: 'parties:write', tx: write,
  input: z.object(partyFields).partial().extend({ id: idString(), active: z.boolean().optional() }),
  output: z.object({}), errors: ['gstin_taken'],
});

/** PUT /parties/:id/credit (parties:manage): the party's credit days and limit, null for none, with the person's
 * reason. The only way to set them (M2-11). */
export const setPartyCredit = defineContract({
  method: 'PUT', path: '/parties/:id/credit', auth: 'session', perm: 'parties:manage', tx: write,
  input: z.object({ id: idString(), creditDays: z.number().int().min(0).max(365).nullable(), creditLimit: moneyString().nullable(),
    reason: reason() }),
  output: z.object({}),
});
