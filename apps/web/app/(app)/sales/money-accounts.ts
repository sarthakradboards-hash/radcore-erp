// The accounts money is taken into or paid from (RAD-127): the switched-on money accounts from GET /money-accounts
// (money_accounts:read), which needs no look at the chart. A person without the key, or a failed read, gets 'hidden'.
import { listMoneyAccounts } from '@radcore/lib-accounts/contract';
import { useApiQuery } from '../../../lib/api/query.ts';

export function useMoneyAccounts(): { value: string; label: string }[] | 'hidden' | null {
  const q = useApiQuery(listMoneyAccounts, {});
  if (q.error !== null) return 'hidden';
  if (q.data === undefined) return null;
  return q.data.items.map((a) => ({ value: a.id, label: a.name }));
}
