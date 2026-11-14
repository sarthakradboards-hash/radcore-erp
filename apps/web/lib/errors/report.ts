// The browser's error reports (RAD-29, RC-158): what a page threw, sent to the api's /client-errors, same-origin like
// every call (no new CSP source). The api scrubs and alerts; this side only caps the count, so a page stuck in an error
// loop sends a few reports, not one per frame. A report that fails is dropped: reporting must never raise an error of
// its own. ui-2's error boundaries (RC-159) call reportClientError(error, 'render').
import { reportClientError as contract } from '@radcore/lib-platform/contract';
import { callContract } from '../api-client.ts';

type Kind = 'error' | 'unhandledrejection' | 'render';

/** Reports per page load. */
const MAX_REPORTS = 10;
const sent = { count: 0 };
const UNSENT_KEY = '00000000-0000-4000-8000-000000000000';

/** Sends one error report, at most MAX_REPORTS per page load; never throws. */
export function reportClientError(error: unknown, kind: Kind = 'error'): void {
  if (sent.count >= MAX_REPORTS) return;
  sent.count += 1;
  const e = error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'A non-error value was thrown');
  const input = { kind, name: e.name.slice(0, 100), message: e.message.slice(0, 1000),
    page: window.location.pathname.slice(0, 500), ...(e.stack === undefined ? {} : { stack: e.stack.slice(0, 4000) }) };
  // A POST contract's type always allows a write, so the client's type asks for a key. The route is read-only, so the
  // client never sends it: a fixed one, not crypto.randomUUID(), which throws outside a secure context (auditor, #154).
  callContract(contract, input, { idempotencyKey: UNSENT_KEY }).catch(() => undefined);
}

/** Reports uncaught errors and unhandled rejections on this page; returns the function that stops it. */
export function listenForClientErrors(): () => void {
  const onError = (event: ErrorEvent) => reportClientError(event.error ?? event.message, 'error');
  const onRejection = (event: PromiseRejectionEvent) => reportClientError(event.reason, 'unhandledrejection');
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}

/** For tests: a fresh page load's count. */
export const resetReportCount = (): void => {
  sent.count = 0;
};
