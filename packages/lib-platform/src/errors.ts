// How a service says why it refused (ADR-001 §7a, RC-216). The handler maps the failure by its code, never by its
// message: a platform code (lib-common's PLATFORM_ERRORS) answers with its own status, a code the route's contract
// lists answers 422, and any other answers 500. The message is shown to the person, so it names no stored value.
type Issue = { path: (string | number)[]; code: string; message: string };

export class AppError extends Error {
  override name = 'AppError';
  readonly code: string;
  readonly issues: readonly Issue[];
  /** Whole seconds until a retry can succeed: only on rate_limited and account_locked (ADR-001 §7a). */
  readonly retryAfterSeconds: number | undefined;
  constructor(code: string, message: string, issues: readonly Issue[] = [], retryAfterSeconds?: number) {
    super(message);
    this.code = code;
    this.issues = issues;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * A refusal whose transaction still commits, for its record: a failed sign-in's security event (RAD-34). The handler
 * honours it only on the key-exempt routes, which claim no saved-once key; elsewhere it rolls back like any AppError.
 */
export class RecordedRefusal extends AppError {
  override name = 'RecordedRefusal';
}
