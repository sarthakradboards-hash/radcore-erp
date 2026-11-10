// The opaque page cursor (M1-29, ADR-002's worked example): `next` is base64url of the page's last sort key, the
// client only sends it back as `after`, and the server never trusts it. decodeCursor checks it against the list's
// own sort-key schema; anything else is 400 invalid_input. A cursor that decodes, even an edited one, only says
// where the page starts: the repo applies the person's scope on every page, so it can't reach outside that scope.
import type { z } from 'zod';
import { AppError } from './errors.ts';

/** A list's sort key, as its last row holds it: `{ invoiceDate: '2026-11-07', id: '…' }`. No nulls (see lists.ts). */
export type SortKey = Readonly<Record<string, string | number>>;

const BASE64URL = /^[A-Za-z0-9_-]{1,512}$/;

const refused = () => new AppError('invalid_input', 'Some of what was sent needs correcting',
  [{ path: ['after'], code: 'bad_cursor', message: 'This page link is out of date. Start the list again.' }]);

/** The `next` to send for a page whose last row has this sort key. */
export const encodeCursor = (key: SortKey): string => Buffer.from(JSON.stringify(key)).toString('base64url');

/**
 * The sort key an `after` cursor holds, checked by the list's own schema (ADR-002: `z.strictObject({ invoiceDate:
 * z.iso.date(), id: z.uuid() })`). Malformed text, a cursor from another list, or one that isn't in its canonical
 * form throws AppError('invalid_input'), which the handler answers with 400.
 */
export function decodeCursor<S extends z.ZodType>(schema: S, cursor: string): z.output<S> {
  if (!BASE64URL.test(cursor)) throw refused();
  const bytes = Buffer.from(cursor, 'base64url');
  // Node's decoder skips what it can't read, so a cursor is accepted only in the exact form encodeCursor writes.
  if (bytes.toString('base64url') !== cursor) throw refused();
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw refused();
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw refused();
  return parsed.data;
}
