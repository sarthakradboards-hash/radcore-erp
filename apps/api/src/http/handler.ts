// The one generic route handler (M1-08, ADR-001 §6): every `session` and `public` route runs the same steps, so a
// route is only its contract and its service.
//   principal ─► input (contract.input) ─► a write's Idempotency-Key ─► route permission (contract.perm)
//   ─► the new-password check ─► the route's `before` step, outside any transaction (ADR-001 §8, RAD-33)
//   ─► one transaction of the contract's kind, with its statement timeout (RC-080)
//   ─► a write claims its saved-once key (M1-09): an earlier committed answer is replayed here
//   ─► a reason() field is kept as the change's reason, which its audit rows point at (RAD-36)
//   ─► service(ctx, input, { before })
//   ─► output checked against contract.output, camelCase as is (RC-199) ─► pii() fields masked for this principal
//   (RAD-40) ─► a write keeps its masked answer ─► commit ─► who saw what unmasked, in a short write of its own ─► 200
//   ─► errors mapped by code: a thrown AppError's code or a PostgreSQL SQLSTATE, never message text (RC-216)
// The sign-in routes (sign-in, its second-factor steps, sign-out) get ctx.cookie, applied only once the transaction
// commits (RAD-34, RAD-33).
// Still to come, each with its ticket: rate guards (M1-21) and webhooks' own lane (M1-27).
import { randomUUID } from 'node:crypto';
import { BUSINESS_RULE_STATUS, maskedInputPath, maskOutput, newPasswordFields, piiPlan, reasonFields, PASSWORD_MIN_LENGTH,
  PLATFORM_ERRORS, readInput, RETRY_AFTER_CODES, type Issue, type PlatformErrorCode } from '@radcore/lib-common';
import { AppError, claimSavedOnce, cookieFor, deviceOf, describeError, isRateLimitClass, linkPrincipal, originAllowed,
  recordChangeReason, RecordedRefusal, recordLinkAccess, recordLooks, useLink, type Files, type Principal, type RequestGuards,
  type Route, type Secrets, type SessionCookie, type SignInCookie,
} from '@radcore/lib-platform';
import {
  acceptInvite, ANSWER_NOT_STORED_ROUTES, changePassword, KEY_EXEMPT_ROUTES, resetPassword, startSecondFactorEnrolment,
} from '@radcore/lib-platform/contract';
import { runInTransaction, type Logger } from '@radcore/lib-platform/runtime';
import express, { type CookieOptions, type Express, type NextFunction, type Request, type Response } from 'express';

type Database = Parameters<typeof runInTransaction>[0];

export type HandlerDeps = {
  db: Database;
  log: Logger;
  /** Who sent the request: the session's user, or null when signed out. `route` is "METHOD /path", so a read that
   * isn't activity (GET /me, RAD-34) can leave the idle expiry alone. */
  authenticate: (req: Request, route: string) => Promise<Principal | null>;
  /** PUBLIC_ORIGIN: the one origin a write may come from (ADR-001 §7a). */
  publicOrigin: string;
  /** The new-password check (lib-platform's createNewPasswordCheck), run before the transaction on every field marked
   * newPassword(). A route with such a field refuses to mount without it. */
  newPasswordCheck?: ((password: string) => Promise<'too_short' | 'breached' | null>) | undefined;
  /** The process's file store, as ctx.files (RAD-43): only its two signing calls reach a service. */
  files?: Files | undefined;
  /** The secrets library, for routes' `before` steps (RAD-33). A route with one refuses to mount without it. */
  secrets?: Secrets | undefined;
  /** The rate limits in the shared store (RAD-39): per client address on public and link routes, per person on
   * signed-in ones. The api always passes them; a test of something else may leave them out. */
  guards?: RequestGuards | undefined;
};
const READ = { readOnly: true, isolation: 'read committed' } as const;
const WRITE = { readOnly: false, isolation: 'read committed' } as const;

// What the person reads under the field when the new-password check refuses (ADR-001 §7a).
const PASSWORD_REFUSALS: Readonly<Record<'too_short' | 'breached', string>> = {
  too_short: `Use at least ${PASSWORD_MIN_LENGTH} characters`,
  breached: 'This password is common or has appeared in a data breach. Choose another',
};
// The routes that set a password (ADR-001 §7a): each must show the handler a newPassword() field to check.
const PASSWORD_ROUTES = new Set([acceptInvite, resetPassword, changePassword].map((c) => `${c.method} ${c.path}`));
// The one sign-in route that isn't key-exempt: it reads the pending-sign-in cookie, and stores no answer (ADR-001 §7a).
const ENROLMENT_START = `${startSecondFactorEnrolment.method} ${startSecondFactorEnrolment.path}`;
// The input fields a contract marks newPassword(), or reason().
const markedKeys = (registry: { has(schema: never): boolean }) => (input: unknown): string[] =>
  Object.entries((input as { shape?: Record<string, unknown> }).shape ?? {})
    .filter(([, schema]) => registry.has(schema as never)).map(([key]) => key);
