// The quick bill's refusals in its own words (RAD-124): the shared sales words, and the bill's own (cash over the day's limit, the
// Counter customer paying in full, an overpayment, a card without its approval code, anything that reads as card digits).
// needs_override is left unworded on purpose: the issues the server names read best as it sends them.
import { t } from '../../../../lib/i18n/index.ts';
import { SALES_MESSAGES } from '../shared.tsx';

const OWN = ['cash_over_limit', 'walk_in_pays_in_full', 'overpaid', 'no_payment_amount', 'approval_code_required', 'looks_like_card_number',
  'exceeds_payment', 'exceeds_document', 'document_not_posted'] as const;

export const QUICK_BILL_MESSAGES: Partial<Record<string, string>> = {
  ...SALES_MESSAGES,
  ...Object.fromEntries(OWN.map((c) => [c, t(`sales.err.${c}`)])),
};
