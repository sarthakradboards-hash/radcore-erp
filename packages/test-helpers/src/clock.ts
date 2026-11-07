// A clock a test sets and moves by hand, passed in where production passes the real one (ctx.clock, ADR-001 E3).
// It never reads the machine's clock, so a test gives the same answer on any run date (RC-156).
// shortcut: shaped by hand to RAD-20's Clock (now, today in IST); once lib-common exports Clock, add
// `satisfies Clock` here and take today() from lib-common's IST helper.

export type FakeClock = {
  /** The current moment, as a fresh Date the caller may change freely. */
  now(): Date;
  /** Today's date in India time, `YYYY-MM-DD`. */
  today(): string;
  /** Jump to a moment, `YYYY-MM-DDTHH:mm:ss(.sss)Z`. */
  set(moment: string): void;
  /** Move forward by a number of milliseconds. */
  advance(ms: number): void;
};

// An explicit UTC moment only: a bare date or a local time would depend on the machine's time zone.
const MOMENT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
// Built from the parts, not one locale's layout, which is CLDR data and can change.
const IST = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });
const istDate = (ms: number): string => {
  const part = Object.fromEntries(IST.formatToParts(ms).map((p) => [p.type, p.value]));
  return `${part['year']}-${part['month']}-${part['day']}`;
};

const parse = (moment: string): number => {
  const ms = Date.parse(moment);
  // Date.parse rolls 2026-02-31 over to March; the round trip catches it.
  if (!MOMENT.test(moment) || Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 19) !== moment.slice(0, 19)) {
    throw new Error(`fakeClock needs a real UTC moment like 2026-11-07T04:30:00Z, got ${JSON.stringify(moment)}`);
  }
  return ms;
};

/** A fake clock starting at `start`. There is no default start: every test names its own date. */
export function fakeClock(start: string): FakeClock {
  let ms = parse(start);
  return {
    now: () => new Date(ms),
    today: () => istDate(ms),
    set: (moment) => { ms = parse(moment); },
    advance: (step) => {
      if (!Number.isFinite(step) || step < 0) throw new Error(`advance needs a finite step of 0 or more, got ${step}`);
      ms += step;
    },
  };
}
