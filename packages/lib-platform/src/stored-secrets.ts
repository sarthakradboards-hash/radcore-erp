// An integration's secret by its name (RAD-107, the architect): a provider's webhook key, app secret or verify token,
// in `integration_secrets`. Read in a short transaction of its own and decrypted after it closes, since a decrypt is a
// KMS call in staging and production; read for each request, so a rotated secret applies at once. Set by the owner
// login with tools/set-secret.ts (storeSecret), which reads the value from stdin only.
import { integrationSecrets, platformTx } from '@radcore/db/platform';
import { eq } from 'drizzle-orm';
import type { Ctx } from './ctx.ts';
import type { SecretPlace, Secrets } from './secrets.ts';

/** Runs `work` in a short transaction of its own: a route's `before` read, the webhook lane's, or the script's write. */
export type ReadOnce = <R>(work: (ctx: Ctx) => Promise<R>) => Promise<R>;

/** Where a named secret lives: bound into its ciphertext, so one copied to another name won't decrypt. */
const placeOf = (name: string): SecretPlace => ({ table: 'integration_secrets', column: 'ciphertext', rowId: name });

/** The value, or null when none is stored under the name. */
export async function storedSecret(read: ReadOnce, secrets: Secrets, name: string): Promise<string | null> {
  const row = await read(async (ctx) => (await platformTx(ctx).select({ ciphertext: integrationSecrets.ciphertext })
    .from(integrationSecrets).where(eq(integrationSecrets.name, name)))[0]);
  return row === undefined ? null : secrets.decrypt(row.ciphertext, placeOf(name));
}

/** Sets a named secret, replacing the old one: encrypted first, outside the write. */
export async function storeSecret(write: ReadOnce, secrets: Secrets, name: string, value: string): Promise<void> {
  const ciphertext = await secrets.encrypt(value, placeOf(name));
  await write((ctx) => platformTx(ctx).insert(integrationSecrets).values({ name, ciphertext, keyId: secrets.keyId })
    .onConflictDoUpdate({ target: integrationSecrets.name, set: { ciphertext, keyId: secrets.keyId } }));
}
