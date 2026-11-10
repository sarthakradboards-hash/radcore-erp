// M1-29's opaque cursor: it goes out as base64url of the sort key and comes back checked by the list's own schema;
// anything else is refused with 400 invalid_input, never trusted (ADR-002).
import { cursorString } from '@radcore/lib-common';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppError, decodeCursor, encodeCursor, sortedCursor } from './index.ts';

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
