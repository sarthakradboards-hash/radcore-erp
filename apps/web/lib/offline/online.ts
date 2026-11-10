'use client';
// Keeps TanStack's online state (which pauses saves and drives the offline banner) in step with the browser's own
// flag, and lets it heal: a flag that's wrong for a moment at load, or an `online` event fired before anyone was
// listening, is corrected on the next re-check instead of leaving the banner up and saves paused (e2e, RAD-52).
import { onlineManager } from '@tanstack/react-query';

type Win = Pick<Window, 'addEventListener' | 'removeEventListener'> & { navigator: Pick<Navigator, 'onLine'> };

const RECHECK_EVENTS = ['focus', 'pageshow'] as const;

/** Starts watching; returns the stop function. One re-check runs `recheckMs` after start. */
export function watchOnline(win: Win = window, recheckMs = 2000): () => void {
  const sync = () => onlineManager.setOnline(win.navigator.onLine);
  sync();
  const timer = setTimeout(sync, recheckMs);
  for (const e of RECHECK_EVENTS) win.addEventListener(e, sync);
  return () => {
    clearTimeout(timer);
    for (const e of RECHECK_EVENTS) win.removeEventListener(e, sync);
  };
}
