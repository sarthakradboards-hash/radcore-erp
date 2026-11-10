'use client';

import { useSyncExternalStore } from 'react';

// One polite live region per page (A6: "Saved", "Approved" were silent for screen readers in v1).
type Message = { id: number; text: string };

const EMPTY: Message = { id: 0, text: '' };
let current = EMPTY;
const listeners = new Set<() => void>();

// Long enough for a screen reader to queue the message; short enough that it isn't found later as stale text.
const CLEAR_AFTER_MS = 5000;

function set(message: Message): void {
  current = message;
  for (const listener of listeners) listener();
}

/**
 * Says `text` to screen readers, for example `announce('Saved')` after a save succeeds.
 * A modal dialog makes the page's region inert, so dialog content mounts its own <LiveRegion /> (RAD-53).
 */
export function announce(text: string): void {
  const id = current.id + 1;
  set({ id, text });
  setTimeout(() => { if (current.id === id) set({ id, text: '' }); }, CLEAR_AFTER_MS);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Mounted once, in the root layout. */
export function LiveRegion() {
  const message = useSyncExternalStore(subscribe, () => current, () => EMPTY);
  // A new key replaces the node, so the same text said twice ("Saved", "Saved") is announced twice.
  return (
    <div role="status" className="visually-hidden">
      <span key={message.id}>{message.text}</span>
    </div>
  );
}
