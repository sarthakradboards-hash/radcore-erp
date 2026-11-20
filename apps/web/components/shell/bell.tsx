'use client';
// The notifications bell (RAD-128 on RAD-121's routes): in the shell's header, with the person's unread count, asked
// every minute as /me is (REFRESH_MS). It opens their notifications, newest first; each opens its record's page where
// the app has one, and is marked read as it does. A notification's text is built by the server for this person, so it
// shows only what they may see; the bell never copies or guesses at the record.
import { formatMoment } from '@radcore/lib-common';
import { countMyNotifications, listMyNotifications, markMyNotificationsRead } from '@radcore/lib-platform/contract';
import Link from 'next/link';
import { useState } from 'react';
import { Dialog } from '../ui/dialog/dialog.tsx';
import { REFRESH_MS, useApiList, useApiMutation, useApiQuery } from '../../lib/api/query.ts';
import { t } from '../../lib/i18n/index.ts';

/** Where a notification's record opens, by its table. A table with no page here shows the text alone; each screen's
 * PR adds its own line as its page lands. */
const RECORD_PAGES: Readonly<Partial<Record<string, (id: string) => string>>> = {
  items: (id) => `/admin/items/${id}`,
  parties: (id) => `/admin/parties/${id}`,
};

function Notifications({ onOpen }: { onOpen: () => void }) {
  const list = useApiList(listMyNotifications, { filter: {} }, { limit: 20 });
  const mark = useApiMutation(markMyNotificationsRead, { invalidates: [countMyNotifications, listMyNotifications] });
  const [failed, setFailed] = useState(false);
  const [allMarked, setAllMarked] = useState(false);
  const markRead = (ids?: string[]) => mark.submit(ids === undefined ? {} : { ids }).then(
    () => { setFailed(false); return true; }, () => { setFailed(true); return false; });

  if (list.error !== null) return <p role="alert" className="kit-form-alert">{t('error.title')}</p>;
  if (list.isPending) return <p>{t('loading')}</p>;
  if (list.items.length === 0) return <p>{t('bell.empty')}</p>;
  return (
    <>
      {failed ? <p role="alert" className="kit-form-alert">{t('bell.markFailed')}</p> : null}
      {/* Said in the dialog: while it's open, the page's own live region is inert and would say nothing. */}
      <p role="status" className="visually-hidden">{allMarked ? t('bell.allMarked') : ''}</p>
      <ul className="bell-list">
        {list.items.map((n) => {
          const page = RECORD_PAGES[n.record.table]?.(n.record.id);
          const unread = n.readAt === null;
          return (
            <li key={n.id} data-unread={unread}>
              {unread ? <span className="bell-new">{t('bell.new')}</span> : null}
              {page === undefined ? <span>{n.text}</span> : (
                // Marked read on the way: the page opens whether or not the mark lands; the count catches up.
                <Link href={page} onClick={() => { if (unread) void markRead([n.id]); onOpen(); }}>{n.text}</Link>
              )}
              <span className="bell-when">{formatMoment(n.at)}</span>
              {page === undefined && unread ? (
                <button type="button" className="kit-button" onClick={() => void markRead([n.id])}
                  aria-label={t('bell.markOne', { text: n.text })}>{t('bell.mark')}</button>
              ) : null}
            </li>
          );
        })}
      </ul>
      <div className="kit-actions">
        {list.hasNextPage ? (
          <button type="button" className="kit-button" disabled={list.isFetchingNextPage} onClick={list.fetchNextPage}>{t('bell.more')}</button>
        ) : null}
        {list.items.some((n) => n.readAt === null) ? (
          <button type="button" className="kit-button"
            onClick={() => void markRead().then(setAllMarked)}>{t('bell.markAll')}</button>
        ) : null}
      </div>
    </>
  );
}

export function Bell() {
  const [open, setOpen] = useState(false);
  const count = useApiQuery(countMyNotifications, {}, { staleTime: REFRESH_MS, refetchInterval: REFRESH_MS });
  const unread = count.data?.unread ?? 0;
  return (
    <>
      <button type="button" className="kit-button bell" aria-haspopup="dialog" onClick={() => setOpen(true)}
        aria-label={unread === 0 ? t('bell.label') : t('bell.labelUnread', { n: String(unread) })}>
        {t('bell.label')}
        {unread === 0 ? null : <span className="bell-count" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}
      </button>
      <Dialog open={open} onOpenChange={setOpen} title={t('bell.title')}>
        {/* Asked for only while open: the count is what refreshes every minute. */}
        {open ? <Notifications onOpen={() => setOpen(false)} /> : null}
      </Dialog>
    </>
  );
}
