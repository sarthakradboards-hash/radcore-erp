'use client';
// How many quotes or orders are in each status (RAD-125): the count cards above a list. The server counts them with a
// contract of its own (a list never adds up a whole ledger, ADR-001, RC-176); a person who can't read them, or a count that
// fails, simply sees no cards.
import { SALES_ORDER_STATUSES, SALES_QUOTE_STATUSES } from '@radcore/lib-common';
import { countOrders, countQuotes } from '@radcore/lib-sales/contract';
import { CountCards } from '../../../components/ui/record/record.tsx';
import { useApiQuery } from '../../../lib/api/query.ts';
import { t } from '../../../lib/i18n/index.ts';

export function StatusCounts({ kind }: { kind: 'quote' | 'order' }) {
  const q = useApiQuery(kind === 'quote' ? countQuotes : countOrders, {});
  if (q.data === undefined) return null;
  // In the statuses' own order (the path a document takes), not the answer's key order.
  const statuses: readonly string[] = kind === 'quote' ? SALES_QUOTE_STATUSES : SALES_ORDER_STATUSES;
  const by: Record<string, number | undefined> = q.data.byStatus;
  const cards = statuses.map((status) => ({ label: t(`sales.${kind}.status.${status as 'draft'}`), value: String(by[status] ?? 0) }));
  return <CountCards label={t('sales.counts')} cards={cards} />;
}
