// The one generic route handler (M1-08, ADR-001 §6): every `session` and `public` route runs the same steps, so a
// route is only its contract and its service.
//   principal ─► input (contract.input) ─► a write's Idempotency-Key ─► route permission (contract.perm)
//   ─► one transaction of the contract's kind, with its statement timeout (RC-080)
//   ─► a write claims its saved-once key (M1-09): an earlier committed answer is replayed here ─► service(ctx, input)
//   ─► output checked against contract.output, camelCase as is (RC-199) ─► a write keeps its answer ─► commit ─► 200
//   ─► errors mapped by code: a thrown AppError's code or a PostgreSQL SQLSTATE, never message text (RC-216)
// Still to come, each with its ticket: rate guards (M1-21), sessions (RAD-32), pii() masking (M1-22), Settings in Ctx
// (RAD-48), and webhooks' own lane (M1-27).
import { randomUUID } from 'node:crypto';
import { BUSINESS_RULE_STATUS, newPasswordFields, PASSWORD_MIN_LENGTH, PLATFORM_ERRORS, readInput, RETRY_AFTER_CODES, type Issue, type PlatformErrorCode } from '@radcore/lib-common';
import { AppError, claimSavedOnce, describeError, originAllowed, type Principal, type Route } from '@radcore/lib-platform';
import { acceptInvite, ANSWER_NOT_STORED_ROUTES, changePassword, KEY_EXEMPT_ROUTES, resetPassword } from '@radcore/lib-platform/contract';
import { runInTransaction, type Logger } from '@radcore/lib-platform/runtime';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';

type Database = Parameters<typeof runInTransaction>[0];

export type HandlerDeps = {
  db: Database;
  log: Logger;
  /** Who sent the request: the session's user, or null when signed out. Sessions arrive with RAD-32. */
  authenticate: (req: Request) => Promise<Principal | null>;
  /** PUBLIC_ORIGIN: the one origin a write may come from (ADR-001 §7a). */
  publicOrigin: string;
  /** The new-password check (lib-platform's createNewPasswordCheck), run before the transaction on every field marked
   * newPassword(). A route with such a field refuses to mount without it. */
  newPasswordCheck?: ((password: string) => Promise<'too_short' | 'breached' | null>) | undefined;
};

// What the person reads under the field when the new-password check refuses (ADR-001 §7a).
const PASSWORD_REFUSALS: Readonly<Record<'too_short' | 'breached', string>> = {
  too_short: `Use at least ${PASSWORD_MIN_LENGTH} characters`,
  breached: 'This password is common or has appeared in a data breach. Choose another',
};
// The routes that set a password (ADR-001 §7a): each must show the handler a newPassword() field to check.
const PASSWORD_ROUTES = new Set([acceptInvite, resetPassword, changePassword].map((c) => `${c.method} ${c.path}`));
// The input fields a contract marks newPassword().
const newPasswordKeys = (input: unknown): string[] => Object.entries((input as { shape?: Record<string, unknown> }).shape ?? {})
  .filter(([, schema]) => newPasswordFields.has(schema as never)).map(([key]) => key);

// shortcut: a signed-out caller of a public route runs as this principal, with no permissions; M1-23 adds link principals.
const PUBLIC: Principal = Object.freeze({ kind: 'system', name: 'public', permissions: Object.freeze([]) });

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

// A UUID, as apps/web makes one per submit (ADR-001 §7a).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const onList = (list: readonly string[], route: string): boolean => list.includes(route);

export function mountRoutes(app: Express, routes: readonly Route[], deps: HandlerDeps): void {
  const router = express.Router();
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
  for (const { contract, service } of routes) {
    if (contract.auth === 'webhook') throw new TypeError(`${contract.method} ${contract.path}: a webhook takes its own lane (M1-27)`);
    const route = `${contract.method} ${contract.path}`;
    // ADR-001 §7a: only the fixed lists may skip the key or keep no answer, or the handler refuses to start.
    if (contract.idempotency === 'exempt' && !onList(KEY_EXEMPT_ROUTES, route)) {
      throw new TypeError(`${route}: only KEY_EXEMPT_ROUTES may declare idempotency: 'exempt' (ADR-001 §7a)`);
    }
    if (contract.storesAnswer === false && !onList(ANSWER_NOT_STORED_ROUTES, route)) {
      throw new TypeError(`${route}: only ANSWER_NOT_STORED_ROUTES may declare storesAnswer: false (ADR-001 §7a)`);
    }
    const passwordKeys = newPasswordKeys(contract.input);
    // A wrapped input would hide the field and skip the check, so a password route without one refuses to mount.
    if (PASSWORD_ROUTES.has(route) && passwordKeys.length === 0) {
      throw new TypeError(`${route}: sets a password, but the handler finds no newPassword() field in its input to check`);
    }
    if (passwordKeys.length > 0 && deps.newPasswordCheck === undefined) {
      throw new TypeError(`${route}: a newPassword() field needs the new-password check, and none was given`);
    }
    const handle = async (req: Request, res: Response): Promise<void> => {
      const requestId = randomUUID();
      try {
        const principal = await deps.authenticate(req);
        if (contract.auth === 'session' && principal === null) {
          send(res, platform('signed_out'), requestId);
          return;
        }
        const query = typeof req.query['input'] === 'string' ? req.query['input'] : undefined;
        const input = readInput(contract, { params: req.params as Record<string, string>, query, body: req.body });
        if (!input.ok) {
          send(res, platform('invalid_input', input.error.issues), requestId);
          return;
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
          const value = (input.value as Record<string, unknown>)[field];
          const refused = typeof value === 'string' ? await deps.newPasswordCheck?.(value) : null;
          if (refused !== null && refused !== undefined) {
            send(res, { status: BUSINESS_RULE_STATUS, code: 'password_rejected', message: 'Choose a different password',
              issues: [{ path: [field], code: refused, message: PASSWORD_REFUSALS[refused] }] }, requestId);
            return;
          }
        }
        const key = req.get('idempotency-key') ?? '';
        const output = await runInTransaction(deps.db, contract.tx, principal ?? PUBLIC, requestId, async (ctx) => {
          // Saved-once (M1-09): a write claims its key first, in this transaction, and replays an earlier answer.
          // A key-exempt route sends no key and claims none; a route whose answer holds a secret claims and keeps nothing.
          const once = contract.tx.readOnly || contract.idempotency === 'exempt' ? null
            : await claimSavedOnce(ctx, { route, key, input: input.value, storesAnswer: contract.storesAnswer !== false });
          if (once?.replay === true) return once.answer;
          const checked = contract.output.safeParse(await service(ctx, input.value));
          if (!checked.success) throw new OutputMismatch(`${route}: the output doesn't match its contract`);
          await once?.keep(checked.data);
          return checked.data;
        });
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
