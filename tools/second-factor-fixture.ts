// RAD-33: a test person with a second factor already set up, for tests (and e2e, once it signs in) that need to get
// past D-19's second step. A person whose role needs one (admin, owner, accounts, HR; RAD-35) and who signs in through
// the api's own routes enrols first, or uses this. The secret is sealed exactly as the app seals one.
import { randomUUID } from 'node:crypto';
import type { Config } from '@radcore/lib-platform';
import { Secret, TOTP } from 'otpauth';
import { factorSecrets } from '../packages/lib-platform/src/auth/second-factor.ts';
import { createSecrets } from '../packages/lib-platform/src/secrets.ts';

type Sql = (text: string, values?: unknown[]) => Promise<unknown>;

/** Gives `userId` a confirmed authenticator, written through `sql` (a superuser), and answers its secret. */
export async function enrolTestUser(sql: Sql, userId: string, secrets: Config['secrets']): Promise<string> {
  const id = randomUUID();
  const secret = new Secret({ size: 20 }).base32;
  const sealed = await factorSecrets(createSecrets(secrets)).seal(secret, id);
  await sql(`insert into radcore.second_factors (id, user_id, secret, secret_key_id, confirmed_at)
    values ($1, $2, $3, $4, now())`, [id, userId, sealed.ciphertext, sealed.keyId]);
  return secret;
}

/** The 6-digit code an authenticator app shows for `secret` at `at`. */
export const codeAt = (secret: string, at: Date): string =>
  new TOTP({ secret: Secret.fromBase32(secret), algorithm: 'SHA1', digits: 6, period: 30 }).generate({ timestamp: at.getTime() });
