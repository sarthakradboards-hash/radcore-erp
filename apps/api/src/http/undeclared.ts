// RAD-134 (M3-28): a business code a route raises but its contract doesn't declare answers 500 (failureOf), which no
// service test sees. Outside production the handler also logs it as undeclared_error and emits a process warning named
// UndeclaredError; the tools tests' setup (tools/vitest-setup.ts) turns that warning into a failed run. Production code
// takes this same path under test (RC-155): only the warning's listener differs.
import { PLATFORM_ERRORS } from '@radcore/lib-common';
import { AppError } from '@radcore/lib-platform';

export type UndeclaredMode = 'answer' | 'warn';
const UNDECLARED = 'UndeclaredError';

type Deps = { undeclared?: UndeclaredMode | undefined; log: { error(m: string): void } };

/** In `warn` mode, logs and warns of an AppError whose code is neither a platform code nor in `declared`. */
export function warnUndeclared({ undeclared, log }: Deps, err: unknown, declared: readonly string[], where: string): void {
  if (undeclared !== 'warn' || !(err instanceof AppError) || err.code === 'server_error' || Object.hasOwn(PLATFORM_ERRORS, err.code)
    || declared.includes(err.code)) return;
  const message = `undeclared_error: ${where} raised ${err.code}, which its contract doesn't declare`;
  log.error(message);
  process.emitWarning(message, UNDECLARED);
}
