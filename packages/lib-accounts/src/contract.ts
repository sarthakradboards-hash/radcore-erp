// lib-accounts' route contracts (ADR-001 §6, §7a): declared once, shared by the API and the web app. Like every
// contract file it imports only zod and lib-common (D5), so the browser can load it.
import { defineContract, gstinString, reason } from '@radcore/lib-common';
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
