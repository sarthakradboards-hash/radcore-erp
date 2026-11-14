// The api's sign-in, second-factor and password routes, built once at start (RAD-34, RAD-33): Argon2id, with its dummy
// hash made now (RAD-64); the sign-in lockout and the second factor's attempt limit in the shared store, whose pool
// the api closes on stop. The second-factor routes' `before` steps get the secrets library from the handler (§8).
import type { Config } from '../config.ts';
import {
  acceptInvite, changePassword, confirmSecondFactorEnrolment, newRecoveryCodes, removeSecondFactor, resetPassword, signIn,
  startSecondFactorEnrolment, verifySecondFactor,
} from '../contract.ts';
import { createLimiterStore } from '../db/client.ts';
import type { Logger } from '../log.ts';
import { defineRoute } from '../route.ts';
import { createAccount } from './account.ts';
import { createLockout, LOCKOUT } from './lockout.ts';
import { createPasswords } from './passwords.ts';
import { createSecondFactor, SECOND_FACTOR_ATTEMPTS } from './second-factor.ts';
import { secondFactorStatus } from './second-factor-status.ts';
import { signInService } from './sessions.ts';
import { createSignIn } from './sign-in.ts';

export type Auth = Awaited<ReturnType<typeof createAuth>>;

/** `now` is for tests, which never read the run date (RC-156): the TOTP check's clock. */
export async function createAuth(config: Config, log: Logger, { now }: { now?: () => Date } = {}) {
  if (config.rateLimitKey === null) throw new Error('RATE_LIMIT_KEY is not set: the api needs it for its rate limits');
  const store = createLimiterStore(config.database, log, config.rateLimitKey);
  const passwords = await createPasswords();
  const lockout = createLockout(store.limiter({ prefix: 'sign-in', ...LOCKOUT }));
  const credentials = createSignIn({ passwords, lockout, secondFactor: secondFactorStatus });
  const account = createAccount({ passwords, lockout });
  const factor = createSecondFactor({ passwords,
    attempts: store.limiter({ prefix: 'second-factor', ...SECOND_FACTOR_ATTEMPTS }), ...(now === undefined ? {} : { now }) });
  return Object.freeze({
    /** Sign-in, its second-factor steps, and the password routes. */
    routes: [defineRoute(signIn, signInService(credentials)),
      defineRoute(verifySecondFactor, factor.verify, { before: factor.openForVerify }),
      defineRoute(startSecondFactorEnrolment, factor.startEnrolment, { before: factor.sealForEnrolment }),
      defineRoute(confirmSecondFactorEnrolment, factor.confirmEnrolment, { before: factor.openForConfirm }),
      defineRoute(newRecoveryCodes, factor.newRecoveryCodes, { before: factor.openForNewCodes }),
      defineRoute(removeSecondFactor, factor.remove), defineRoute(acceptInvite, account.acceptInvite),
      defineRoute(resetPassword, account.resetPassword), defineRoute(changePassword, account.changePassword)],
    store: { name: 'rate-limit store', stop: () => store.end() },
  });
}
