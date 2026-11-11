// M1-29's opaque cursor: it goes out as base64url of the sort key and comes back checked by the list's own schema;
// anything else is refused with 400 invalid_input, never trusted (ADR-002).
import { cursorString } from '@radcore/lib-common';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppError, decodeCursor, encodeCursor, isoMoment, momentKey, sortedCursor } from './index.ts';

// ADR-002's worked example: a newest-first invoice list keyed on (invoiceDate, id).
const InvoiceKey = z.strictObject({ invoiceDate: z.iso.date(), id: z.uuid() });
const key = { invoiceDate: '2026-11-07', id: '3f2b8c9e-1d4a-4f6b-9c2e-7a1b5d3e9f01' };
const base64url = (s: string) => Buffer.from(s).toString('base64url');

describe('the page cursor', () => {
  it('goes out opaque, fits the wire schema, and comes back as the same sort key', () => {
    const next = encodeCursor(key);
    expect(next).not.toContain('2026');
    expect(cursorString().safeParse(next).success).toBe(true);
    expect(decodeCursor(InvoiceKey, next)).toEqual(key);
  });

  it.each<[string, string]>([
    ['not base64url at all', 'not a cursor!'],
    ['base64url that is not JSON', base64url('{oops')],
    ["another list's sort key", encodeCursor({ partyName: 'Asha Motors', id: key.id })],
    ['a key with a field added', encodeCursor({ ...key, ownerId: key.id })],
    ['a key whose date is not real', encodeCursor({ ...key, invoiceDate: '2026-02-30' })],
    ['padding the encoder never writes', `${encodeCursor(key)}==`],
    ['a non-canonical last character', `${encodeCursor(key).slice(0, -1)}B`],
    ['an empty string', ''],
  ])('refuses %s with 400 invalid_input on `after`', (_, cursor) => {
    let thrown: unknown;
    try {
      decodeCursor(InvoiceKey, cursor);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(AppError);
    expect(thrown).toMatchObject({ code: 'invalid_input', issues: [{ path: ['after'], code: 'bad_cursor' }] });
  });

  // ADR-002: an edited cursor that still decodes only moves where the page starts; the repo's scope term, applied on
  // every page, keeps it inside the person's records.
  it('decodes an edited but well-formed key, since it only sets where the page starts', () => {
    const edited = { ...key, invoiceDate: '2020-01-01' };
    expect(decodeCursor(InvoiceKey, encodeCursor(edited))).toEqual(edited);
  });
});

const refusedBadCursor = (f: () => unknown) => {
  let thrown: unknown;
  try {
    f();
  } catch (e) {
    thrown = e;
  }
  expect(thrown).toMatchObject({ code: 'invalid_input', issues: [{ path: ['after'], code: 'bad_cursor' }] });
};

describe('the cursor of a sorted list (RAD-47)', () => {
  const byCity = { column: 'city', desc: false };

  it('carries the sort column, its direction, the value and the id, and comes back under the same sort', () => {
    const last = { ...byCity, value: 'Pune', id: key.id };
    expect(decodeCursor(sortedCursor(byCity, z.string()), encodeCursor(last))).toEqual(last);
  });

  it.each<[string, { column: string; desc: boolean }]>([
    ['another column', { column: 'name', desc: false }],
    ['the other direction', { column: 'city', desc: true }],
  ])('refuses a cursor made under %s, since a new sort starts from page one', (_, sort) => {
    refusedBadCursor(() => decodeCursor(sortedCursor(sort, z.string()), encodeCursor({ ...byCity, value: 'Pune', id: key.id })));
  });

  it("refuses a value of the wrong type for the column", () => {
    const byLimit = { column: 'creditLimit', desc: true };
    refusedBadCursor(() => decodeCursor(sortedCursor(byLimit, z.string().regex(/^\d+\.\d{2}$/)),
      encodeCursor({ ...byLimit, value: 'lots', id: key.id })));
  });
});

// auditor-2 on #83: a sort key long enough to pass the cursor's 512 characters would make page 2 answer 400. It's
// refused when the cursor is made instead, so the list's own test finds it.
it('refuses to make a cursor past 512 characters, so a long sort key shows up in its own test', () => {
  expect(() => encodeCursor({ partyName: 'x'.repeat(400), id: key.id })).toThrow(/at most 512/);
  expect(encodeCursor({ partyName: 'x'.repeat(300), id: key.id }).length).toBeLessThanOrEqual(512);
});

// auditor-2 on #109: a timestamp key keeps PostgreSQL's microseconds, or the next page skips the rest of a transaction.
describe('a timestamp sort key', () => {
  it("is the column's own text, with all six fraction digits, and comes back the same", () => {
    const at = '2026-11-11 08:13:23.563412+00';
    expect(decodeCursor(z.strictObject({ at: momentKey(), id: z.uuid() }), encodeCursor({ at, id: key.id }))).toEqual({ at, id: key.id });
    expect(momentKey().safeParse('2026-11-11 13:43:23+05:30').success).toBe(true);
  });

  it("refuses a Date's ISO string, which has lost the microseconds, when the cursor is made and when it comes back", () => {
    expect(() => encodeCursor({ at: '2026-11-11T08:13:23.563Z', id: key.id })).toThrow(/column's own text/);
    expect(momentKey().safeParse('2026-11-11T08:13:23.563Z').success).toBe(false);
  });

  it('turns the text into the ISO moment an answer carries', () => {
    expect(isoMoment('2026-11-11 08:13:23.563412+00')).toBe('2026-11-11T08:13:23.563Z');
    expect(isoMoment('2026-11-11 13:43:23+05:30')).toBe('2026-11-11T08:13:23.000Z');
  });
});
