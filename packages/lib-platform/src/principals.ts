// A principal as the screens show one (the audit trail, approvals): stored as a key ("user:<id>", "link:<id>",
// "system:<name>", ADR-001 §6a), answered as { kind, id, displayName }, a person's name read once per page. A display
// name isn't pii(): the people list shows it to anyone with users:read.
import { platformTx, users } from '@radcore/db/platform';
import { idString, type principalOut } from '@radcore/lib-common';
import { and, eq, inArray } from 'drizzle-orm';
import type { z } from 'zod';
import type { Ctx } from './ctx.ts';

type PrincipalOut = z.input<typeof principalOut>;

const isUserId = (s: string) => idString().safeParse(s).success;

/** Reads the names of the people among `keys` in one query, and returns how to show any of those keys. */
export async function principalsOf(ctx: Ctx, keys: readonly string[]): Promise<(key: string) => PrincipalOut> {
  const ids = [...new Set(keys.map((k) => k.replace(/^user:/, '')).filter(isUserId))];
  const names = new Map(ids.length === 0 ? [] : (await platformTx(ctx).select({ id: users.id, displayName: users.displayName })
    .from(users).where(inArray(users.id, ids))).map((u) => [u.id, u.displayName]));
  return (key) => {
    const [kind = '', ...rest] = key.split(':');
    const id = rest.join(':');
    if (kind === 'user') return { kind: 'user', id, displayName: names.get(id) ?? null };
    return { kind: kind === 'link' ? 'link' : 'system', id, displayName: null };
  };
}

/** A principal's role as it is now: a person's, by their key ("user:<id>"); a job, a link or anyone else has none. What
 * a document's maker may do (their discount limit, the architect on RAD-112) is judged by it, whoever reads the
 * document. */
export async function roleOf(ctx: Ctx, key: string): Promise<string | undefined> {
  const id = key.replace(/^user:/, '');
  if (!key.startsWith('user:') || !isUserId(id)) return undefined;
  const [row] = await platformTx(ctx).select({ role: users.role }).from(users).where(eq(users.id, id));
  return row?.role;
}

/** Whether this person has an account and it's switched on: for a library that names a person (a party's account
 * manager, RAD-119), since it can't read the users table itself. */
export async function isActiveUser(ctx: Ctx, userId: string): Promise<boolean> {
  if (!isUserId(userId)) return false;
  const [person] = await platformTx(ctx).select({ id: users.id }).from(users).where(and(eq(users.id, userId), eq(users.status, 'active'))).limit(1);
  return person !== undefined;
}
