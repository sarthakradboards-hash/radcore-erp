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

/** PUT /parties/:id/tds (parties:manage): a supplier's TDS terms (ADR-009 §4): the section its lines take unless they name
 * another (null for none), and whether its PAN is inoperative, so it's deducted at the no-PAN rate (CA-20). */
export const setPartyTds = defineContract({
  method: 'PUT', path: '/parties/:id/tds', auth: 'session', perm: 'parties:manage', tx: write,
  input: z.object({ id: idString(), defaultSectionId: idString().nullable(), panInoperative: z.boolean(), reason: reason() }),
  output: z.object({}),
  errors: ['unknown_section'],
  dbErrors: {
    '23503:party_tds_default_section_id_tds_sections_id_fk': { code: 'unknown_section', message: 'There is no such TDS section' },
  },
});

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

// TDS deposits (ADR-009 §4, F18): a challan pays the deductions it names, each in full and once.
const deduction = z.object({
  id: idString(), sourceTable: z.string(), sourceId: idString(), partyId: idString(), sectionId: idString(), businessDate: dateString(),
  base: z.string(), rate: z.string(), amount: moneyString(), deposited: z.boolean(),
});
/** GET /tds/deductions (tds:read): newest first, a page at a time; `open` for the ones a deposit can still pay (above 0,
 * not reversed, not deposited). */
export const listTdsDeductions = defineContract({
  method: 'GET', path: '/tds/deductions', auth: 'session', perm: 'tds:read', tx: read,
  input: listInput(z.object({ open: z.literal(true).optional() })), output: listOf(deduction),
});
/** POST /tds/deposits (payments:write): a challan (its number and the bank's BSR code), paid on its date from a bank
 * account, paying these deductions in full. Posts Dr TDS Payable, Cr the bank (F18). */
export const recordTdsDeposit = defineContract({
  method: 'POST', path: '/tds/deposits', auth: 'session', perm: 'payments:write', tx: write,
  input: z.object({ businessDate: dateString(), challanNumber: z.string().trim().min(1).max(20),
    bsrCode: z.string().regex(/^[0-9]{7}$/, 'A BSR code is 7 digits'), accountId: idString(),
    deductionIds: z.array(idString()).min(1).max(500).refine((ids) => new Set(ids).size === ids.length, 'Name each deduction once') }),
  output: z.object({ id: idString(), number: z.string() }),
  errors: ['date_in_future', 'period_locked', 'year_not_open', 'unknown_account', 'account_inactive', 'not_money_account', 'not_bank_account',
    'unknown_deduction', 'deduction_reversed', 'nothing_to_deposit', 'already_deposited', 'series_full'],
  dbErrors: { '23505:ux_tds_deposit_lines_deduction': { code: 'already_deposited', message: 'A deduction here is already deposited' } },
});
