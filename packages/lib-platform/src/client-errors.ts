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
export const WEB_PAGES = ['/', '/account/password', '/account/sessions', '/accounts/chart', '/accounts/collect', '/accounts/collect/[partyId]', '/accounts/journal',
  '/accounts/journal/[id]', '/accounts/journal/new', '/accounts/payments', '/accounts/payments/[id]', '/accounts/payments/new',
  '/accounts/period',
  '/accounts/period/approvals',
  '/admin/audit', '/admin/company', '/admin/discount-limits', '/admin/gst-rates',
  '/admin/items', '/admin/items/[id]', '/admin/locations', '/admin/number-series', '/admin/parties', '/admin/parties/[id]',
  '/admin/permissions',
  '/admin/po-limits',
  '/admin/price-approvals', '/admin/price-lists', '/admin/price-lists/[id]',
  '/admin/roles', '/admin/roles/[key]', '/admin/sessions', '/admin/settings', '/admin/users', '/crm/ad-spend', '/crm/board', '/crm/campaigns', '/crm/leads', '/crm/leads/[id]', '/crm/leads/new', '/crm/lists', '/crm/set-aside', '/crm/sources',
  '/enquiry',
  '/invite', '/kit', '/l/invoice', '/password-reset',
  '/password-reset/new', '/purchases/approvals',
  '/purchases/bills',
  '/purchases/bills/[id]',
  '/purchases/bills/[id]/edit',
  '/purchases/bills/approvals',
  '/purchases/bills/new',
  '/purchases/orders', '/purchases/orders/[id]', '/purchases/orders/[id]/edit', '/purchases/orders/new', '/purchases/receipts',
  '/purchases/receipts/[id]', '/purchases/receipts/[id]/edit', '/purchases/receipts/[id]/qc', '/purchases/receipts/new',
  '/purchases/returns',
  '/purchases/returns/[id]',
  '/purchases/returns/[id]/edit',
  '/purchases/returns/new',
  '/sales/approvals', '/sales/bookings', '/sales/bookings/[id]', '/sales/bookings/new', '/sales/credit-notes',
  '/sales/credit-notes/[id]', '/sales/credit-notes/new', '/sales/deliveries', '/sales/deliveries/[id]',
  '/sales/deliveries/[id]/edit', '/sales/deliveries/new', '/sales/delivery-returns',
  '/sales/delivery-returns/[id]', '/sales/delivery-returns/[id]/edit', '/sales/delivery-returns/new', '/sales/invoices', '/sales/invoices/[id]', '/sales/invoices/[id]/edit', '/sales/invoices/new',
  '/sales/orders', '/sales/orders/[id]', '/sales/orders/[id]/edit', '/sales/orders/new', '/sales/quick-bill', '/sales/quotes', '/sales/quotes/[id]',
  '/sales/quotes/[id]/edit', '/sales/quotes/new', '/sales/test-rides', '/sales/test-rides/new',
  '/sign-in', '/stock/adjustments', '/stock/adjustments/[id]', '/stock/adjustments/[id]/edit', '/stock/adjustments/new', '/stock/approvals',
  '/stock/counts', '/stock/counts/[id]', '/stock/counts/[id]/edit', '/stock/counts/new',
  '/stock/job-work',
  '/stock/job-work/[id]',
  '/stock/job-work/new',
  '/stock/job-work/receipts',
  '/stock/job-work/receipts/[id]',
  '/stock/job-work/receipts/new',
  '/stock/on-hand',
  '/stock/transfers', '/stock/transfers/[id]', '/stock/transfers/new',
  '/stock/units',
  '/stock/units/[id]'] as const;

/** The error classes an alert may name; any other is counted as `Error`. */
export const ERROR_CLASSES = ['TypeError', 'ReferenceError', 'RangeError', 'SyntaxError', 'ChunkLoadError'] as const;

const MAX_STACK_LINES = 20;
// A stack's frame lines only, as describeError keeps them: Chrome's and Edge's first line repeats the message, which
// can quote input (the auditor on #154). V8 writes `    at f (url:1:2)`; Firefox and Safari write `f@url:1:2`, whose
// name may hold spaces: Safari's `global code@url:1:1`, Firefox's `setTimeout handler*f@url:1:2` (e2e on #154).
const FRAME = /^\s+at \S|^[^@\n]*@\S+:\d+:\d+$/;
// V8's message line can itself end like a frame (`TypeError: send to asha@mail.example.in:25:1`), so the message is
// cut off first, every line of it, and any other line starting `<name>:` goes too (the auditor on #161). A V8 stack
// holds the whole message even when the report's was cut to 1,000 characters, so everything before its first `at`
// frame goes as well, on the server, whatever the reporter sent (the auditor on #162). Firefox's and Safari's stacks
// hold no message.
const V8_FRAME = /^\s+at \S/;
function framesOf(stack: string, name: string, message: string): string {
  const head = `${name}: ${message}`;
  const lines = (stack.startsWith(head) ? stack.slice(head.length) : stack).split('\n');
  const firstV8 = lines.findIndex((l) => V8_FRAME.test(l));
  return lines.slice(Math.max(firstV8, 0)).filter((l) => FRAME.test(l) && !l.startsWith(`${name}:`))
    .slice(0, MAX_STACK_LINES).join('\n');
}
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
      const stack = scrubText(framesOf(input.stack ?? '', input.name, input.message));
      log.error(`browser error (${input.kind}) on ${page ?? 'an unknown page'} (request ${ctx.requestId})`,
        { errorClass: cls, message, path: scrubText(routeOf(input.page)), stack });
      // Not awaited: posting must never hold this transaction open, and the alerter never throws.
      void alert?.(`a browser error on ${page ?? 'an unknown page'}: ${cls} (request ${ctx.requestId})`,
        `web ${page ?? 'unknown'} ${cls}`);
      return {};
    })],
  });
}
