// The statement lines table's refresh (RAD-168): an import adds its lines only once the worker has read the file, well
// after the POST answers, so the lines are re-read when the polled import settles, and when one is undone (e2e-2 on #439).
import { listStatementImportsContract, listStatementLinesContract } from '@radcore/lib-accounts/contract';
import type { QueryClient } from '@tanstack/react-query';
import { keyOf } from '../../../../lib/api/query.ts';

/** Marks every page of every account's statement lines and imports stale, so the tables on screen read them again. */
export const refreshLines = (client: QueryClient) => Promise.all([listStatementLinesContract, listStatementImportsContract]
  .map((c) => client.invalidateQueries({ queryKey: keyOf(c) })));
