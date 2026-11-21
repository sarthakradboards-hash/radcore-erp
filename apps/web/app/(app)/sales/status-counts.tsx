'use client';
// How many quotes or orders are in each status (RAD-125): the count cards above a list. The server counts them with a
// contract of its own (a list never adds up a whole ledger, ADR-001, RC-176); a person who can't read them, or a count that
// fails, simply sees no cards.
import { countOrders, countQuotes } from '@radcore/lib-sales/contract';
import { CountCards } from '../../../components/ui/record/record.tsx';
import { useApiQuery } from '../../../lib/api/query.ts';
import { t } from '../../../lib/i18n/index.ts';

export function StatusCounts({ kind }: { kind: 'quote' | 'order' }) {
  const q = useApiQuery(kind === 'quote' ? countQuotes : countOrders, {});
  if (q.data === undefined) return null;
  const cards = Object.entries(q.data.byStatus).map(([status, n]) => ({ label: t(`sales.${kind}.status.${status as 'draft'}`), value: String(n) }));
  return <CountCards label={t('sales.counts')} cards={cards} />;
}
