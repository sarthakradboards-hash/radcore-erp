// The invoice screens' row types, read off lib-sales' contract (RAD-125).
import type { getInvoice, listInvoices } from '@radcore/lib-sales/contract';
import type { z } from 'zod';
import { t } from '../../../../lib/i18n/index.ts';
import { SALES_MESSAGES } from '../shared.tsx';

export const INVOICE_STATUSES = ['draft', 'posted', 'cancelled'] as const;
export type InvoiceRow = z.output<typeof listInvoices.output>['items'][number];
export type Invoice = z.output<typeof getInvoice.output>;

/** The invoice's refusals in its own words. The date codes mean something else on an order (before its quote), and on a
 * cancellation (before the invoice), so each dialog names its own (e2e-2 on #285). */
export const INVOICE_MESSAGES: Partial<Record<string, string>> = {
  ...SALES_MESSAGES,
  date_before_source: t('sales.invoice.err.date_before_source'),
  invoice_too_late: t('sales.invoice.err.invoice_too_late'),
  company_profile_incomplete: t('sales.invoice.err.company_profile_incomplete'),
};
export const INVOICE_CANCEL_MESSAGES: Partial<Record<string, string>> = {
  ...SALES_MESSAGES, date_before_source: t('sales.invoice.err.cancel_date'),
};
