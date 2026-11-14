// The opaque page cursor (M1-29, ADR-002's worked example): `next` is base64url of the page's last sort key, the
// client only sends it back as `after`, and the server never trusts it. decodeCursor checks it against the list's
// own sort-key schema; anything else is 400 invalid_input. A cursor that decodes, even an edited one, only says
// where the page starts: the repo applies the person's scope on every page, so it can't reach outside that scope.
import { idString, MAX_CURSOR_LENGTH } from '@radcore/lib-common';
import { eq, type AnyColumn, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { principalId, type Ctx } from './ctx.ts';
import { AppError } from './errors.ts';

/**
 * A list's record scope (RAD-35, ADR-001 §6a; the architect on RAD-35): the condition every list adds to its own filter,
 * so a key held only over the person's own records can't show them anyone else's. `owner` is the column naming the
 * record's owner as audit rows do (`user:<id>`), usually `created_by`. Held over every record, or by a system
 * principal: no condition. Not held at all: forbidden, as the route's own check would have said.
 */
export function listScope(ctx: Ctx, permission: string, owner: AnyColumn): SQL | undefined {
  const p = ctx.principal;
  if (!p.permissions.includes(permission)) throw new AppError('forbidden', 'You may not see this list');
  // A link's holder holds no key (ADR-001 §6a), so it was refused above; it never lists (RAD-41).
  if (p.kind === 'link') throw new AppError('forbidden', 'You may not see this list');
  if (p.kind === 'system' || !(p.ownScope ?? []).includes(permission)) return undefined;
  return eq(owner, principalId(p));
}

/**
 * A list's sort key, as its last row holds it: `{ invoiceDate: '2026-11-07', id: '…' }`. No nulls (see lists.ts).
 * Keep it to short columns, a date or number and an id: a key past the cursor's 512 characters is refused.
 * A timestamp key is the column's own text (momentKey), never a Date or its ISO string.
 */
export type SortKey = Readonly<Record<string, string | number | boolean>>;

// PostgreSQL's timestamptz text, as drizzle's `timestamp({ mode: 'string' })` reads it: up to six fraction digits.
const PG_MOMENT = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(\.\d{1,6})?[+-]\d\d(:\d\d)?$/;
// An ISO moment, as Date#toISOString writes it: milliseconds only.
const ISO_MOMENT = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?(Z|[+-]\d\d:\d\d)$/;

/**
 * A timestamp in a page cursor: the column read as text (`timestamp({ mode: 'string' })`) and passed back as it came,
 * so it keeps PostgreSQL's microseconds. Every row of one transaction shares now(), and a Date or toISOString() keeps
 * only milliseconds, so the next page's `at < key` would skip the rest of that transaction (auditor-2 on #109).
 */
export const momentKey = () => z.string().regex(PG_MOMENT, 'Not a page position');

/** A timestamptz column's text as the ISO moment an answer carries (momentString), to the millisecond. */
export const isoMoment = (pgText: string): string =>
  new Date(pgText.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00')).toISOString();

const BASE64URL = new RegExp(`^[A-Za-z0-9_-]{1,${String(MAX_CURSOR_LENGTH)}}$`);

const refused = () => new AppError('invalid_input', 'Some of what was sent needs correcting',
  [{ path: ['after'], code: 'bad_cursor', message: 'This page link is out of date. Start the list again.' }]);

/**
 * The `next` to send for a page whose last row has this sort key. A key whose cursor would pass MAX_CURSOR_LENGTH
 * throws here, in the list's own test, rather than letting page 2 answer 400 (auditor-2 on #83).
 */
export function encodeCursor(key: SortKey): string {
  // A moment as Date writes it has lost PostgreSQL's microseconds: refuse it here, in the list's own test.
  if (Object.values(key).some((v) => typeof v === 'string' && ISO_MOMENT.test(v))) {
    throw new TypeError('A timestamp sort key is the column\'s own text (momentKey), not a Date\'s ISO string');
  }
  const cursor = Buffer.from(JSON.stringify(key)).toString('base64url');
  if (cursor.length > MAX_CURSOR_LENGTH) {
    throw new TypeError(`A page cursor is at most ${String(MAX_CURSOR_LENGTH)} characters: sort by a shorter column`);
  }
  return cursor;
}

/**
 * The cursor schema of a list sorted by `sort` (RAD-47, ui-2's shape): the sort column, its direction, the last
 * row's value in it (checked by `value`, the column's own schema) and `id`, the tiebreak. A cursor made under another
 * sort doesn't decode under this one, so it answers 400 like any bad cursor.
 */
export const sortedCursor = <V extends z.ZodType>(sort: { column: string; desc: boolean }, value: V) =>
  z.strictObject({ column: z.literal(sort.column), desc: z.literal(sort.desc), value, id: idString() });

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
