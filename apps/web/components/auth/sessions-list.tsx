'use client';
// Your sessions (M1-16, RAD-55): where you're signed in, and ending any but this one. This device's session ends by
// signing out, so it has no End button (endMySession refuses it with current_session).
import { endMySession, listMySessions } from '@radcore/lib-platform/contract';
import { formatMoment } from '@radcore/lib-common';
import { ApiError } from '../../lib/api-client.ts';
import { useApiList, useApiMutation } from '../../lib/api/query.ts';
import { t } from '../../lib/i18n/index.ts';
import { announce } from '../ui/live-region.tsx';

const message = (e: Error) => (e instanceof ApiError ? e.envelope.message : t('error.offline'));

/** @public sign-in screen API: its first caller is the sessions page (app/(app)/account/sessions). */
export function SessionsList() {
  const list = useApiList(listMySessions, { filter: {} });
  const end = useApiMutation(endMySession, { invalidates: [listMySessions] });
  if (list.isPending) return <p role="status">{t('loading')}</p>;
  if (list.error) return <p role="alert">{message(list.error)}</p>;
  const finish = (id: string, device: string) => end.submit({ id })
    .then(() => announce(t('sessions.ended', { device })), () => undefined); // the error shows below the list
  return (
    <>
      <ul className="session-list">
        {list.items.map((s) => (
          <li key={s.id}>
            <span className="session-device">{s.device}</span>
            <span className="session-when">{t('sessions.lastSeen', { when: formatMoment(s.lastSeenAt) })}</span>
            {s.current
              ? <strong>{t('sessions.thisDevice')}</strong>
              : (
                <button type="button" disabled={end.isPending} aria-label={t('sessions.endNamed', { device: s.device })}
                  onClick={() => void finish(s.id, s.device)}>
                  {t('sessions.end')}
                </button>
              )}
          </li>
        ))}
      </ul>
      {list.hasNextPage
        ? <button type="button" onClick={list.fetchNextPage} disabled={list.isFetchingNextPage}>{t('sessions.more')}</button>
        : null}
      {end.error ? <p role="alert">{message(end.error)}</p> : null}
    </>
  );
}