const newPasswordKeys = markedKeys(newPasswordFields);
const reasonKeys = markedKeys(reasonFields);

// The Sec-Fetch-Site values of a request that may see pii() values unmasked (ADR-005 §7c).
const DIRECT = new Set(['same-origin', 'none']);
// shortcut: a signed-out caller of a public route runs as this principal, with no permissions.
const PUBLIC: Principal = Object.freeze({ kind: 'system', name: 'public', permissions: Object.freeze([]) });
// A link route's token is looked up by this principal, in a read of its own, before the request runs as the link's holder.
const LINK_CHECK: Principal = Object.freeze({ kind: 'system', name: 'link-check', permissions: Object.freeze([]) });

// PostgreSQL's code for a failure the caller can act on. Every other database error is the server's.
const SQLSTATE: Readonly<Record<string, PlatformErrorCode>> = {
  '23505': 'conflict', // unique_violation
  '23503': 'conflict', // foreign_key_violation
  '40001': 'conflict', // serialization_failure
  '40P01': 'conflict', // deadlock_detected
  '55P03': 'conflict', // lock_not_available: lock_timeout ran out
};
const MESSAGES: Readonly<Record<PlatformErrorCode, string>> = {
  invalid_input: 'Some of what was sent needs correcting',
  idempotency_key_required: 'This request needs an idempotency key',
  signed_out: 'Please sign in',
  forbidden: "You don't have permission to do that",
  not_found: 'Not found',
  conflict: 'Someone else changed this at the same time. Please try again',
  idempotency_mismatch: 'This idempotency key was used for a different request',
  answer_not_kept: 'That answer was shown once and is not kept. Please start again',
  rate_limited: 'Too many requests. Please wait a moment',
  account_locked: 'This account is locked for now',
  server_error: 'Something went wrong on our side',
};

const isPlatform = (code: string): code is PlatformErrorCode => Object.hasOwn(PLATFORM_ERRORS, code);

type Failure = { status: number; code: string; message: string; issues: readonly Issue[]; retryAfterSeconds?: number };
// Too many requests (RAD-39): how many seconds until a retry can succeed, in the body and in Retry-After.
const limited = (wait: number): Failure => ({ ...platform('rate_limited'), retryAfterSeconds: wait });
const platform = (code: PlatformErrorCode, issues: readonly Issue[] = []): Failure =>
  ({ status: PLATFORM_ERRORS[code], code, message: MESSAGES[code], issues });

/** What a thrown error answers with: by its code only. */
function failureOf(err: unknown, declared: readonly string[]): Failure {
  if (err instanceof AppError) {
    // A server error's own text is for the log, never the caller.
    if (err.code === 'server_error') return platform('server_error');
    if (isPlatform(err.code)) {
      const failure: Failure = { ...platform(err.code, err.issues), message: err.message };
      // Only the codes lib-common lets say when to retry (ADR-001 §7a), in whole seconds.
      if (RETRY_AFTER_CODES.includes(err.code) && err.retryAfterSeconds !== undefined) {
        failure.retryAfterSeconds = Math.ceil(err.retryAfterSeconds);
      }
      return failure;
    }
    if (declared.includes(err.code)) return { status: BUSINESS_RULE_STATUS, code: err.code, message: err.message, issues: err.issues };
    return platform('server_error');
  }
  const sqlstate = describeError(err).code;
  const mapped = sqlstate === undefined ? undefined : SQLSTATE[sqlstate];
  return platform(mapped ?? 'server_error');
}

/** The output broke its contract: a bug, so the transaction rolls back and the caller gets 500. */
class OutputMismatch extends Error {
  override name = 'OutputMismatch';
}

const send = (res: Response, f: Failure, requestId: string) => {
  // The screen and any HTTP client read one value: the body's retryAfterSeconds and Retry-After agree (RAD-61).
  if (f.retryAfterSeconds !== undefined) res.set('Retry-After', String(f.retryAfterSeconds));
  res.status(f.status).json({ code: f.code, message: f.message, issues: f.issues, requestId,
    ...(f.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: f.retryAfterSeconds }) });
};

