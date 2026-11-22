'use client';
// What the credit notes screens share (RAD-125): the row types read off lib-sales' contract, the refusals in each dialog's own
// words, and a note's item by name (its lines carry only the item's id; the screen looks it up).
import type { getCreditNote, listCreditNotes } from '@radcore/lib-sales/contract';
import { getItem } from '@radcore/lib-stock/contract';
import type { z } from 'zod';
import { useApiQuery } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { SALES_MESSAGES } from '../shared.tsx';

export const CREDIT_STATUSES = ['draft', 'posted', 'cancelled'] as const;
export type CreditRow = z.output<typeof listCreditNotes.output>['items'][number];
export type CreditNote = z.output<typeof getCreditNote.output>;

/** The date refusal means something different on a note and on its cancellation, so each dialog names its own (as the invoice's do). */
export const CREDIT_MESSAGES: Partial<Record<string, string>> = { ...SALES_MESSAGES, date_before_source: t('sales.credit.err.date_before_source') };
export const CREDIT_CANCEL_MESSAGES: Partial<Record<string, string>> = { ...SALES_MESSAGES, date_before_source: t('sales.credit.err.cancel_date') };

/** An item by its name and SKU; a role that can't read items sees a plain word. */
export function CreditItem({ id }: { id: string }) {
  const q = useApiQuery(getItem, { id });
  if (q.error !== null) return t('sales.credit.unknownItem');
  return q.data === undefined ? t('loading') : `${q.data.name} (${q.data.sku})`;
}
