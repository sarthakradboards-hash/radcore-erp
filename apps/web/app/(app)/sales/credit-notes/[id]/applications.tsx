'use client';
// Where a posted credit note is applied (RAD-125 on RAD-114's contract and lib-accounts' credit applications): each application
// to an invoice, with its amount and date, and for someone holding payments:write a "Reverse" that undoes it whole, once, with a
// date and a reason. A note that is still applied can't be cancelled, so this is the way to free it. Whether it can be reversed
// (not already, the date, the period) is the server's to say; the screen words the refusal.
import { dateString, formatDate, formatMoney, indiaDate } from '@radcore/lib-common';
import { reverseCreditApplicationContract } from '@radcore/lib-accounts/contract';
import { getCreditNote, getInvoice, listCreditNotes } from '@radcore/lib-sales/contract';
import Link from 'next/link';
import { useId, useState } from 'react';
import { z } from 'zod';
import { useMe } from '../../../../../components/shell/session-provider.tsx';
import { CloseButton, Dialog } from '../../../../../components/ui/dialog/dialog.tsx';
import { TextAreaField, TextField } from '../../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../../components/ui/form/form.tsx';
import { announce } from '../../../../../components/ui/live-region.tsx';
import '../../../../../components/ui/table/table.css';
import { useApiMutation } from '../../../../../lib/api/query.ts';
import { t } from '../../../../../lib/i18n/index.ts';
import { CREDIT_MESSAGES, type CreditNote } from '../shared.tsx';

type Application = CreditNote['applications'][number];

const schema = z.object({ businessDate: dateString(), reason: reverseCreditApplicationContract.input.shape.reason });
/** The reversal's own words for the date refusal (before the application), and the shared sales words for the rest. */
const MESSAGES: Partial<Record<string, string>> = {
  ...CREDIT_MESSAGES, date_before_source: t('sales.credit.apps.err.date'), already_reversed: t('sales.credit.apps.err.already'),
};

/** The dialog that reverses one application. */
function Reverse({ app, onClose }: { app: Application; onClose: () => void }) {
  const reverse = useApiMutation(reverseCreditApplicationContract, { invalidates: [getCreditNote, listCreditNotes, getInvoice] });
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }} title={t('sales.credit.apps.reverse.title', { number: app.documentNumber ?? '' })}
      description={t('sales.credit.apps.reverse.body', { amount: formatMoney(app.amount) })}>
      <Form schema={schema} saved={false} messages={MESSAGES} defaultValues={{ businessDate: indiaDate(new Date()), reason: '' }}
        onSubmit={async (v) => {
          await reverse.submit({ id: app.id, ...v });
          onClose();
          setTimeout(() => announce(t('sales.credit.apps.reversed')), 0);
        }}>
        <TextField name="businessDate" label={t('sales.credit.apps.date')} type="date" />
        <TextAreaField name="reason" label={t('sales.reason')} />
        <div className="kit-actions">
          <CloseButton>{t('sales.cancel')}</CloseButton>
          <SubmitButton>{t('sales.credit.apps.reverse')}</SubmitButton>
        </div>
      </Form>
    </Dialog>
  );
}

export function Applications({ applications }: { applications: CreditNote['applications'] }) {
  const captionId = useId();
  const mayReverse = useMe().permissions.includes('payments:write');
  const [reversing, setReversing] = useState<Application | null>(null);
  if (applications.length === 0) return <p>{t('sales.credit.apps.none')}</p>;
  return (
    <>
      <div className="kit-table">
        <div className="kit-table-scroll" role="region" aria-labelledby={captionId} tabIndex={0}>
          <table>
            <caption id={captionId}>{t('sales.credit.apps.title')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('sales.credit.apps.invoice')}</th>
                <th scope="col" className="kit-numeric">{t('sales.credit.apps.amount')}</th>
                <th scope="col">{t('sales.credit.apps.date')}</th>
                <th scope="col">{t('sales.credit.apps.status')}</th>
                {mayReverse ? <th scope="col">{t('sales.credit.apps.action')}</th> : null}
              </tr>
            </thead>
            <tbody>
              {applications.map((a) => (
                <tr key={a.id}>
                  <td><Link href={`/sales/invoices/${a.documentId}`}>{a.documentNumber ?? t('sales.draft')}</Link></td>
                  <td className="kit-numeric">{formatMoney(a.amount)}</td>
                  <td>{formatDate(a.businessDate)}</td>
                  <td>{a.reversed ? t('sales.credit.apps.reversed.status') : t('sales.credit.apps.applied')}</td>
                  {mayReverse ? (
                    <td>
                      {a.reversed ? null : (
                        <button type="button" className="kit-button" aria-label={t('sales.credit.apps.reverse.for', { number: a.documentNumber ?? '' })}
                          onClick={() => setReversing(a)}>{t('sales.credit.apps.reverse')}</button>
                      )}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {reversing === null ? null : <Reverse app={reversing} onClose={() => setReversing(null)} />}
    </>
  );
}