type CookieChange = { token: string; expires: Date } | 'clear' | null;

// A UUID, as apps/web makes one per submit (ADR-001 §7a).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const onList = (list: readonly string[], route: string): boolean => list.includes(route);

export function mountRoutes(app: Express, routes: readonly Route[], deps: HandlerDeps): void {
  const router = express.Router();
  // ADR-001 §7a: the session cookie can't be read by script or sent with another site's request; on https it's also
  // __Host- and Secure, so it can't be set for a subdomain (sessionCookieFor).
  const session = cookieFor(deps.publicOrigin, 'session');
  const pending = cookieFor(deps.publicOrigin, 'pending');
  const COOKIE: CookieOptions = Object.freeze({ httpOnly: true, secure: session.secure, sameSite: 'lax', path: '/' });
  // An answer is one person's data at one moment: no browser or proxy keeps it.
  router.use((_req: Request, res: Response, next: NextFunction) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  // The origin guard comes first (ADR-001 §6, M1-21): a write from anywhere but the app's own origin, or with no
  // Origin, is refused before its body is read, the key-exempt routes included (login CSRF, RC-165).
  router.use((req: Request, res: Response, next: NextFunction) => {
    if (originAllowed(req.method, req.get('origin'), deps.publicOrigin)) {
      next();
      return;
    }
    send(res, platform('forbidden'), randomUUID());
  });
  router.use(express.json({ limit: '1mb' }));
  for (const { contract, service, before } of routes) {
    if (contract.auth === 'webhook') throw new TypeError(`${contract.method} ${contract.path}: a webhook takes its own lane (M1-27)`);
    const route = `${contract.method} ${contract.path}`;
    // A public or link route's class must be one the guards count, so none goes unlimited (RAD-39).
    const addressClass = contract.auth === 'public' || contract.auth === 'link' ? contract.rateLimit : null;
    if (addressClass !== null && !isRateLimitClass(addressClass)) {
      throw new TypeError(`${route}: rateLimit "${addressClass}" isn't a rate-limit class (guards.ts's ADDRESS_LIMITS)`);
    }
    // ADR-001 §7a: only the fixed lists may skip the key or keep no answer, or the handler refuses to start.
    if (contract.idempotency === 'exempt' && !onList(KEY_EXEMPT_ROUTES, route)) {
      throw new TypeError(`${route}: only KEY_EXEMPT_ROUTES may declare idempotency: 'exempt' (ADR-001 §7a)`);
    }
    if (contract.storesAnswer === false && !onList(ANSWER_NOT_STORED_ROUTES, route)) {
      throw new TypeError(`${route}: only ANSWER_NOT_STORED_ROUTES may declare storesAnswer: false (ADR-001 §7a)`);
    }
    const passwordKeys = newPasswordKeys(contract.input);
    const reasonKey = reasonKeys(contract.input)[0];
    // A wrapped input would hide the field and skip the check, so a password route without one refuses to mount.
    if (PASSWORD_ROUTES.has(route) && passwordKeys.length === 0) {
      throw new TypeError(`${route}: sets a password, but the handler finds no newPassword() field in its input to check`);
    }
    if (passwordKeys.length > 0 && deps.newPasswordCheck === undefined) {
      throw new TypeError(`${route}: a newPassword() field needs the new-password check, and none was given`);
    }
    const secrets = deps.secrets;
    const plan = piiPlan(contract.output);
    if (before !== undefined && secrets === undefined) throw new TypeError(`${route}: a before step needs the secrets library`);
    const handle = async (req: Request, res: Response): Promise<void> => {
      const requestId = randomUUID();
      try {
        // The origin guard ran first (above). Then the per-address limit, before the principal, the body or a
        // transaction (ADR-001 §6): a public or link route counts per client address, for its class (RC-088).
        if (deps.guards !== undefined && addressClass !== null && isRateLimitClass(addressClass)) {
          const wait = await deps.guards.address(addressClass, req.ip ?? '');
          if (wait > 0) {
            send(res, limited(wait), requestId);
            return;
          }
        }
        // A link route runs as the link's holder alone, never as whoever's session came with it (ADR-001 §6a).
        let principal = contract.auth === 'link' ? null : await deps.authenticate(req, route);
        if (contract.auth === 'session' && principal === null) {
          // A cookie whose session has ended or expired is cleared, sign-out's included (RAD-34).
          if (session.tokenIn(req.get('cookie')) !== null) res.clearCookie(session.name, COOKIE);
          send(res, platform('signed_out'), requestId);
          return;
        }
        // A signed-in person's requests count per person, over every route (RC-194).
        if (deps.guards !== undefined && principal?.kind === 'user') {
          const wait = await deps.guards.person(principal.userId);
          if (wait > 0) {
            send(res, limited(wait), requestId);
            return;
          }
        }
        const query = typeof req.query['input'] === 'string' ? req.query['input'] : undefined;
        const input = readInput(contract, { params: req.params as Record<string, string>, query, body: req.body });
        if (!input.ok) {
          send(res, platform('invalid_input', input.error.issues), requestId);
          return;
        }
        // A masked value sent back would be saved over the real one (ADR-001 §7a).
        const maskedAt = contract.tx.readOnly ? null : maskedInputPath(input.value);
        if (maskedAt !== null) {
          send(res, platform('invalid_input', [{ path: maskedAt, code: 'masked_value',
            message: 'This value is hidden from you, so it can’t be saved' }]), requestId);
          return;
        }
        // What the service gets: the input, less a link route's token, which no service, log or audit row ever sees.
        let work: unknown = input.value;
        if (contract.auth === 'link') {
          res.set('X-Robots-Tag', 'noindex');
          const { token, ...rest } = input.value as { token: string };
          // One answer for every token that isn't a live link for exactly this action, whatever the reason, by one
          // path, so neither the answer nor its time says which links exist (the architect on RAD-41).
          const holder = await runInTransaction(deps.db, READ, LINK_CHECK, requestId,
            (ctx) => linkPrincipal(ctx, token, contract.action));
          if (holder === null) {
            send(res, platform('not_found'), requestId);
            return;
          }
          principal = holder;
          work = rest;
        }
        // A key-exempt route sets or clears the session cookie, which a stored answer can't (ADR-001 §7a).
        if (!contract.tx.readOnly && contract.idempotency !== 'exempt' && !UUID.test(req.get('idempotency-key') ?? '')) {
          send(res, platform('idempotency_key_required'), requestId);
          return;
        }
        if (contract.perm !== null && !(principal?.permissions.includes(contract.perm) ?? false)) {
          send(res, platform(principal === null ? 'signed_out' : 'forbidden'), requestId);
          return;
        }
        // Before the transaction and the saved-once claim: the check may wait up to 3 s on Pwned Passwords, and must
        // hold no transaction or pooled connection while it does (ADR-001 §7a).
        for (const field of passwordKeys) {
          const value = (work as Record<string, unknown>)[field];
          const refused = typeof value === 'string' ? await deps.newPasswordCheck?.(value) : null;
          if (refused !== null && refused !== undefined) {
            send(res, { status: BUSINESS_RULE_STATUS, code: 'password_rejected', message: 'Choose a different password',
              issues: [{ path: [field], code: refused, message: PASSWORD_REFUSALS[refused] }] }, requestId);
            return;
          }
        }
        const key = req.get('idempotency-key') ?? '';
        // Only the sign-in routes see the cookies: the key-exempt ones, whose answers are never stored and replayed, and
        // the second-factor enrolment start, which stores none (ADR-001 §7a).
        const exempt = contract.idempotency === 'exempt';
        const signInRoute = exempt || route === ENROLMENT_START;
        const changes: { session: CookieChange; pending: CookieChange } = { session: null, pending: null };
        let refused: RecordedRefusal | null = null;
        // The records this principal saw a pii() value of unmasked, logged once the read commits (ADR-005 §7c).
        let looks: string[] = [];
        // Only a request the browser says came from this app, or from a typed address, opens a record in full: a
        // cross-site link can't make someone "look" at a record they never saw (ADR-005 §7c), so it sees masks.
        const direct = DIRECT.has(req.get('sec-fetch-site') ?? '');
        const shown = (answer: unknown): unknown => {
          if (plan === null) return answer;
          const m = maskOutput(plan, answer, direct ? (principal ?? PUBLIC).permissions : []);
          if (m.unattributed) throw new OutputMismatch(`${route}: a pii() value is shown with no record id to log it under`);
          looks = m.looks;
          return m.value;
        };
        const cookieIn = (kind: 'session' | 'pending', tokenIn: (h: string | undefined) => string | null): SignInCookie =>
          Object.freeze({ incoming: tokenIn(req.get('cookie')),
            set: (token: string, expires: Date) => { changes[kind] = { token, expires }; },
            clear: () => { changes[kind] = 'clear'; } });
        const channel: SessionCookie = Object.freeze({ ...cookieIn('session', session.tokenIn),
          device: deviceOf(req.get('user-agent')), pending: cookieIn('pending', pending.tokenIn) });
        const cookie = signInRoute ? channel : undefined;
        // Outside any transaction (ADR-001 §8): a KMS call here holds no transaction or pooled connection. `read` is a
        // short read-only transaction of its own, closed before the call; the service checks nothing it read has moved.
        const meta = { before: before === undefined || secrets === undefined ? undefined : await before(work, {
          secrets, principal: principal ?? PUBLIC, cookie,
          read: (work) => runInTransaction(deps.db, READ, principal ?? PUBLIC, requestId,
            (ctx) => work(cookie === undefined ? ctx : Object.freeze({ ...ctx, cookie })), deps.files),
        }) };
        const output = await runInTransaction(deps.db, contract.tx, principal ?? PUBLIC, requestId, async (ctx) => {
          // Saved-once (M1-09): a write claims its key first, in this transaction, and replays an earlier answer.
          // A key-exempt route sends no key and claims none; a route whose answer holds a secret claims and keeps nothing.
          const once = contract.tx.readOnly || contract.idempotency === 'exempt' ? null
            : await claimSavedOnce(ctx, { route, key, input: work, storesAnswer: contract.storesAnswer !== false });
          if (once?.replay === true) return shown(once.answer);
          // Why: kept once, before the service writes, so every audit row of this change carries its id (RAD-36).
          const why = reasonKey === undefined ? undefined : (input.value as Record<string, unknown>)[reasonKey];
          if (typeof why === 'string') await recordChangeReason(ctx, why);
          // A link that changes something spends one of its uses with the work, so both commit or neither does, and no
          // service can forget to (auditor on #134).
          if (contract.auth === 'link' && !contract.tx.readOnly) await useLink(ctx);
          let answer: unknown;
          try {
            answer = await service(cookie === undefined ? ctx : Object.freeze({ ...ctx, cookie }), work, meta);
          } catch (err) {
            // A failed sign-in's record commits; the person still gets the refusal (RAD-34).
            if (!(exempt && err instanceof RecordedRefusal)) throw err;
            refused = err;
            return null;
          }
          const checked = contract.output.safeParse(answer);
          if (!checked.success) throw new OutputMismatch(`${route}: the output doesn't match its contract`);
          const answered = shown(checked.data);
          await once?.keep(answered);
          return answered;
        }, deps.files);
        // After the commit: a cookie for a session that rolled back would sign nobody in.
        for (const [kind, name] of [['session', session.name], ['pending', pending.name]] as const) {
          const change = changes[kind];
          if (change === 'clear') res.clearCookie(name, COOKIE);
          else if (change !== null) res.cookie(name, change.token, { ...COOKIE, expires: change.expires });
        }
        if (refused !== null) {
          send(res, failureOf(refused, contract.errors), requestId);
          return;
        }
        // What a link's holder opened, as its own short write once the work has committed (ADR-005 §7c). A read-only
        // link spends its use here, before anything is answered: if the last use went to a request racing this one,
        // this one gets the same not_found, and sees nothing.
        // Each record shown unmasked is logged the same way, before the answer goes out: no log, no answer.
        if (principal?.kind === 'link' || looks.length > 0) {
          await runInTransaction(deps.db, WRITE, principal ?? PUBLIC, requestId, async (ctx) => {
            if (principal?.kind === 'link') {
              if (contract.tx.readOnly) await useLink(ctx);
              await recordLinkAccess(ctx);
            }
            if (contract.records !== undefined) await recordLooks(ctx, contract.records, looks);
          });
        }
        res.status(200).json(output);
      } catch (err) {
        const failure = failureOf(err, contract.errors);
        // Ids only: never the input, the output or a value from the database (RAD-29).
        if (failure.status >= 500) deps.log.error(`${route} failed (request ${requestId})`, err);
        send(res, failure, requestId);
      }
    };
    router[contract.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete'](contract.path, handle);
  }
  // A body that isn't JSON, or is too large, never reaches a route.
  router.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    const type = (err as { type?: unknown }).type;
    if (type === 'entity.parse.failed' || type === 'entity.too.large') {
      send(res, platform('invalid_input', [{ path: [], code: String(type), message: 'The request body is not valid JSON, or is too large' }]), randomUUID());
      return;
    }
    next(err);
  });
  app.use(router);
}
