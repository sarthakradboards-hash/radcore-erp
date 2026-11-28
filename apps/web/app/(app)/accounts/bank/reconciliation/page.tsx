'use client';
// The bank reconciliation statement (RAD-168 on RAD-165's #464; ADR-009 §12, GL-132): for a bank account and a date, the
// balance in the books, the lines each side doesn't show the other by then, what they leave unexplained, and the bank's
// balance. Every figure is the server's; the screen only lays them out. bank:read, and money_accounts:read for the accounts.
import { dateString, formatDate, formatMoney, indiaDate } from '@radcore/lib-common';
import { listMoneyAccounts, reconciliationContract } from '@radcore/lib-accounts/contract';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useId, useState } from 'react';
import type { z } from 'zod';
import { useMe } from '../../../../../components/shell/session-provider.tsx';
import '../../../../../components/ui/form/form.css';
import { DataTable, type Column } from '../../../../../components/ui/table/data-table.tsx';
import { ApiError } from '../../../../../lib/api-client.ts';
import { useApiQuery } from '../../../../../lib/api/query.ts';
import { t } from '../../../../../lib/i18n/index.ts';
import { ChoiceButtons } from '../../../admin/shared.tsx';
import { kindWords, movedWords } from '../match-values.ts';

type Statement = z.output<typeof reconciliationContract.output>;
type BookLine = Statement['notInBank']['lines'][number];
type BankLine = Statement['notInBooks']['lines'][number];

const moved = (l: { direction: 'in' | 'out'; amount: string }) =>
  t(l.direction === 'in' ? 'books.bank.several.in' : 'books.bank.several.out', { amount: formatMoney(l.amount) });
const counted = (n: number) => t(n === 1 ? 'books.recon.lines.one' : 'books.recon.lines.other', { n: String(n) });
/** The server lists every line in one answer, at most 500 a side, so there's no next page. */
const whole = <T,>(items: readonly T[]) => ({ items, hasNextPage: false, fetchNextPage: () => {}, isFetchingNextPage: false, isPending: false,
  error: null, refetch: () => {} });

/** One side's outstanding lines, saying so when the server listed only the first of them (its total is still of all). */
function Outstanding<T extends object>({ title, empty, count, lines, columns, rowKey }: {
  title: string; empty: string; count: number; lines: readonly T[]; columns: readonly Column<T>[]; rowKey: (l: T) => string;
}) {
  return (
    <>
      <h2>{title}</h2>
      {count > lines.length ? <p>{t('books.recon.first', { shown: String(lines.length), n: String(count) })}</p> : null}
      <DataTable caption={title} columns={columns} rowKey={rowKey} list={whole(lines)} empty={empty} />
    </>
  );
}

