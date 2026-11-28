'use client';
// A "Show more" inside the match panel. After the last page its button goes, so focus moves to a line saying all are
// shown rather than falling to the page body (e2e-playwright on #463).
import { useEffect, useRef, useState } from 'react';
import { t } from '../../../../lib/i18n/index.ts';

export type Paged = { hasNextPage: boolean; isFetchingNextPage: boolean; fetchNextPage: () => void };

export function ShowMore({ list, label, hint }: { list: Paged; label: string; hint?: string }) {
  const [pressed, setPressed] = useState(false);
  const done = useRef<HTMLParagraphElement>(null);
  const over = pressed && !list.hasNextPage;
  useEffect(() => { if (over) done.current?.focus(); }, [over]);
  if (over) return <p ref={done} tabIndex={-1}>{t('books.bank.allShown')}</p>;
  if (!list.hasNextPage) return null;
  return (
    <div>
      <button type="button" className="kit-button" disabled={list.isFetchingNextPage}
        onClick={() => { setPressed(true); list.fetchNextPage(); }}>{label}</button>
      {hint === undefined ? null : <p className="kit-hint">{hint}</p>}
    </div>
  );
}
