import { listStatementImportsContract, listStatementLinesContract } from '@radcore/lib-accounts/contract';
import { expect, it } from 'vitest';
import { apiListOptions, makeQueryClient } from '../../../../lib/api/query.ts';
import { refreshLines } from './lines-refresh.ts';

it('marks the lines table stale under the key the page reads it by, whatever the account', async () => {
  const client = makeQueryClient();
  const accountId = '00000000-0000-4000-8000-000000000001';
  const { queryKey } = apiListOptions(listStatementLinesContract, { filter: { accountId } }, 50);
  client.setQueryData(queryKey, { pages: [{ items: [], next: null }], pageParams: [null] });
  expect(client.getQueryState(queryKey)?.isInvalidated).toBe(false);
  await refreshLines(client);
  expect(client.getQueryState(queryKey)?.isInvalidated).toBe(true);
});

it('marks the past imports stale too, so a settled or undone import shows its new state there', async () => {
  const client = makeQueryClient();
  const { queryKey } = apiListOptions(listStatementImportsContract, { filter: { accountId: '00000000-0000-4000-8000-000000000001' } }, 50);
  client.setQueryData(queryKey, { pages: [{ items: [], next: null }], pageParams: [null] });
  await refreshLines(client);
  expect(client.getQueryState(queryKey)?.isInvalidated).toBe(true);
});
