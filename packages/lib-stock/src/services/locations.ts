// Locations (RAD-92, M2-14). A master: switched off, never deleted (ADR-005 §3, D-12). Two codes that differ only in
// case or spacing are one code: the database's unique `code_key` decides, and its refusal is answered as code_taken,
// so no check here can race another request.
import { after, locations, searchWords, stockTx } from '@radcore/db/stock';
import { AppError, decodeCursor, encodeCursor, sortedCursor, type Ctx } from '@radcore/lib-platform';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { addLocation, listLocations, updateLocation } from '../contract.ts';

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;

const CODE_SORT = { column: 'code', desc: false } as const;

// ux_locations_code_key's refusal, as code_taken; anything else is thrown as it is.
async function sameCodeRefused<T>(write: Promise<T>): Promise<T> {
  try {
    return await write;
  } catch (e) {
    if ((e as { cause?: { constraint?: string } }).cause?.constraint === 'ux_locations_code_key') {
      throw new AppError('code_taken', 'Another location already has this code',
        [{ path: ['code'], code: 'taken', message: 'Choose another code' }]);
    }
    throw e;
  }
}

/** GET /stock/locations (locations:read): by code, a page at a time; a page key is the code's key and the id. */
export async function listPlaces(ctx: Ctx, input: In<typeof listLocations>): Promise<Out<typeof listLocations>> {
  const key = input.after === undefined ? undefined : decodeCursor(sortedCursor(CODE_SORT, z.string().max(20)), input.after);
  const { search, kind, status } = input.filter;
  const rows = await stockTx(ctx).select({ id: locations.id, code: locations.code, name: locations.name, kind: locations.kind,
    active: locations.active, codeKey: locations.codeKey }).from(locations)
    .where(and(
      searchWords([locations.code, locations.name], search),
      kind === undefined ? undefined : eq(locations.kind, kind),
      status === undefined ? undefined : eq(locations.active, status === 'active'),
      after([locations.codeKey, locations.id], key && [key.value, key.id], 'asc'),
    ))
    .orderBy(asc(locations.codeKey), asc(locations.id))
    .limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  return {
    // The CHECK holds kind to LOCATION_KINDS, and the output check confirms it before commit.
    items: page.map((r) => ({ id: r.id, code: r.code, name: r.name, kind: r.kind as Out<typeof listLocations>['items'][number]['kind'],
      active: r.active })),
    next: rows.length > input.limit && last ? encodeCursor({ ...CODE_SORT, value: last.codeKey, id: last.id }) : null,
  };
}

/** POST /stock/locations (locations:write). */
export async function addPlace(ctx: Ctx, input: In<typeof addLocation>): Promise<Out<typeof addLocation>> {
  const [row] = await sameCodeRefused(stockTx(ctx).insert(locations)
    .values({ code: input.code, name: input.name, kind: input.kind }).returning({ id: locations.id }));
  if (row === undefined) throw new Error('the insert returned no row');
  return { id: row.id };
}

/** PATCH /stock/locations/:id (locations:write). */
export async function updatePlace(ctx: Ctx, input: In<typeof updateLocation>): Promise<Out<typeof updateLocation>> {
  const { id, ...fields } = input;
  const changes = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
  const tx = stockTx(ctx);
  const found = Object.keys(changes).length === 0
    ? await tx.select({ id: locations.id }).from(locations).where(eq(locations.id, id))
    : await sameCodeRefused(tx.update(locations).set(changes).where(eq(locations.id, id)).returning({ id: locations.id }));
  if (found.length === 0) throw new AppError('not_found', 'There is no such location');
  return {};
}
