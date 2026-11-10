// The new-password check (M1-14, ADR-001 §7a, ADR-003 §3). The generic handler runs it before the transaction on a
// field marked newPassword(): invite accept, reset and change. In order: the length (code points of the NFC form),
// the bundled list (always, so the rule holds with no network), then Pwned Passwords' range API over the outbound
// client. Only the first five hex characters of the password's SHA-1 leave the server. When the API can't answer,
// the bundled list decides alone: refusing every password would block invites and resets for the outage.
import { createHash } from 'node:crypto';
import { PASSWORD_MIN_LENGTH, passwordLength } from '@radcore/lib-common';
import type { Alerter } from '../alerts.ts';
import type { Outbound } from '../http/outbound.ts';
import type { Logger } from '../log.ts';

export const PWNED_ORIGIN = 'https://api.pwnedpasswords.com';
/** For the outbound client this check is given: the range API's own 3 s limit (ADR-001 §7a). */
export const PWNED_TIMEOUT_MS = 3_000;
const ALERT_EVERY_MS = 60 * 60_000;

export type PasswordRejection = 'too_short' | 'breached';
/** null when the password may be set; otherwise why not. `same_as_old` is the service's, since it needs the hash. */
export type NewPasswordCheck = (password: string) => Promise<PasswordRejection | null>;

export type NewPasswordDeps = {
  /** The bundled list, lower-cased (ADR-003 §3). */
  common: ReadonlySet<string>;
  /** An outbound client allowed only PWNED_ORIGIN, with PWNED_TIMEOUT_MS. */
  outbound: Outbound;
  alert: Alerter;
  log: Logger;
  now: () => number;
};

export function createNewPasswordCheck({ common, outbound, alert, log, now }: NewPasswordDeps): NewPasswordCheck {
  let alertedAt: number | null = null;
  // true: the API counts it; false: it doesn't; null: no answer.
  const pwned = async (password: string): Promise<boolean | null> => {
    const hash = createHash('sha1').update(password).digest('hex').toUpperCase();
    try {
      const res = await outbound.request(`${PWNED_ORIGIN}/range/${hash.slice(0, 5)}`, { headers: { 'Add-Padding': 'true' } });
      if (res.status !== 200) return null;
      const suffix = hash.slice(5);
      // Each line is SUFFIX:COUNT; padding lines have a count of 0.
      return res.body.toString('utf8').split(/\r?\n/).some((line) => {
        const [s, n] = line.split(':');
        return s === suffix && Number(n) > 0;
      });
    } catch {
      return null;
    }
  };
  return async (raw) => {
    const password = raw.normalize('NFC');
    if (passwordLength(password) < PASSWORD_MIN_LENGTH) return 'too_short';
    if (common.has(password.toLowerCase())) return 'breached';
    const found = await pwned(password);
    if (found === null) {
      log.error('breached_check_skipped');
      if (alertedAt === null || now() - alertedAt >= ALERT_EVERY_MS) {
        alertedAt = now();
        await alert('Pwned Passwords did not answer: new passwords are checked against the bundled list only');
      }
      return null;
    }
    return found ? 'breached' : null;
  };
}
