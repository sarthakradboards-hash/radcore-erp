// The api's sign-in and password routes, built once at start (RAD-34): Argon2id, with its dummy hash made now (RAD-64),
// and the sign-in lockout in the shared store, whose pool the api closes on stop.
import type { Config } from '../config.ts';
import { acceptInvite, changePassword, resetPassword, signIn } from '../contract.ts';
import { createLimiterStore } from '../db/client.ts';
import type { Logger } from '../log.ts';
import { defineRoute } from '../route.ts';
import { createAccount } from './account.ts';
import { createLockout, LOCKOUT } from './lockout.ts';
import { createPasswords } from './passwords.ts';
import { signInService } from './sessions.ts';
import { createSignIn } from './sign-in.ts';

export type Auth = Awaited<ReturnType<typeof createAuth>>;

export async function createAuth(config: Config, log: Logger) {
  const store = createLimiterStore(config.database, log);
  const passwords = await createPasswords();
  const lockout = createLockout(store.limiter({ prefix: 'sign-in', ...LOCKOUT }));
  // shortcut: nobody is asked for a second factor until RAD-33 answers D-19 from the person's role and enrolment.
  const credentials = createSignIn({ passwords, lockout, secondFactor: async () => 'not_required' as const });
  const account = createAccount({ passwords, lockout });
  return Object.freeze({
    /** Sign-in and the three password routes. */
    routes: [defineRoute(signIn, signInService(credentials)), defineRoute(acceptInvite, account.acceptInvite),
      defineRoute(resetPassword, account.resetPassword), defineRoute(changePassword, account.changePassword)],
    store: { name: 'rate-limit store', stop: () => store.end() },
  });
}
