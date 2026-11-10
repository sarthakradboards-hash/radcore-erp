'use client';

import { onlineManager } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { watchOnline } from './online.ts';

const subscribe = (onChange: () => void) => {
  const unsubscribe = onlineManager.subscribe(onChange);
  // The subscription starts a frame after hydration, so events in that gap were missed: read the flag now, and keep
  // re-checking it, so neither a missed event nor a wrong reading can stick.
  const stopWatching = watchOnline();
  return () => {
    stopWatching();
    unsubscribe();
  };
};

/**
 * Says when the browser is offline (RC-149). While offline, TanStack pauses saves and sends them, with the same
 * Idempotency-Key, when the connection is back; reads wait too. The region is always mounted, so the change is announced.
 * shortcut: follows the browser's online and offline events only, so a network that is up but can't reach RadCore
 * shows as a failed request instead; add a reachability check if counters report that.
 */
export function OfflineBanner() {
  const online = useSyncExternalStore(subscribe, () => onlineManager.isOnline(), () => true);
  return (
    <div role="status" className={online ? 'visually-hidden' : 'offline-banner'}>
      {online ? '' : "You're offline. What you've typed stays on this page, and saves are sent when you're back online."}
    </div>
  );
}
