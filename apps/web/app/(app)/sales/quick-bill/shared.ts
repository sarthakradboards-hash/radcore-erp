// The quick bill's refusals in its own words (RAD-124): the shared sales words, and the bill's own (cash over the day's limit, a card
// without its approval code, anything that reads as card digits). needs_override, walk_in_pays_in_full and overpaid are left unworded
// on purpose: what the server says carries the bill's total, which nothing else on screen shows before the save.
import { t } from '../../../../lib/i18n/index.ts';
import { SALES_MESSAGES } from '../shared.tsx';

const OWN = ['cash_over_limit', 'no_payment_amount', 'approval_code_required', 'looks_like_card_number',
  'exceeds_payment', 'exceeds_document', 'document_not_posted'] as const;

export const QUICK_BILL_MESSAGES: Partial<Record<string, string>> = {
  ...SALES_MESSAGES,
  ...Object.fromEntries(OWN.map((c) => [c, t(`sales.err.${c}`)])),
};
