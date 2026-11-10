'use client';

import { onlineManager } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { t } from '../i18n/index.ts';

const subscribe = (onChange: () => void) => {
  const unsubscribe = onlineManager.subscribe(onChange);
  // The subscription starts a frame after hydration; a connection lost in that gap fired no event we heard.
  if (!navigator.onLine) onlineManager.setOnline(false);
  return unsubscribe;
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
      {online ? '' : t('offline.banner')}
    </div>
  );
}
