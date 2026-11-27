'use client';
// One transfer (RAD-168 on RAD-165's #432, F19): its facts, and under payments:write a cancel that reverses its entry on the
// day chosen, with a reason. A cancelled one shows why. The server refuses a cancel the books don't allow.
import { dateString, formatDate, formatMoment, formatMoney, indiaDate, reason } from '@radcore/lib-common';
import { cancelTransferContract, getTransferContract, listTransfersContract } from '@radcore/lib-accounts/contract';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { z } from 'zod';
import { useMe } from '../../../../../components/shell/session-provider.tsx';
import { CloseButton, Dialog } from '../../../../../components/ui/dialog/dialog.tsx';
import { TextAreaField, TextField } from '../../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../../components/ui/form/form.tsx';
import { announce } from '../../../../../components/ui/live-region.tsx';
import { useApiMutation, useApiQuery } from '../../../../../lib/api/query.ts';
import { t } from '../../../../../lib/i18n/index.ts';
import { TRANSFER_MESSAGES } from '../transfer-values.ts';

const cancelSchema = z.object({ businessDate: dateString(), reason: reason() });

function CancelDialog({ id, number, onClose }: { id: string; number: string; onClose: () => void }) {
  const cancel = useApiMutation(cancelTransferContract, { invalidates: [getTransferContract, listTransfersContract] });
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }} title={t('books.transfers.cancel.title', { number })}
      description={t('books.transfers.cancel.body')}>
      <Form schema={cancelSchema} saved={false} messages={TRANSFER_MESSAGES} defaultValues={{ businessDate: indiaDate(new Date()), reason: '' }}
        onSubmit={async (v) => {
          await cancel.submit({ id, ...v });
          onClose();
          setTimeout(() => announce(t('books.transfers.cancelled', { number })), 0);
        }}>
        <TextField name="businessDate" label={t('books.transfers.cancel.date')} type="date" />
        <TextAreaField name="reason" label={t('books.transfers.cancel.reason')} />
        <div className="kit-actions">
          <CloseButton>{t('books.transfers.keep')}</CloseButton>
          <SubmitButton>{t('books.transfers.cancel')}</SubmitButton>
        </div>
      </Form>
    </Dialog>
  );
}

export default function TransferPage() {
  const { id } = useParams<{ id: string }>();
  const mayWrite = useMe().permissions.includes('payments:write');
  const q = useApiQuery(getTransferContract, { id });
  const [cancelling, setCancelling] = useState(false);
  const r = q.data;
  const back = <p><Link href="/accounts/transfers">{t('books.transfers.back')}</Link></p>;
  if (q.error !== null) {
    return (
      <>
        {back}
        <div role="alert" className="kit-form-alert">
          {t('books.transfers.missing')}{' '}
          <button type="button" className="kit-button" onClick={() => void q.refetch()}>{t('error.retry')}</button>
        </div>
      </>
    );
  }
  if (r === undefined) return <p>{t('loading')}</p>;
  return (
    <>
      {back}
      <h1>{r.number}</h1>
      <dl className="admin-facts" aria-label={t('books.transfers.facts')}>
        <dt>{t('books.transfers.col.status')}</dt><dd>{t(`books.transfers.status.${r.status}`)}</dd>
        <dt>{t('books.transfers.col.date')}</dt><dd>{formatDate(r.businessDate)}</dd>
        <dt>{t('books.transfers.col.from')}</dt><dd>{r.from.name}</dd>
        <dt>{t('books.transfers.col.to')}</dt><dd>{r.to.name}</dd>
        <dt>{t('books.transfers.col.amount')}</dt><dd>{formatMoney(r.amount)}</dd>
        {r.reference === null ? null : <><dt>{t('books.transfers.col.reference')}</dt><dd>{r.reference}</dd></>}
        {r.notes === null ? null : <><dt>{t('books.transfers.notes')}</dt><dd>{r.notes}</dd></>}
        <dt>{t('books.transfers.recordedAt')}</dt><dd>{formatMoment(r.recordedAt)}</dd>
        {r.cancelReason === null ? null : <><dt>{t('books.transfers.cancelReason')}</dt><dd>{r.cancelReason}</dd></>}
      </dl>
      {mayWrite && r.status === 'posted' ? (
        <div className="kit-actions">
          <button type="button" className="kit-button" onClick={() => setCancelling(true)}>{t('books.transfers.cancel')}</button>
        </div>
      ) : null}
      {cancelling ? <CancelDialog id={r.id} number={r.number} onClose={() => setCancelling(false)} /> : null}
    </>
  );
}
