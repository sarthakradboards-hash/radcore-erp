// The secrets expiry watch (RAD-65, RC-213): an outside service's token stops working on its expiry date, so the
// worker warns people while there's still time to renew it. Daily, as a system principal that only reads platform's
// own table; each alert names the secret and its date, never its value or ciphertext.
import { platformTx, secrets } from '@radcore/db/platform';
import { isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import type { Ctx } from './ctx.ts';
import type { JobContract, JobMeta } from './jobs.ts';
import { expiringBefore } from './secrets.ts';

/** How far ahead the watch looks: two weeks gives time to renew a token through its provider. */
const WARN_AHEAD_MS = 14 * 86_400_000;

export const secretsExpiryWatch: JobContract<object | null> = {
  name: 'platform.secrets-expiry',
  principal: { kind: 'system', name: 'secrets-expiry', permissions: [] },
  // A schedule sends no payload.
  input: z.strictObject({}).nullable(),
  // Daily at 06:23 UTC, before the working day in India (11:53 IST).
  every: '23 6 * * *',
  oneAtATime: true,
};

/** Alerts once for each secret that expires within the next two weeks (or already has), soonest first. */
export async function watchSecretExpiry(ctx: Ctx, _input: object | null, { alert }: JobMeta): Promise<void> {
  const rows = await platformTx(ctx).select({ id: secrets.id, name: secrets.name, expiresAt: secrets.expiresAt })
    .from(secrets).where(isNotNull(secrets.expiresAt));
  const now = Date.now();
  const due = expiringBefore(rows.map((r) => ({ ...r, expiresAt: r.expiresAt?.toISOString() ?? null })),
    new Date(now + WARN_AHEAD_MS).toISOString());
  for (const s of due) {
    const when = Date.parse(s.expiresAt ?? '') <= now ? 'has expired' : 'expires';
    await alert(`secret ${s.name} (row ${s.id}) ${when} on ${s.expiresAt ?? 'an unreadable date'}: renew it with its provider`);
  }
}
