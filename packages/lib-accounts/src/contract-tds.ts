// TDS sections and rates (M5-10, RAD-158; ADR-009 §4, §9), re-exported by ./contract: seeded sections, and each one's
// rates by date, read under tds:read and set under tds:write. Like every contract file it imports only zod and
// lib-common (D5).
import { dateString, dec, defineContract, idString, listInput, listOf, moneyString, percentString, reason } from '@radcore/lib-common';
import { z } from 'zod';

const read = { readOnly: true, isolation: 'read committed' } as const;
const write = { readOnly: false, isolation: 'read committed' } as const;

const section = z.object({ id: idString(), code: z.string(), name: z.string(), act2025: z.string(), act1961: z.string(),
  payee: z.enum(['individual', 'other', 'any']) });
const rateFields = {
  rate: percentString(), rateNoPan: percentString(), singleLimit: moneyString().nullable(), yearlyLimit: moneyString().nullable(),
  limitKind: z.enum(['whole', 'excess']), source: z.string().trim().min(1, 'Name where this rate comes from').max(200),
  note: z.string().trim().max(500).nullable(), confirmed: z.boolean(),
};
const rateRow = z.object({ id: idString(), sectionId: idString(), sectionCode: z.string(), effectiveFrom: dateString(), ...rateFields });

/** GET /tds/sections (tds:read): every section, by code. Few, so one answer. */
export const listTdsSections = defineContract({
  method: 'GET', path: '/tds/sections', auth: 'session', perm: 'tds:read', tx: read,
  input: z.object({}), output: z.object({ items: z.array(section) }),
});
/** GET /tds/rates (tds:read): every rate row by section code, then start date, a page at a time; one section's alone. */
export const listTdsRates = defineContract({
  method: 'GET', path: '/tds/rates', auth: 'session', perm: 'tds:read', tx: read,
  input: listInput(z.object({ sectionId: idString().optional() })), output: listOf(rateRow),
});
/** PUT /tds/rates (tds:write): a section's rate from a date, or that date's row corrected, with the reason (ADR-009 §4).
 * The no-PAN rate is never below the rate (CA-20), and an `excess` row names its yearly limit. */
export const setTdsRate = defineContract({
  method: 'PUT', path: '/tds/rates', auth: 'session', perm: 'tds:write', tx: write,
  input: z.object({ sectionId: idString(), effectiveFrom: dateString(), ...rateFields, reason: reason() })
    .refine((r) => dec(r.rateNoPan).gte(dec(r.rate)), { message: 'The no-PAN rate is at least the rate', path: ['rateNoPan'] })
    .refine((r) => r.limitKind === 'whole' || r.yearlyLimit !== null, { message: 'An excess row names its yearly limit', path: ['yearlyLimit'] }),
  output: z.object({ id: idString() }),
  errors: ['unknown_section'],
  dbErrors: { '23503:tds_rates_section_id_tds_sections_id_fk': { code: 'unknown_section', message: 'There is no such TDS section' } },
});
