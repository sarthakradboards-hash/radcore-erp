// The CRM's lists come whole in one read (getLeadLists), not a page at a time: the table is given them as a list with
// no next page, as the roles page does with its roles.
import type { getLeadLists } from '@radcore/lib-crm/contract';
import type { z } from 'zod';
import { t } from '../../../../lib/i18n/index.ts';

type Lists = z.output<typeof getLeadLists.output>;
export type ListsQuery = { data: Lists | undefined; isPending: boolean; error: Error | null; refetch: () => unknown };

/** One of the lists, as the table reads a list. */
export function wholeList<T>(q: ListsQuery, pick: (lists: Lists) => readonly T[]) {
  return {
    items: q.data === undefined ? [] : pick(q.data), hasNextPage: false, fetchNextPage: () => undefined, isFetchingNextPage: false,
    isPending: q.isPending, error: q.error, refetch: () => void q.refetch(),
  };
}

export const inUse = (active: boolean) => t(active ? 'crm.inUse.yes' : 'crm.inUse.no');
