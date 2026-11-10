// Identity formats (M1-03, RC-045): GSTIN, PAN, phone, state codes, email, SKU and ids, checked the same way on the
// API and in the browser. GSTIN, PAN and the state table are ours (ADR-003 §3); phone numbers are libphonenumber-js.
//
// Contracts carry no .transform() (ADR-001 §7a), so the schemas only check. A service stores the normalised form
// (normalisePhone, normaliseEmail), and the database keeps email and SKU unique ignoring case (M1-05).
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { z } from 'zod';

/** GST state and territory codes, the first two characters of a GSTIN and the place-of-supply code. */
export const GST_STATES: Readonly<Record<string, string>> = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand',
  '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim',
  '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya',
  '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh',
  '24': 'Gujarat', '25': 'Daman and Diu (before 2020)', '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra', '28': 'Andhra Pradesh (before 2014)', '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep',
  '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman and Nicobar Islands', '36': 'Telangana',
  '37': 'Andhra Pradesh', '38': 'Ladakh', '97': 'Other Territory', '99': 'Centre Jurisdiction',
};

/** The state's name for a code, or undefined for a code that isn't one. */
export const stateName = (code: string): string | undefined =>
  Object.hasOwn(GST_STATES, code) ? GST_STATES[code] : undefined;

// PAN: five letters, four digits, a letter. The fourth letter is the holder's kind: Person, Company, HUF, Firm,
// AOP, Trust, BOI, Local authority, artificial Juridical person, Government.
const PAN = /^[A-Z]{3}[PCHFATBLJG][A-Z]\d{4}[A-Z]$/;
// A regular taxpayer's GSTIN: state code, PAN, entity number (1-9, then A-Z), "Z", check character.
// shortcut: TDS/TCS deductors, non-resident and UN-body numbers have other layouts and are refused; add them when a
// party of that kind is onboarded.
const GSTIN = /^\d{2}[A-Z]{3}[PCHFATBLJG][A-Z]\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const BASE36 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** The check character of a GSTIN's first 14 characters (GSTN's base-36 Luhn mod 36). */
export function gstinCheckChar(first14: string): string {
  let acc = 0;
  for (let i = 0; i < 14; i++) {
    const product = BASE36.indexOf(first14.charAt(i)) * (i % 2 === 0 ? 1 : 2);
    acc += Math.floor(product / 36) + (product % 36);
  }
  return BASE36.charAt((36 - (acc % 36)) % 36);
}

export const isPan = (s: string): boolean => PAN.test(s);
export const isGstin = (s: string): boolean =>
  GSTIN.test(s) && stateName(s.slice(0, 2)) !== undefined && gstinCheckChar(s) === s.charAt(14);

/** What a GSTIN says about its holder: the state it is registered in and the PAN inside it. */
export function gstinParts(gstin: string): { stateCode: string; state: string; pan: string } {
  if (!isGstin(gstin)) throw new RangeError(`Not a valid GSTIN: "${gstin}"`);
  const stateCode = gstin.slice(0, 2);
  return { stateCode, state: stateName(stateCode) ?? '', pan: gstin.slice(2, 12) };
}

/** A phone number in E.164 ("+919876543210"), read as Indian unless it starts with +; undefined if it isn't one. */
export function normalisePhone(input: string): string | undefined {
  const p = parsePhoneNumberFromString(input, 'IN');
  return p?.isValid() ? p.number : undefined;
}

/** An email address as stored: trimmed and lower case, so two spellings of one address are one person. */
export const normaliseEmail = (s: string): string => s.trim().toLowerCase();

// Wire schemas. Each states what a person typed wrong, in words they can act on.
/** A GSTIN in capitals, with a known state code and a correct check character. */
export const gstinString = () => z.string().refine(isGstin, 'Enter a valid 15-character GSTIN, in capitals');
/** A PAN in capitals, such as ABCPE1234F. */
export const panString = () => z.string().refine(isPan, 'Enter a valid 10-character PAN, in capitals');
/** A GST state code, "01" to "38", "97" or "99". */
export const stateCodeString = () => z.string().refine((s) => stateName(s) !== undefined, 'Choose a state');
/** A phone number as typed; the service stores normalisePhone's form. */
export const phoneString = () => z.string().max(30).refine((s) => normalisePhone(s) !== undefined, 'Enter a valid phone number');
export const emailString = () => z.email({ error: 'Enter a valid email address' }).max(254);
/** An item code: letters, digits and - _ . / with no spaces at either end; unique ignoring case. */
export const skuString = () => z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/, 'Use letters, digits and - _ . / only');
/** A record id. */
export const idString = () => z.uuid({ error: 'Not a record id' });
