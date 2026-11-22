// Where a document is on its way (RAD-125): the usual path of statuses, and for one that left it (a quote declined or
// expired, an order cancelled) the same path ending at where it stopped. The server says the status; this only draws it.
import { t } from '../../../lib/i18n/index.ts';

type Step = { key: string; label: string };

const QUOTE_PATH = ['draft', 'sent', 'accepted'] as const;
const ORDER_PATH = ['draft', 'confirmed', 'closed'] as const;

/** The steps to show: the path, or for a status off it the path up to its last step, which the status replaces. */
function stepsFor(path: readonly string[], status: string, word: (status: string) => string): Step[] {
  const keys = path.includes(status) ? path : [...path.slice(0, -1), status];
  return keys.map((key) => ({ key, label: word(key) }));
}

export const quoteSteps = (status: string) => stepsFor(QUOTE_PATH, status, (s) => t(`sales.quote.status.${s as 'draft'}`));
export const orderSteps = (status: string) => stepsFor(ORDER_PATH, status, (s) => t(`sales.order.status.${s as 'draft'}`));

/** A document that is drafted, then posted, and perhaps cancelled after it was posted: the bar runs on to Cancelled. */
function postedSteps(status: string, word: (status: string) => string): Step[] {
  return (status === 'cancelled' ? ['draft', 'posted', 'cancelled'] : ['draft', 'posted']).map((key) => ({ key, label: word(key) }));
}
export const creditSteps = (status: string) => postedSteps(status, (s) => t(`sales.credit.status.${s as 'draft'}`));
export const invoiceSteps = (status: string) => postedSteps(status, (s) => t(`sales.invoice.status.${s as 'draft'}`));
export const deliverySteps = (status: string) => postedSteps(status, (s) => t(`sales.delivery.status.${s as 'draft'}`));
export const returnSteps = (status: string) => postedSteps(status, (s) => t(`sales.return.status.${s as 'draft'}`));
