'use client';
// The session on the client: seeded from the server's /me read (no second fetch at load), then refreshed every
// minute (REFRESH_MS, RAD-52), so a permission change or a session end shows without a reload.
import { createContext, use, type ReactNode } from 'react';
import { REFRESH_MS, useApiQuery } from '../../lib/api/query.ts';
import { getMe } from '@radcore/lib-platform/contract';
import type { Me } from '../../lib/session/read-me.ts';

const MeContext = createContext<Me | null>(null);

export function SessionProvider({ initial, children }: { initial: Me; children: ReactNode }) {
  const { data } = useApiQuery(getMe, {}, { initialData: initial, staleTime: REFRESH_MS, refetchInterval: REFRESH_MS });
  return <MeContext.Provider value={data ?? initial}>{children}</MeContext.Provider>;
}

/** The signed-in person, inside the (app) layout. */
export function useMe(): Me {
  const me = use(MeContext);
  if (!me) throw new Error('useMe() is only available inside the signed-in app layout');
  return me;
}
