'use client';
// A customer's statement (RAD-126 on RAD-119's routes): what there is to collect from them today, their entries between two dates with
// the balance after each, their open bills, and their reminders. receivables:read. The statement opens on the financial year to date.
// Every figure is the server's: the balances, what is open on a bill and whether it is overdue.
import { dateString, financialYear, formatDate, formatMoney, indiaDate } from '@radcore/lib-common';
import { getPartyStatement } from '@radcore/lib-accounts/contract';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useId, useState } from 'react';
import { z } from 'zod';
import { TextField } from '../../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../../components/ui/form/form.tsx';
import '../../../../../components/ui/table/table.css';
import { useApiQuery } from '../../../../../lib/api/query.ts';
import { t } from '../../../../../lib/i18n/index.ts';
import { kindText } from '../../shared.tsx';
import { documentHref } from '../document-href.ts';
import { Reminders } from './reminders.tsx';

const range = z.object({ from: dateString(), to: dateString() })
  .refine((r) => r.from <= r.to, { error: t('books.collect.st.err.range'), path: ['to'] });

const documentCell = (table: string, id: string, number: string | null) => {
  const href = documentHref(table, id);
  return number === null ? '' : href === null ? number : <Link href={href}>{number}</Link>;
};

export default function PartyStatementPage() {
  const { partyId } = useParams<{ partyId: string }>();
  const today = indiaDate(new Date());
  const [applied, setApplied] = useState({ from: financialYear(today).start, to: today });
  const q = useApiQuery(getPartyStatement, { id: partyId, ...applied });
  const entriesId = useId();
  const billsId = useId();
  const back = <p><Link href="/accounts/collect">{t('books.collect.st.back')}</Link></p>;
  if (q.error !== null) {
    return (
      <>
        {back}
        <div role="alert" className="kit-form-alert">
          {t('books.collect.st.missing')} <button type="button" className="kit-button" onClick={() => void q.refetch()}>{t('error.retry')}</button>
        </div>
      </>
    );
  }
  const s = q.data;
  if (s === undefined) return <>{back}<p>{t('loading')}</p></>;
  const owed = s.toCollect;
  return (
    <>
      {back}
      <h1>{t('books.collect.st.title', { party: s.party.name })}</h1>
      <p>{t('books.collect.st.days', { n: String(s.party.creditDays) })}</p>
      <dl className="admin-facts" aria-label={t('books.collect.st.owed')}>
        <dt>{t('books.collect.st.owes')}</dt><dd>{formatMoney(owed.outstanding)}</dd>
        <dt>{t('books.collect.st.overdue')}</dt><dd>{formatMoney(owed.overdue)}</dd>
        <dt>{t('books.collect.st.oldest')}</dt><dd>{owed.oldestDue === null ? '' : formatDate(owed.oldestDue)}</dd>
        <dt>{t('books.collect.st.notOnBill')}</dt><dd>{formatMoney(owed.notOnABill)}</dd>
      </dl>
      <p className="kit-field-hint">{t('books.collect.st.notOnBill.note')}</p>

      <section aria-labelledby={billsId}>
        <h2 id={billsId}>{t('books.collect.bills')}</h2>
        {s.openBills.length === 0 ? <p>{t('books.collect.bills.none')}</p> : (
          <div className="kit-table">
            <div className="kit-table-scroll" role="region" aria-labelledby={billsId} tabIndex={0}>
              <table>
                <thead>
                  <tr>
                    <th scope="col">{t('books.collect.bills.col.document')}</th>
                    <th scope="col">{t('books.collect.bills.col.date')}</th>
                    <th scope="col">{t('books.collect.bills.col.due')}</th>
                    <th scope="col" className="kit-numeric">{t('books.collect.bills.col.amount')}</th>
                    <th scope="col" className="kit-numeric">{t('books.collect.bills.col.paid')}</th>
                    <th scope="col" className="kit-numeric">{t('books.collect.bills.col.open')}</th>
                    <th scope="col">{t('books.collect.bills.col.overdue')}</th>
                  </tr>
                </thead>
                <tbody>
                  {s.openBills.map((b) => (
                    <tr key={`${b.table}:${b.id}`}>
                      <td>{documentCell(b.table, b.id, b.documentNumber ?? b.entryNumber)}</td>
                      <td>{formatDate(b.date)}</td>
                      <td>{formatDate(b.due)}</td>
                      <td className="kit-numeric">{formatMoney(b.amount)}</td>
                      <td className="kit-numeric">{formatMoney(b.paid)}</td>
                      <td className="kit-numeric">{formatMoney(b.open)}</td>
                      <td>{b.overdue ? t('books.collect.yes') : t('books.collect.no')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      <section aria-labelledby={entriesId}>
        <h2 id={entriesId}>{t('books.collect.st.lines')}</h2>
        <Form aria-labelledby={entriesId} schema={range} defaultValues={applied} saved={false} onSubmit={async (r) => { setApplied(r); }}>
          <div className="admin-filters">
            <TextField name="from" label={t('books.collect.st.from')} type="date" />
            <TextField name="to" label={t('books.collect.st.to')} type="date" />
          </div>
          <SubmitButton>{t('books.collect.st.show')}</SubmitButton>
        </Form>
        <div className="kit-table">
          <div className="kit-table-scroll" role="region" aria-labelledby={entriesId} tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th scope="col">{t('books.collect.st.col.date')}</th>
                  <th scope="col">{t('books.collect.st.col.entry')}</th>
                  <th scope="col">{t('books.collect.st.col.document')}</th>
                  <th scope="col">{t('books.collect.st.col.kind')}</th>
                  <th scope="col" className="kit-numeric">{t('books.collect.st.col.debit')}</th>
                  <th scope="col" className="kit-numeric">{t('books.collect.st.col.credit')}</th>
                  <th scope="col" className="kit-numeric">{t('books.collect.st.col.balance')}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td colSpan={6}>{t('books.collect.st.opening', { date: formatDate(applied.from) })}</td>
                  <td className="kit-numeric">{formatMoney(s.opening)}</td>
                </tr>
                {s.lines.map((l) => (
                  <tr key={`${l.sourceTable}:${l.sourceId}:${l.entryNumber}`}>
                    <td>{formatDate(l.businessDate)}</td>
                    <td>{l.entryNumber}</td>
                    <td>{documentCell(l.sourceTable, l.sourceId, l.documentNumber)}</td>
                    <td>{kindText(l.kind)}</td>
                    <td className="kit-numeric">{formatMoney(l.debit)}</td>
                    <td className="kit-numeric">{formatMoney(l.credit)}</td>
                    <td className="kit-numeric">{formatMoney(l.balance)}</td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={6}>{t('books.collect.st.closing', { date: formatDate(applied.to) })}</td>
                  <td className="kit-numeric">{formatMoney(s.closing)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        {s.lines.length === 0 ? <p>{t('books.collect.st.none')}</p> : null}
      </section>

      <Reminders id={partyId} party={s.party.name} />
    </>
  );
}
