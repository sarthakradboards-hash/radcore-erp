// Who manages a party (RAD-119, the architect's ruling): the record-scope owner of what it owes, in its own table so
// parties.ts never meets the receivables scope (E7). Set or cleared under parties:manage, audited.
import { accountsTx, partyManagers } from '@radcore/db/accounts';
import { AppError, isActiveUser, type Ctx } from '@radcore/lib-platform';
import { eq } from 'drizzle-orm';

/** Makes `userId` the party's account manager, or clears it (null). The caller holds parties:manage. */
export async function setPartyManager(ctx: Ctx, partyId: string, userId: string | null): Promise<void> {
  const tx = accountsTx(ctx);
  if (userId === null) {
    await tx.delete(partyManagers).where(eq(partyManagers.partyId, partyId));
    return;
  }
  // A person with an account, switched on: the scope owner must be someone who can sign in (the auditor on #276).
  if (!(await isActiveUser(ctx, userId))) throw new AppError('unknown_user', 'There’s no such person, or their account is switched off');
  const owner = `user:${userId}`;
  await tx.insert(partyManagers).values({ partyId, owner }).onConflictDoUpdate({ target: partyManagers.partyId, set: { owner } });
}
