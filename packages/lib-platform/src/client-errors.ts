// Errors from the browser (RAD-29, RC-158): logged like the server's own, and alerted once per page and class per
// hour. The endpoint is public, so everything in a report is the sender's choice. A log line keeps it only scrubbed:
// the message through describeError, the stack through scrubText. An alert holds none of it, and its key comes from
// two fixed lists, so no run of junk reports can mint new keys and flood the channel:
// - the page counts only when it matches one of the web app's pages, otherwise it's `unknown`;
// - the class counts only when it's on ERROR_CLASSES, otherwise it's `Error`.
// Built at start like createAuth: a service's Ctx carries no logger or alerter.
import type { Alerter } from './alerts.ts';
import { reportClientError } from './contract/client-errors.ts';
import type { Logger } from './log.ts';
import { describeError } from './log/safe-error.ts';
import { routeOf, scrubText } from './log/scrub.ts';
import { defineRoute } from './route.ts';

/** The web app's pages as Next names them, route groups left out; `[x]` is one path segment. tools/client-errors
 * .test.ts holds this list to apps/web/app's page files, so a new page fails there until it has its line. */
export const WEB_PAGES = ['/', '/account/password', '/account/sessions', '/admin/audit', '/admin/permissions',
  '/admin/roles', '/admin/roles/[key]', '/admin/sessions', '/admin/users', '/invite', '/kit', '/password-reset', '/password-reset/new',
  '/sign-in'] as const;

/** The error classes an alert may name; any other is counted as `Error`. */
export const ERROR_CLASSES = ['TypeError', 'ReferenceError', 'RangeError', 'SyntaxError', 'ChunkLoadError'] as const;

const MAX_STACK_LINES = 20;
// A stack's frame lines only, as describeError keeps them: Chrome's and Edge's first line repeats the message, which
// can quote input (the auditor on #154). V8 writes `    at f (url:1:2)`; Firefox and Safari write `f@url:1:2`.
const FRAME = /^\s+at \S|^[^\s@]*@\S+:\d+:\d+$/;
const framesOf = (stack: string) => stack.split('\n').filter((l) => FRAME.test(l)).slice(0, MAX_STACK_LINES).join('\n');
const PAGES = WEB_PAGES.map((t) => ({ t, re: new RegExp(`^${t.replace(/\[[^\]/]+\]/g, '[^/]+')}$`) }));

/** The page a path is, as one of WEB_PAGES, or null. */
export function pageOf(path: string): string | null {
  const bare = (path.split(/[?#]/)[0] ?? '').replace(/(.)\/+$/, '$1');
  return PAGES.find(({ re }) => re.test(bare))?.t ?? null;
}
const classOf = (name: string): string => (ERROR_CLASSES as readonly string[]).includes(name) ? name : 'Error';

export function createClientErrors(log: Logger, alert?: Alerter) {
  return Object.freeze({
    routes: [defineRoute(reportClientError, async (ctx, input) => {
      const page = pageOf(input.page);
      const cls = classOf(input.name);
      const { message } = describeError(Object.assign(new Error(input.message), { name: cls }));
      const stack = scrubText(framesOf(input.stack ?? ''));
      log.error(`browser error (${input.kind}) on ${page ?? 'an unknown page'} (request ${ctx.requestId})`,
        { errorClass: cls, message, path: scrubText(routeOf(input.page)), stack });
      // Not awaited: posting must never hold this transaction open, and the alerter never throws.
      void alert?.(`a browser error on ${page ?? 'an unknown page'}: ${cls} (request ${ctx.requestId})`,
        `web ${page ?? 'unknown'} ${cls}`);
      return {};
    })],
  });
}
