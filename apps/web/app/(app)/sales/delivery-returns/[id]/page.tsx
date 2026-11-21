'use client';
// One delivery return (RAD-125 on RAD-112's contracts), in the record layout: where it is (the status bar), the delivery it
// takes goods back from (a related-record button), its facts and its lines. A draft is posted (the goods come back into the
// batches they left with) or deleted; a posted return is cancelled with a date and a reason under deliveries:cancel. A
// return never needs an override: it only takes goods back. Its form waits for the stock-by-batch read.
import { dateString, formatDate, indiaDate } from '@radcore/lib-common';
import {
  cancelDeliveryReturn, deleteDeliveryReturn, getDeliveryReturn, listDeliveryReturns, postDeliveryReturn,
} from '@radcore/lib-sales/contract';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { z } from 'zod';
import { useMe } from '../../../../../components/shell/session-provider.tsx';
import { CloseButton, Dialog } from '../../../../../components/ui/dialog/dialog.tsx';
import { TextAreaField, TextField } from '../../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../../components/ui/form/form.tsx';
import { announce } from '../../../../../components/ui/live-region.tsx';
import { CountCards, RelatedRecords, StatusBar } from '../../../../../components/ui/record/record.tsx';
import { useApiMutation, useApiQuery } from '../../../../../lib/api/query.ts';
import { t } from '../../../../../lib/i18n/index.ts';
import { ConfirmDialog } from '../../../admin/shared.tsx';
import { SALES_MESSAGES } from '../../shared.tsx';
import { returnSteps } from '../../status.ts';
import { DocumentLines, PlaceName, RETURN_CANCEL_MESSAGES, RETURN_MESSAGES } from '../../deliveries/shared.tsx';

const later = (text: string) => setTimeout(() => announce(text), 0);
const cancelSchema = z.object({ businessDate: dateString(), reason: cancelDeliveryReturn.input.shape.reason });
type Dialogs = 'post' | 'cancel' | 'delete' | null;

export default function DeliveryReturnPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { permissions } = useMe();
  const mayWrite = permissions.includes('deliveries:write');
  const mayCancel = permissions.includes('deliveries:cancel');
  const q = useApiQuery(getDeliveryReturn, { id });
  const again = [getDeliveryReturn, listDeliveryReturns];
  const post = useApiMutation(postDeliveryReturn, { invalidates: again });
  const cancel = useApiMutation(cancelDeliveryReturn, { invalidates: again });
  // A deleted record is gone: refetching it would be a 404, so only the list is refreshed.
  const remove = useApiMutation(deleteDeliveryReturn, { invalidates: [listDeliveryReturns] });
  const [dialog, setDialog] = useState<Dialogs>(null);
  const ret = q.data;

  if (q.error !== null) {
    return (
      <>
        <p><Link href="/sales/delivery-returns">{t('sales.back')}</Link></p>
        <div role="alert" className="kit-form-alert">
          {t('sales.missing')} <button type="button" className="kit-button" onClick={() => void q.refetch()}>{t('error.retry')}</button>
        </div>
      </>
    );
  }
  if (ret === undefined) return <p>{t('loading')}</p>;
  const open = (which: Exclude<Dialogs, null>) => () => setDialog(which);
  const shut = (isOpen: boolean) => { if (!isOpen) setDialog(null); };

  return (
    <>
      <p><Link href="/sales/delivery-returns">{t('sales.back')}</Link></p>
      <h1>{ret.number === null ? t('sales.return.title.draft') : t('sales.return.title', { number: ret.number })}</h1>
      <StatusBar label={t('sales.status.step')} steps={returnSteps(ret.status)} current={ret.status} />
      <RelatedRecords label={t('sales.related')} links={[{ label: t('sales.return.delivery'), href: `/sales/deliveries/${ret.deliveryId}` }]} />
      <CountCards label={t('sales.counts')} cards={[{ label: t('sales.count.lines'), value: String(ret.lines.length) }]} />
      <dl className="admin-facts" aria-label={t('sales.facts')}>
        <dt>{t('sales.party')}</dt><dd>{ret.partyName}</dd>
        <dt>{t('sales.date')}</dt><dd>{formatDate(ret.businessDate)}</dd>
        <dt>{t('sales.return.place')}</dt><dd><PlaceName id={ret.locationId} /></dd>
        <dt>{t('sales.notes')}</dt><dd>{ret.notes ?? t('sales.noNotes')}</dd>
      </dl>
      <DocumentLines caption={ret.number === null ? t('sales.lines') : t('sales.lines.of', { number: ret.number })} lines={ret.lines} />
      {ret.status === 'draft' ? <p>{t('sales.delivery.draftNote')}</p> : null}
      <div className="kit-actions">
        {mayWrite && ret.status === 'draft' ? (
          <>
            <button type="button" className="kit-button kit-button-primary" onClick={open('post')}>{t('sales.return.post')}</button>
            <button type="button" className="kit-button" onClick={open('delete')}>{t('sales.delete')}</button>
          </>
        ) : null}
        {mayCancel && ret.status === 'posted' ? (
          <button type="button" className="kit-button" onClick={open('cancel')}>{t('sales.return.cancel')}</button>
        ) : null}
      </div>

      <ConfirmDialog open={dialog === 'post'} onOpenChange={shut} messages={RETURN_MESSAGES} title={t('sales.return.post.title')}
        body={t('sales.return.post.body')} action={t('sales.return.post')} done=""
        onConfirm={async () => t('sales.return.posted', { number: (await post.submit({ id })).number })} />

      <ConfirmDialog open={dialog === 'delete'} onOpenChange={shut} messages={SALES_MESSAGES} title={t('sales.return.delete.title')}
        body={t('sales.return.delete.body')} action={t('sales.delete')} done={t('sales.return.deleted')}
        onConfirm={async () => { await remove.submit({ id }); router.push('/sales/delivery-returns'); }} />

      <Dialog open={dialog === 'cancel'} onOpenChange={shut} title={t('sales.return.cancel.title', { number: ret.number ?? '' })}
        description={t('sales.return.cancel.body')}>
        <Form schema={cancelSchema} saved={false} messages={RETURN_CANCEL_MESSAGES} defaultValues={{ businessDate: indiaDate(new Date()), reason: '' }}
          onSubmit={async (v) => { await cancel.submit({ id, ...v }); setDialog(null); later(t('sales.return.cancelled')); }}>
          <TextField name="businessDate" label={t('sales.delivery.cancel.date')} type="date" />
          <TextAreaField name="reason" label={t('sales.reason')} />
          <div className="kit-actions">
            <CloseButton>{t('sales.cancel')}</CloseButton>
            <SubmitButton>{t('sales.return.cancel')}</SubmitButton>
          </div>
        </Form>
      </Dialog>
    </>
  );
}
