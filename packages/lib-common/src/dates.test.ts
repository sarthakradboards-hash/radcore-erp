import { describe, expect, it } from 'vitest';
import {
  addDays, clockFrom, dateString, financialYear, formatDate, formatMoment, indiaDate, indiaTimeToMoment, isRealDate,
  momentString, momentToIndiaTime, period, periodsOf, serverClock,
} from './index.ts';

describe('RC-168: only real dates pass', () => {
  it.each(['2026-02-31', '2026-02-29', '2100-02-29', '2026-04-31', '2026-13-01', '2026-00-10', '2026-1-01', '07-11-2026',
    '2026-11-07T00:00:00Z', ''])('refuses "%s"', (s) => {
    expect(isRealDate(s)).toBe(false);
    expect(dateString().safeParse(s).success).toBe(false);
    expect(() => formatDate(s)).toThrow(RangeError);
    expect(() => financialYear(s)).toThrow(RangeError);
  });

  it.each(['2026-02-28', '2028-02-29', '2000-02-29', '2026-12-31'])('accepts "%s"', (s) => {
    expect(dateString().safeParse(s).success).toBe(true);
  });

  it('refuses a moment that is not UTC ISO 8601', () => {
    expect(momentString().safeParse('2026-11-06T08:30:00Z').success).toBe(true);
    expect(momentString().safeParse('2026-11-06T08:30:00+05:30').success).toBe(false);
    expect(momentString().safeParse('2026-02-30T08:30:00Z').success).toBe(false);
    expect(() => indiaDate('2026-11-07')).toThrow(RangeError);
  });
});

describe('RC-204: India time, whatever the device says', () => {
  it("gives India's today, not UTC's", () => {
    // 20:00 UTC on 6 Nov is 01:30 on 7 Nov in India.
    expect(clockFrom(() => new Date('2026-11-06T20:00:00Z')).today()).toBe('2026-11-07');
    expect(indiaDate('2026-11-06T18:29:59Z')).toBe('2026-11-06');
    expect(indiaDate('2026-11-06T18:30:00Z')).toBe('2026-11-07');
  });

  it('turns India wall time into the same UTC moment in any device zone', () => {
    expect(indiaTimeToMoment('2026-11-07T15:30')).toBe('2026-11-07T10:00:00.000Z');
    expect(indiaTimeToMoment('2026-11-07T02:00')).toBe('2026-11-06T20:30:00.000Z');
    expect(momentToIndiaTime('2026-11-06T20:30:00.000Z')).toBe('2026-11-07T02:00');
    for (const bad of ['2026-02-30T10:00', '2026-11-07T24:00', '2026-11-07 15:30', '2026-11-07T15:30:00']) {
      expect(() => indiaTimeToMoment(bad)).toThrow(RangeError);
    }
  });

  it("uses the server's time when the device clock is a day off", () => {
    const device = new Date('2026-11-05T09:00:00Z'); // the device thinks it is 5 Nov
    let deviceNow = device;
    const clock = serverClock('2026-11-07T09:00:00Z', device, () => deviceNow);
    expect(clock.today()).toBe('2026-11-07');
    deviceNow = new Date('2026-11-05T12:00:00Z'); // three hours later on the device
    expect(clock.now().toISOString()).toBe('2026-11-07T12:00:00.000Z');
    expect(() => serverClock('2026-11-07', device, () => deviceNow)).toThrow(RangeError);
  });

  it('hands out a copy, so a caller cannot move the clock', () => {
    const fixed = new Date('2026-11-07T10:00:00Z');
    const clock = clockFrom(() => fixed);
    clock.now().setUTCFullYear(2000);
    expect(clock.now().toISOString()).toBe('2026-11-07T10:00:00.000Z');
  });
});

describe('financial years and periods', () => {
  it.each([
    ['2026-04-01', '2026-04-01', '2027-03-31', '2026-27'],
    ['2027-03-31', '2026-04-01', '2027-03-31', '2026-27'],
    ['2026-03-31', '2025-04-01', '2026-03-31', '2025-26'],
    ['2099-12-31', '2099-04-01', '2100-03-31', '2099-00'],
  ])('%s is in the year %s to %s (%s)', (date, start, end, label) => {
    expect(financialYear(date)).toEqual({ start, end, label });
  });

  it('gives the month as the period, with its true last day', () => {
    expect(period('2026-02-14')).toEqual({ start: '2026-02-01', end: '2026-02-28', label: '2026-02' });
    expect(period('2028-02-01').end).toBe('2028-02-29');
    expect(period('2026-12-31').end).toBe('2026-12-31');
  });

  it('lists the twelve periods of a year, April to March', () => {
    const labels = periodsOf(financialYear('2026-11-07')).map((p) => p.label);
    expect(labels).toEqual(['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11',
      '2026-12', '2027-01', '2027-02', '2027-03']);
  });
});

describe('display', () => {
  it('shows dates as DD-MM-YYYY and moments in India time', () => {
    expect(formatDate('2026-11-07')).toBe('07-11-2026');
    expect(formatMoment('2026-11-07T10:00:00Z')).toBe('07-11-2026 15:30');
    expect(formatMoment(new Date('2026-11-06T18:45:00Z'))).toBe('07-11-2026 00:15');
  });
});

it('runs on a device outside India (vitest.config.ts)', () => {
  expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('America/Los_Angeles');
});

describe('addDays', () => {
  it.each([
    ['2026-02-28', 1, '2026-03-01'], ['2028-02-28', 1, '2028-02-29'], ['2026-12-31', 1, '2027-01-01'],
    ['2026-03-01', -1, '2026-02-28'], ['2026-11-07', 0, '2026-11-07'], ['2026-03-31', 30, '2026-04-30'],
  ])('%s plus %i days is %s', (date, days, want) => {
    expect(addDays(date, days)).toBe(want);
  });

  it('refuses a date that is not real and a part of a day', () => {
    expect(() => addDays('2026-02-30', 1)).toThrow(RangeError);
    expect(() => addDays('2026-02-28', 0.5)).toThrow(RangeError);
  });
});
