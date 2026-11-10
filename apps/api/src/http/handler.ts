// The one generic route handler (M1-08, ADR-001 §6): every `session` and `public` route runs the same steps, so a
// route is only its contract and its service.
//   principal ─► input (contract.input) ─► a write's Idempotency-Key ─► route permission (contract.perm)
//   ─► one transaction of the contract's kind, with its statement timeout (RC-080) ─► service(ctx, input)
//   ─► output checked against contract.output before commit, camelCase as is (RC-199) ─► commit ─► 200
//   ─► errors mapped by code: a thrown AppError's code or a PostgreSQL SQLSTATE, never message text (RC-216)
// Still to come, each with its ticket: origin and rate guards (M1-21), sessions (RAD-32), saved-once's claim and
// replay (M1-09; the key is already required, so writes fail closed), the three key-exempt routes (RAD-61),
// pii() masking (M1-22), Settings in Ctx (RAD-48), and webhooks' own lane (M1-27).
import { randomUUID } from 'node:crypto';
import { BUSINESS_RULE_STATUS, PLATFORM_ERRORS, readInput, type Issue, type PlatformErrorCode } from '@radcore/lib-common';
import { AppError, describeError, type Principal } from '@radcore/lib-platform';
import { ANSWER_NOT_STORED_ROUTES, KEY_EXEMPT_ROUTES } from '@radcore/lib-platform/contract';
import { runInTransaction, type Logger } from '@radcore/lib-platform/runtime';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import type { Route } from './route.ts';

type Database = Parameters<typeof runInTransaction>[0];

export type HandlerDeps = {
  db: Database;
  log: Logger;
  /** Who sent the request: the session's user, or null when signed out. Sessions arrive with RAD-32. */
  authenticate: (req: Request) => Promise<Principal | null>;
};

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

type Failure = { status: number; code: string; message: string; issues: readonly Issue[] };
const platform = (code: PlatformErrorCode, issues: readonly Issue[] = []): Failure =>
  ({ status: PLATFORM_ERRORS[code], code, message: MESSAGES[code], issues });

/** What a thrown error answers with: by its code only. */
function failureOf(err: unknown, declared: readonly string[]): Failure {
  if (err instanceof AppError) {
    // A server error's own text is for the log, never the caller.
    if (err.code === 'server_error') return platform('server_error');
    if (isPlatform(err.code)) return { ...platform(err.code, err.issues), message: err.message };
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

const send = (res: Response, f: Failure, requestId: string) =>
  res.status(f.status).json({ code: f.code, message: f.message, issues: f.issues, requestId });

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
        const output = await runInTransaction(deps.db, contract.tx, principal ?? PUBLIC, requestId, async (ctx) => {
          const checked = contract.output.safeParse(await service(ctx, input.value));
          if (!checked.success) throw new OutputMismatch(`${route}: the output doesn't match its contract`);
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
