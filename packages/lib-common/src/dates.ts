// Dates, India time and financial years (M1-02). On the wire a date is "YYYY-MM-DD" and a moment is ISO 8601 in
// UTC (ADR-001 §7a). lib-common never reads the clock (E3): time comes in through a Clock, built by lib-platform
// from the server's clock, by the web app from the server's time, and by the test fake from a fixed moment.
//
// India has one time zone, Asia/Kolkata, at UTC+05:30 with no daylight saving. "Today" is India's today, never the
// device's or the server's local date (RC-204).
import { z } from 'zod';

const ZONE = 'Asia/Kolkata';

/** A real calendar date, "YYYY-MM-DD": 31 February and 29 February 2026 are refused (RC-168). */
export const dateString = () => z.iso.date({ error: 'Enter a real date as YYYY-MM-DD' });
/** A moment in UTC, "2026-11-06T08:30:00Z", with optional fractions of a second. */
export const momentString = () => z.iso.datetime({ error: 'Enter a moment in UTC, such as 2026-11-06T08:30:00Z' });

const DATE = dateString();
export const isRealDate = (s: string): boolean => DATE.safeParse(s).success;
function checkDate(s: string): void {
  if (!isRealDate(s)) throw new RangeError(`Not a real date: "${s}"`);
}

/** Where time comes from. Ctx carries one (M1-08) and the test helpers fake it (M1-31). */
export interface Clock {
  /** The current moment. */
  now(): Date;
  /** Today's date in India, "YYYY-MM-DD". */
  today(): string;
}

/** A Clock over a source of the current moment. Each call returns a fresh Date, so no caller can move the clock. */
export const clockFrom = (now: () => Date): Clock => ({
  now: () => new Date(now().getTime()),
  today: () => indiaDate(now()),
});

/**
 * The server's time in the browser: the device clock corrected by how far it was from the server when the server's
 * moment arrived. A device set to the wrong day or zone still gets the server's "today" (RC-204).
 */
export function serverClock(serverMoment: string, deviceAtReceipt: Date, deviceNow: () => Date): Clock {
  const offsetMs = toMoment(serverMoment).getTime() - deviceAtReceipt.getTime();
  return clockFrom(() => new Date(deviceNow().getTime() + offsetMs));
}

const indiaParts = new Intl.DateTimeFormat('en-IN', { timeZone: ZONE, year: 'numeric', month: '2-digit',
  day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const parts = (moment: Date) => {
  if (Number.isNaN(moment.getTime())) throw new RangeError('Not a valid moment');
  const p = Object.fromEntries(indiaParts.formatToParts(moment).map((x) => [x.type, x.value]));
  return { y: p['year'] ?? '', m: p['month'] ?? '', d: p['day'] ?? '', hh: p['hour'] ?? '', mi: p['minute'] ?? '' };
};
const MOMENT = momentString();
// A string must be a wire moment: `new Date("2026-11-07")` would quietly read a date as midnight UTC.
function toMoment(m: Date | string): Date {
  if (typeof m !== 'string') return m;
  if (!MOMENT.safeParse(m).success) throw new RangeError(`Not a moment in UTC: "${m}"`);
  return new Date(m);
}

/** The date in India at a moment: 2026-11-06T20:00:00Z is "2026-11-07". */
export function indiaDate(moment: Date | string): string {
  const { y, m, d } = parts(toMoment(moment));
  return `${y}-${m}-${d}`;
}

// Follow-up times (RC-204). A screen's date-and-time field holds India wall time, "2026-11-07T15:30"; the wire
// holds the moment in UTC. These two convert between them without the device's time zone.
const LOCAL = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)$/;

/** India wall time "2026-11-07T15:30" to the moment "2026-11-07T10:00:00.000Z". */
export function indiaTimeToMoment(local: string): string {
  const match = LOCAL.exec(local);
  if (!match?.[1] || !isRealDate(match[1])) throw new RangeError(`Not a date and time as YYYY-MM-DDTHH:mm: "${local}"`);
  return new Date(`${local}:00+05:30`).toISOString();
}

/** A moment to India wall time "YYYY-MM-DDTHH:mm", for a date-and-time field. */
export function momentToIndiaTime(moment: Date | string): string {
  const { y, m, d, hh, mi } = parts(toMoment(moment));
  return `${y}-${m}-${d}T${hh}:${mi}`;
}

// Financial years and periods. India's financial year runs 1 April to 31 March; a period is a calendar month
// (GST returns and the period lock).
export type Span = { start: string; end: string; label: string };

const pad = (n: number, width = 2) => String(n).padStart(width, '0');
const ymd = (s: string) => {
  checkDate(s);
  return { y: Number(s.slice(0, 4)), m: Number(s.slice(5, 7)) };
};
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** The financial year of a date: 2026-11-07 is { start: "2026-04-01", end: "2027-03-31", label: "2026-27" }. */
export function financialYear(date: string): Span {
  const { y, m } = ymd(date);
  const first = m >= 4 ? y : y - 1;
  return { start: `${pad(first, 4)}-04-01`, end: `${pad(first + 1, 4)}-03-31`, label: `${pad(first, 4)}-${pad((first + 1) % 100)}` };
}

/** The month a date falls in: 2026-02-14 is { start: "2026-02-01", end: "2026-02-28", label: "2026-02" }. */
export function period(date: string): Span {
  const { y, m } = ymd(date);
  const label = `${pad(y, 4)}-${pad(m)}`;
  return { start: `${label}-01`, end: `${label}-${pad(lastDay(y, m))}`, label };
}

/** The periods of a financial year, April to March. */
export function periodsOf(fy: Span): Span[] {
  const { y } = ymd(fy.start);
  return Array.from({ length: 12 }, (_, i) => period(`${pad(i < 9 ? y : y + 1, 4)}-${pad(((i + 3) % 12) + 1)}-01`));
}

// Display. Dates as DD-MM-YYYY; moments in India time.
/** "2026-11-07" as "07-11-2026". */
export function formatDate(date: string): string {
  checkDate(date);
  return `${date.slice(8, 10)}-${date.slice(5, 7)}-${date.slice(0, 4)}`;
}

/** A moment in India time: 2026-11-07T10:00:00Z is "07-11-2026 15:30". */
export function formatMoment(moment: Date | string): string {
  const { y, m, d, hh, mi } = parts(toMoment(moment));
  return `${d}-${m}-${y} ${hh}:${mi}`;
}
