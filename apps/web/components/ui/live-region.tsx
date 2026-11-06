'use client';

import { useSyncExternalStore } from 'react';

// One polite live region per page (A6: "Saved", "Approved" were silent for screen readers in v1).
type Message = { id: number; text: string };

const EMPTY: Message = { id: 0, text: '' };
let current = EMPTY;
const listeners = new Set<() => void>();

/** Says `text` to screen readers, for example `announce('Saved')` after a save succeeds. */
export function announce(text: string): void {
  current = { id: current.id + 1, text };
  for (const listener of listeners) listener();
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
