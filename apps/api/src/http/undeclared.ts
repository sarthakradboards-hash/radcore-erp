// RAD-134 (M3-28): a business code a route raises but its contract doesn't declare answers 500 (failureOf), which no
// service test sees. Outside production the handler also logs it as undeclared_error and emits a process warning named
// UndeclaredError; the tools tests' setup (tools/vitest-setup.ts) turns that warning into a failed run. Production code
// takes this same path under test (RC-155): only the warning's listener differs.
import { PLATFORM_ERRORS } from '@radcore/lib-common';
import { AppError } from '@radcore/lib-platform';

export type UndeclaredMode = 'answer' | 'warn';
export const UNDECLARED = 'UndeclaredError';

/** Logs and warns of an AppError whose code is neither a platform code nor in `declared`; anything else, nothing. */
export function warnUndeclared(err: unknown, declared: readonly string[], where: string, log: { error(m: string): void }): void {
  if (!(err instanceof AppError) || err.code === 'server_error' || Object.hasOwn(PLATFORM_ERRORS, err.code) || declared.includes(err.code)) return;
  const message = `undeclared_error: ${where} raised ${err.code}, which its contract doesn't declare`;
  log.error(message);
  process.emitWarning(message, UNDECLARED);
}
