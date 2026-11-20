// The names of a page's parties, for a list of documents (M3-08). lib-accounts owns parties and answers one at a time,
// so each distinct party on the page is read once.
// shortcut: one read per distinct party; a page holds few, and a batched reader joins lib-accounts if pages grow.
import { getPartyById } from '@radcore/lib-accounts';
import type { Ctx } from '@radcore/lib-platform';

export async function partyNames(ctx: Ctx, ids: readonly string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  for (const id of new Set(ids)) names.set(id, (await getPartyById(ctx, { id })).name);
  return names;
}