function Reconciliation({ accountId, asAt }: { accountId: string; asAt: string }) {
  const mayOpen = useMe().permissions.includes('journal:read');
  const q = useApiQuery(reconciliationContract, { id: accountId, asAt });
  const r = q.data;
  if (q.error !== null) {
    return (
      <div role="alert" className="kit-form-alert">
        {q.error instanceof ApiError && q.error.code === 'not_a_bank_account' ? t('books.bank.err.not_a_bank_account') : t('error.title')}{' '}
        <button type="button" className="kit-button" onClick={() => void q.refetch()}>{t('error.retry')}</button>
      </div>
    );
  }
  if (r === undefined) return <p>{t('loading')}</p>;
  const bookColumns: Column<BookLine>[] = [
    { id: 'date', header: t('books.bank.col.date'), cell: (l) => formatDate(l.businessDate) },
    // The entry's page needs journal:read; without it the number is only named.
    { id: 'entry', header: t('books.recon.col.entry'), cell: (l) => (mayOpen ? <Link href={`/accounts/journal/${l.entryId}`}>{l.entryNumber}</Link> : l.entryNumber) },
    { id: 'kind', header: t('books.journal.kind'), cell: (l) => kindWords(l.kind) },
    { id: 'amount', header: t('books.recon.col.amount'), numeric: true, cell: moved },
  ];
  const bankColumns: Column<BankLine>[] = [
    { id: 'date', header: t('books.bank.col.date'), cell: (l) => formatDate(l.valueDate) },
    { id: 'narration', header: t('books.bank.col.narration'), cell: (l) => l.narration },
    { id: 'reference', header: t('books.bank.col.reference'), cell: (l) => l.reference },
    { id: 'amount', header: t('books.recon.col.amount'), numeric: true, cell: moved },
  ];
  return (
    <>
      <dl className="admin-facts" aria-label={t('books.recon.figures', { date: formatDate(r.asAt) })}>
        <dt>{t('books.recon.bookBalance')}</dt><dd>{formatMoney(r.bookBalance)}</dd>
        <dt>{t('books.recon.notInBank')}</dt><dd>{movedWords(r.notInBank.total)}, {counted(r.notInBank.count)}</dd>
        <dt>{t('books.recon.notInBooks')}</dt><dd>{movedWords(r.notInBooks.total)}, {counted(r.notInBooks.count)}</dd>
        {r.unexplained === null ? null : <><dt>{t('books.recon.unexplained')}</dt><dd>{formatMoney(r.unexplained)}</dd></>}
        <dt>{t('books.recon.statementBalance')}</dt>
        <dd>{r.statementBalance === null ? t('books.recon.noStatement') : formatMoney(r.statementBalance)}</dd>
      </dl>
      <p>{t('books.recon.how')}</p>
      <Outstanding title={t('books.recon.notInBank')} empty={t('books.recon.notInBank.empty')} count={r.notInBank.count} lines={r.notInBank.lines}
        columns={bookColumns} rowKey={(l) => l.journalLineId} />
      <Outstanding title={t('books.recon.notInBooks')} empty={t('books.recon.notInBooks.empty')} count={r.notInBooks.count} lines={r.notInBooks.lines}
        columns={bankColumns} rowKey={(l) => l.statementLineId} />
    </>
  );
}

/** The account and the date start from the address (?account=&date=) and are written back to it, so Back from an entry
 * finds them (e2e-2 on #470). Held in state too, so typing a date never waits for the address. */
function Chosen() {
  const { permissions } = useMe();
  const asked = useSearchParams();
  const mayRead = permissions.includes('bank:read') && permissions.includes('money_accounts:read');
  const money = useApiQuery(listMoneyAccounts, {}, { enabled: mayRead });
  const banks = (money.data?.items ?? []).filter((a) => !a.cash);
  const [picked, setPicked] = useState(() => asked.get('account') ?? '');
  const accountId = banks.some((b) => b.id === picked) ? picked : (banks[0]?.id ?? '');
  const [asAt, setAsAt] = useState(() => asked.get('date') ?? indiaDate(new Date()));
  const keep = (account: string, date: string) => window.history.replaceState(null, '', `?${new URLSearchParams({ account, date }).toString()}`);
  const dateId = useId();
  const dated = dateString().safeParse(asAt).success;
  const body = !mayRead ? <p>{t('books.bank.none')}</p>
    : money.error !== null ? <p role="alert" className="kit-form-alert">{t('books.bank.noAccounts')}</p>
    : money.data === undefined ? <p>{t('loading')}</p>
    : banks.length === 0 ? <p>{t('books.bank.empty')}</p>
    : (
      <>
        <div className="admin-toolbar">
          <ChoiceButtons label={t('books.bank.account')} value={accountId} onChange={(id) => { setPicked(id); keep(id, asAt); }} options={banks.map((b) => ({ value: b.id, label: b.name }))} />
          <div className="kit-field">
            <label htmlFor={dateId}>{t('books.recon.asAt')}</label>
            <input id={dateId} type="date" value={asAt} onChange={(e) => { setAsAt(e.currentTarget.value); keep(accountId, e.currentTarget.value); }} />
          </div>
        </div>
        {dated ? <Reconciliation accountId={accountId} asAt={asAt} /> : <p>{t('books.recon.pickDate')}</p>}
      </>
    );
  return body;
}

export default function ReconciliationPage() {
  return (
    <>
      <h1>{t('books.recon.title')}</h1>
      <p>{t('books.recon.intro')}</p>
      <Suspense fallback={<p>{t('loading')}</p>}><Chosen /></Suspense>
    </>
  );
}
