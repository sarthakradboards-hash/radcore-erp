// What a thrown error answers with (M1-08, ADR-001 §7): by its code only, never message text (RC-216). A platform
// code keeps its status and the service's message; a declared business code is 422; a database refusal is mapped by
// its SQLSTATE, or by the contract's own name for it (ADR-005 §9); anything else is the server's 500.
import {
  BUSINESS_RULE_STATUS, PLATFORM_ERRORS, RETRY_AFTER_CODES, type Contract, type Issue, type PlatformErrorCode,
} from '@radcore/lib-common';
import { AppError, describeError } from '@radcore/lib-platform';

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

export const isPlatform = (code: string): code is PlatformErrorCode => Object.hasOwn(PLATFORM_ERRORS, code);

export type Failure = { status: number; code: string; message: string; issues: readonly Issue[]; retryAfterSeconds?: number };
// Too many requests (RAD-39): how many seconds until a retry can succeed, in the body and in Retry-After.
export const limited = (wait: number): Failure => ({ ...platform('rate_limited'), retryAfterSeconds: wait });
export const platform = (code: PlatformErrorCode, issues: readonly Issue[] = []): Failure =>
  ({ status: PLATFORM_ERRORS[code], code, message: MESSAGES[code], issues });

/** What a thrown error answers with: by its code only. */
export function failureOf(err: unknown, declared: readonly string[], dbErrors: Contract['dbErrors'] = {}): Failure {
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
  const { code: sqlstate, constraint } = describeError(err);
  // A refusal a person can cause, by its SQLSTATE and constraint, mapped by the contract wherever it was raised, at the
  // statement or at commit, with the contract's message, never the database's (ADR-005 §9). Unmapped, it's a bug.
  const named = sqlstate === undefined || constraint === undefined ? undefined : dbErrors[`${sqlstate}:${constraint}`];
  if (named !== undefined) return { status: BUSINESS_RULE_STATUS, code: named.code, message: named.message, issues: [] };
  const mapped = sqlstate === undefined ? undefined : SQLSTATE[sqlstate];
  return platform(mapped ?? 'server_error');
}
