// M1-29's opaque cursor: it goes out as base64url of the sort key and comes back checked by the list's own schema;
// anything else is refused with 400 invalid_input, never trusted (ADR-002).
import { cursorString } from '@radcore/lib-common';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppError, decodeCursor, encodeCursor } from './index.ts';

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
