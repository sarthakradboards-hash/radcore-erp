// A principal as the screens show one (the audit trail, approvals): stored as a key ("user:<id>", "link:<id>",
// "system:<name>", ADR-001 §6a), answered as { kind, id, displayName }, a person's name read once per page. A display
// name isn't pii(): the people list shows it to anyone with users:read.
import { platformTx, users } from '@radcore/db/platform';
import { idString } from '@radcore/lib-common';
import { inArray } from 'drizzle-orm';
import type { z } from 'zod';
import type { principalOut } from './approval-contracts.ts';
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
