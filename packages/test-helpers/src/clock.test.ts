import { expect, it } from 'vitest';
import { fakeClock } from './index.ts';

it('starts at the given moment and returns a fresh Date each time', () => {
  const clock = fakeClock('2026-11-07T04:30:00Z');
  const a = clock.now();
  a.setUTCFullYear(1999);
  expect(clock.now().toISOString()).toBe('2026-11-07T04:30:00.000Z');
});

it("gives today's date in India time, not UTC", () => {
  // 18:29:59 UTC is 23:59:59 IST; 18:30 UTC is midnight IST the next day.
  const clock = fakeClock('2026-03-31T18:29:59Z');
  expect(clock.today()).toBe('2026-03-31');
  clock.advance(1000);
  expect(clock.today()).toBe('2026-04-01');
});

it('moves only when told to', () => {
  const clock = fakeClock('2026-11-07T00:00:00Z');
  clock.advance(90 * 60_000);
  expect(clock.now().toISOString()).toBe('2026-11-07T01:30:00.000Z');
  clock.set('2027-01-01T00:00:00.250Z');
  expect(clock.now().toISOString()).toBe('2027-01-01T00:00:00.250Z');
  clock.advance(0);
  expect(clock.now().toISOString()).toBe('2027-01-01T00:00:00.250Z');
});

it.each(['2026-11-07', '2026-11-07T10:00:00', '2026-11-07T10:00:00+05:30', '2026-02-31T00:00:00Z', 'soon', ''])(
  'refuses %j as a start: it must be a real UTC moment', (start) => {
    expect(() => fakeClock(start)).toThrow(/real UTC moment/);
  });

it('refuses a bad set and a backward or endless advance', () => {
  const clock = fakeClock('2026-11-07T00:00:00Z');
  expect(() => clock.set('2026-13-01T00:00:00Z')).toThrow(/real UTC moment/);
  for (const step of [-1, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => clock.advance(step)).toThrow(/finite step/);
  expect(clock.now().toISOString()).toBe('2026-11-07T00:00:00.000Z');
});
