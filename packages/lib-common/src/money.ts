// Money and numbers (M1-01). One set of functions for the API, the worker and the web app (RC-215).
// On the wire every amount, rate and quantity is a decimal string (ADR-001 §7a). Arithmetic is decimal.js, never
// a JavaScript number; display is Intl en-IN, which formats a numeric string exactly.
//
// Rounding rules:
// - Every rounding is half-up: a 5 rounds away from zero (2.345 -> 2.35, -2.345 -> -2.35).
// - Money is rounded to 2 places once, at the end of each line or total, never on the way (lineAmount).
// - Unit prices (rates) keep 6 places, so 0.375 is exact (RC-008).
// - Quantities keep their unit's places, 0 to 3 (the unit decides; roundQty, fitsUnit).
import { Decimal as DecimalJs } from 'decimal.js';
import { ToWords } from 'to-words/en-IN';
import { z } from 'zod';

/** A decimal.js class of our own, so no other code's global Decimal settings can change ours. */
export const Decimal = DecimalJs.clone({ precision: 40, rounding: DecimalJs.ROUND_HALF_UP, toExpNeg: -40, toExpPos: 40 });
export type Decimal = DecimalJs;

export const MONEY_PLACES = 2;
export const RATE_PLACES = 6;
export const MAX_QTY_PLACES = 3;

// Integer digits follow the column widths: numeric(18,2) money, numeric(18,6) unit price, numeric(18,3) quantity.
const shape = (intDigits: number, places: number) =>
  new RegExp(`^-?\\d{1,${intDigits}}${places > 0 ? `(\\.\\d{1,${places}})?` : ''}$`);
const ANY_DECIMAL = /^-?\d+(\.\d+)?$/;
const MONEY_SHAPE = shape(16, MONEY_PLACES);
const RATE_SHAPE = shape(12, RATE_PLACES);
const QTY_SHAPE = shape(15, MAX_QTY_PLACES);

/** A decimal string or a Decimal. Strings must be plain decimals: no exponent, hex, spaces, `Infinity` or `NaN`. */
export type DecimalInput = string | Decimal;

/** Parses a plain decimal string strictly; decimal.js alone would accept "1e5", "0x10" and "Infinity". */
export function dec(x: DecimalInput): Decimal {
  if (typeof x !== 'string') return new Decimal(x);
  if (!ANY_DECIMAL.test(x)) throw new RangeError(`Not a decimal number: "${x}"`);
  return new Decimal(x);
}

/** The sum of a list; 0 for an empty list. */
export const sum = (xs: readonly DecimalInput[]): Decimal => xs.reduce<Decimal>((s, x) => s.plus(dec(x)), new Decimal(0));

const fixed = (d: Decimal, places: number) => {
  const r = d.toDecimalPlaces(places, Decimal.ROUND_HALF_UP);
  return (r.isZero() ? r.abs() : r).toFixed(places); // never "-0.00"
};

const checkPlaces = (places: number) => {
  if (!Number.isInteger(places) || places < 0 || places > MAX_QTY_PLACES) {
    throw new RangeError(`A unit has 0 to ${MAX_QTY_PLACES} decimal places, not ${places}`);
  }
};

/** Money to 2 places, half-up: the wire form, for example "1250.50". */
export const roundMoney = (x: DecimalInput): string => fixed(dec(x), MONEY_PLACES);
/** A unit price to 6 places, half-up: "0.375000". */
export const roundRate = (x: DecimalInput): string => fixed(dec(x), RATE_PLACES);
/** A quantity to its unit's places (0 to 3), half-up. */
export function roundQty(x: DecimalInput, places: number): string {
  checkPlaces(places);
  return fixed(dec(x), places);
}
/** Whether a quantity already fits its unit, so 1.5 of a Nos (0 places) item is refused, not rounded. */
export function fitsUnit(x: DecimalInput, places: number): boolean {
  checkPlaces(places);
  return dec(x).decimalPlaces() <= places;
}

/** A line's amount: quantity times rate, rounded to money once. 100000 at 0.375 is "37500.00" (RC-008). */
export const lineAmount = (qty: DecimalInput, rate: DecimalInput): string => roundMoney(dec(qty).times(dec(rate)));

// Wire schemas. No .transform(): a contract describes the JSON exactly (ADR-001 §7a). Each takes a sign option, as
// the columns do: money({ signed: true }) for balances and round-off, otherwise not negative.
const decimalString = (re: RegExp, what: string) => (opts: { signed?: boolean } = {}) =>
  z.string().regex(re, `Enter ${what}`)
    .refine((s) => opts.signed === true || !s.startsWith('-'), `${what[0]?.toUpperCase()}${what.slice(1)} can't be negative`);
/** Rupees with up to 2 decimals: "1250.50". */
export const moneyString = decimalString(MONEY_SHAPE, 'an amount with up to 2 decimals');
/** A unit price with up to 6 decimals: "0.375" (RC-008). */
export const rateString = decimalString(RATE_SHAPE, 'a rate with up to 6 decimals');
/** A quantity with up to 3 decimals. The line's unit narrows it further (fitsUnit). */
export const quantityString = decimalString(QTY_SHAPE, 'a quantity with up to 3 decimals');

// Display, en-IN: lakh and crore grouping. Intl formats a numeric string exactly, with no float on the way.
const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2,
  maximumFractionDigits: 2, roundingMode: 'halfExpand' });
const plain = Array.from({ length: RATE_PLACES + 1 }, (_, p) =>
  new Intl.NumberFormat('en-IN', { minimumFractionDigits: p, maximumFractionDigits: p, roundingMode: 'halfExpand' }));
const numeric = (x: DecimalInput): `${number}` => {
  const s = typeof x === 'string' ? x : x.toFixed();
  if (!ANY_DECIMAL.test(s)) throw new RangeError(`Not a decimal number: "${s}"`);
  return s as `${number}`; // checked just above; Intl takes a numeric string as an exact decimal
};

/** "₹1,25,000.50". */
export const formatMoney = (x: DecimalInput): string => money.format(numeric(x));
/** Lakh and crore grouping with a fixed number of places (0 to 6): a quantity, a rate or an amount without "₹". */
export function formatNumber(x: DecimalInput, places: number): string {
  const f = plain[places];
  if (!Number.isInteger(places) || f === undefined) throw new RangeError(`0 to ${RATE_PLACES} places, not ${places}`);
  return f.format(numeric(x));
}

const words = new ToWords();
/** The invoice total in words: "One Lakh Twenty Five Thousand Rupees And Fifty Paise Only". */
export const amountInWords = (x: DecimalInput): string => words.convert(roundMoney(x), { currency: true });
