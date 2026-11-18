// The people list (RAD-36, RAD-57's Admin screen): everyone, in any status, a page at a time, searched by name or
// address, filtered by status and role, and sorted by name, address or last sign-in. A page key is the sort column's
// value and the id (lists.ts's sortedCursor), so paging never skips or repeats. Last sign-in sorts on user_sign_ins'
// sort_key, which is epoch for someone who never signed in, since a sort key is never null; every person has the row,
// so the join is inner and the key is never missing (the architect on RAD-36). The answer is the real time, or null.
import { after, platformTx, roleGrants, roles, searchWords, secondFactors, userSignIns, users } from '@radcore/db/platform';
import { and, asc, desc, eq, inArray, isNotNull, or } from 'drizzle-orm';
import { maySee } from '@radcore/lib-common';
import { z } from 'zod';
import type { listUsers } from '../contract.ts';
import type { Ctx } from '../ctx.ts';
import { AppError } from '../errors.ts';
import { decodeCursor, encodeCursor, momentKey, sortedCursor } from '../lists.ts';
import { SECOND_FACTOR_KEYS } from '../permissions.ts';

type In = z.output<typeof listUsers.input>;
type Out = z.input<typeof listUsers.output>;

// Each sortable column, and its page key's own schema. Name first, by default.
const SORTS = {
  displayName: { column: users.displayName, value: z.string().max(120) },
  email: { column: users.email, value: z.string().max(254) },
  lastSignInAt: { column: userSignIns.sortKey, value: momentKey() },
} as const;

/** GET /admin/users (users:read). */
export async function listPeople(ctx: Ctx, input: In): Promise<Out> {
  const self = ctx.principal.kind === 'user' ? ctx.principal.userId : '';
  const sort = input.sort ?? { column: 'displayName', desc: false };
  // The address is pii() (RAD-103): someone who sees it masked can't find people by it, or learn its order.
  const seesEmail = maySee('whole', ctx.principal.permissions);
  if (sort.column === 'email' && !seesEmail) {
    throw new AppError('invalid_input', 'Sort by name or last sign-in', [{ path: ['sort', 'column'], code: 'needs_pii_read',
      message: 'Addresses are hidden from you, so you can’t sort by them' }]);
  }
  const { column, value } = SORTS[sort.column];
  const key = input.after === undefined ? undefined
    : decodeCursor(sortedCursor(sort, value), input.after);
  const { search, status, role } = input.filter;
  const tx = platformTx(ctx);
  const rows = await tx.select({ id: users.id, displayName: users.displayName, email: users.email, status: users.status,
    role: users.role, lastSignInAt: userSignIns.lastSignInAt, sortValue: column }).from(users)
    .innerJoin(userSignIns, eq(userSignIns.userId, users.id))
    .where(and(
      searchWords(seesEmail ? [users.displayName, users.email] : [users.displayName], search),
      status === undefined ? undefined : eq(users.status, status),
      role === undefined ? undefined : eq(users.role, role),
      after([column, users.id], key && [key.value, key.id], sort.desc ? 'desc' : 'asc'),
    ))
    .orderBy(...(sort.desc ? [desc(column), desc(users.id)] : [asc(column), asc(users.id)]))
    .limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  // D-19 for the page in two reads: who has a factor, and which roles need one, by roleNeedsSecondFactor's rule: the
  // role's own setting, or any key it holds that needs the factor (the auditor on #146).
  const ids = page.map((r) => r.id);
  const enrolled = new Set(ids.length === 0 ? [] : (await tx.select({ id: secondFactors.userId }).from(secondFactors)
    .where(and(inArray(secondFactors.userId, ids), isNotNull(secondFactors.confirmedAt)))).map((f) => f.id));
  const needs = new Set((await tx.select({ key: roles.key }).from(roles)
    .leftJoin(roleGrants, and(eq(roleGrants.role, roles.key), inArray(roleGrants.permission, [...SECOND_FACTOR_KEYS])))
    .where(or(eq(roles.secondFactorRequired, true), isNotNull(roleGrants.permission)))).map((r) => r.key));
  const last = page.at(-1);
  return {
    items: page.map((r) => ({
      id: r.id, displayName: r.displayName, email: r.email, status: z.enum(['invited', 'active', 'disabled']).parse(r.status),
      role: r.role, lastSignInAt: r.lastSignInAt?.toISOString() ?? null, self: r.id === self,
      secondFactor: enrolled.has(r.id) ? 'enrolled' : needs.has(r.role) ? 'enrolment_required' : 'not_required',
    })),
    next: rows.length > input.limit && last
      ? encodeCursor({ column: sort.column, desc: sort.desc, value: String(last.sortValue), id: last.id }) : null,
  };
}
