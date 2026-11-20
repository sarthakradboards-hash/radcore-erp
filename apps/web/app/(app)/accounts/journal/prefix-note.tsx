'use client';
// The journal's number prefix and where it's changed (RAD-133, RAD-100's open item): entries are numbered by the
// "accounts.journal" series, and a prefix change applies from the next financial year (the architect's RAD-87 note).
// Shown only to people who may read settings, since that is the permission the series route asks for.
import { listNumberSeries } from '@radcore/lib-platform/contract';
import Link from 'next/link';
import { useMe } from '../../../../components/shell/session-provider.tsx';
import { useApiQuery } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';

export function PrefixNote() {
  const may = useMe().permissions.includes('settings:read');
  const series = useApiQuery(listNumberSeries, {}, { enabled: may }).data?.series.find((s) => s.key === 'accounts.journal');
  if (!may || series === undefined) return null;
  return (
    <p>
      {t('books.journal.prefixNote', { prefix: series.prefixThisYear })}{' '}
      <Link href="/admin/number-series">{t('books.journal.prefixLink')}</Link>
    </p>
  );
}
