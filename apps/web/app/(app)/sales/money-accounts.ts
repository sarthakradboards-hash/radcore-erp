// The accounts money is taken into or paid from (RAD-127): Cash, Bank, and the bank accounts under Bank, which is what the
// server takes as a money account (it checks again). A person who can't read the chart (journal:read) gets 'hidden'.
import { listAccounts } from '@radcore/lib-accounts/contract';
import { useApiQuery } from '../../../lib/api/query.ts';

export function useMoneyAccounts(): { value: string; label: string }[] | 'hidden' | null {
  const q = useApiQuery(listAccounts, {});
  if (q.error !== null) return 'hidden';
  if (q.data === undefined) return null;
  const bank = q.data.items.find((a) => a.systemKey === 'bank')?.id;
  const money = (a: (typeof q.data.items)[number]) => a.systemKey === 'cash' || a.systemKey === 'bank' || (bank !== undefined && a.parentId === bank);
  return q.data.items.filter((a) => a.active && money(a)).map((a) => ({ value: a.id, label: a.name }));
}
