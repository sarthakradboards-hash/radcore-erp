'use client';
// A "Show more" inside the match panel. While a page loads the button stays focusable (aria-disabled: a disabled button
// drops focus, e2e-2 on #468). After the last page it goes, so focus moves to a line naming the list now whole, rather
// than falling to the page body (e2e-playwright on #463; auditor-3 on #468).
import { useEffect, useRef, useState } from 'react';

export type Paged = { hasNextPage: boolean; isFetchingNextPage: boolean; fetchNextPage: () => void };

export function ShowMore({ list, label, whole, hint }: { list: Paged; label: string; whole: string; hint?: string }) {
  const [pressed, setPressed] = useState(false);
  const done = useRef<HTMLParagraphElement>(null);
  const over = pressed && !list.hasNextPage;
  useEffect(() => { if (over) done.current?.focus(); }, [over]);
  if (over) return <p ref={done} tabIndex={-1}>{whole}</p>;
  if (!list.hasNextPage) return null;
  return (
    <div>
      <button type="button" className="kit-button" aria-disabled={list.isFetchingNextPage} aria-busy={list.isFetchingNextPage}
        onClick={() => { if (list.isFetchingNextPage) return; setPressed(true); list.fetchNextPage(); }}>{label}</button>
      {hint === undefined ? null : <p className="kit-hint">{hint}</p>}
    </div>
  );
}
