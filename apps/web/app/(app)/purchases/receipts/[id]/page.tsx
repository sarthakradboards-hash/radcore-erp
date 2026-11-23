'use client';
// One goods receipt (RAD-143 on RAD-137's contracts), in the record layout: where it is (the status bar), the purchase order it is
// against (a related-record button), its facts and its lines with what QC wrote. A draft is changed or deleted (inward:write) or
// inspected and posted (inward:qc, on its own page); a posted receipt is cancelled with a date and a reason under inward:qc, while
// nothing on it is billed, returned or moved on. The value is the server's, never added up here.
import { dateString, formatDate, formatMoney, indiaDate } from '@radcore/lib-common';
import { cancelGoodsReceipt, deleteGoodsReceipt, getGoodsReceipt, listGoodsReceipts } from '@radcore/lib-purchasing/contract';
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
import { PlaceName } from '../../../sales/deliveries/shared.tsx';
import { RECEIPT_MESSAGES, ReceiptLines, receiptNumber, receiptSteps } from '../shared.tsx';

const later = (text: string) => setTimeout(() => announce(text), 0);
const cancelSchema = z.object({ businessDate: dateString(), reason: cancelGoodsReceipt.input.shape.reason });
type Dialogs = 'cancel' | 'delete' | null;

export default function ReceiptPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { permissions } = useMe();
  const mayWrite = permissions.includes('inward:write');
  const mayQc = permissions.includes('inward:qc');
  const q = useApiQuery(getGoodsReceipt, { id });
  const cancel = useApiMutation(cancelGoodsReceipt, { invalidates: [getGoodsReceipt, listGoodsReceipts] });
  // A deleted record is gone: refetching it would be a 404, so only the list is refreshed.
  const remove = useApiMutation(deleteGoodsReceipt, { invalidates: [listGoodsReceipts] });
  const [dialog, setDialog] = useState<Dialogs>(null);
  const receipt = q.data;

  if (q.error !== null) {
    return (
      <>
        <p><Link href="/purchases/receipts">{t('inward.back')}</Link></p>
        <div role="alert" className="kit-form-alert">
          {t('inward.missing')} <button type="button" className="kit-button" onClick={() => void q.refetch()}>{t('error.retry')}</button>
        </div>
      </>
    );
  }
  if (receipt === undefined) return <p>{t('loading')}</p>;
  const open = (which: Exclude<Dialogs, null>) => () => setDialog(which);
  const shut = (isOpen: boolean) => { if (!isOpen) setDialog(null); };

  return (
    <>
      <p><Link href="/purchases/receipts">{t('inward.back')}</Link></p>
      <h1>{receipt.number === null ? t('inward.title.draft') : t('inward.title.number', { number: receipt.number })}</h1>
      <StatusBar label={t('inward.status.step')} steps={receiptSteps(receipt.status)} current={receipt.status} />
      <RelatedRecords label={t('inward.rec.related')} links={[{ label: `${t('inward.rec.order')}: ${receipt.orderNumber ?? ''}`, href: `/purchases/orders/${receipt.orderId}` }]} />
      <CountCards label={t('inward.rec.counts')} cards={[{ label: t('inward.rec.count.lines'), value: String(receipt.lines.length) }]} />
      <dl className="admin-facts" aria-label={t('inward.rec.facts')}>
        <dt>{t('inward.rec.supplier')}</dt><dd>{receipt.supplierName}</dd>
        <dt>{t('inward.rec.date')}</dt><dd>{formatDate(receipt.businessDate)}</dd>
        <dt>{t('inward.rec.place')}</dt><dd><PlaceName id={receipt.locationId} /></dd>
        <dt>{t('inward.rec.rejects')}</dt><dd><PlaceName id={receipt.rejectsLocationId} /></dd>
        <dt>{t('inward.rec.supplierRef')}</dt><dd>{receipt.supplierRef ?? t('inward.rec.none')}</dd>
        <dt>{t('inward.rec.notes')}</dt><dd>{receipt.notes ?? t('inward.rec.none')}</dd>
        {receipt.value === null ? null : <><dt>{t('inward.rec.value')}</dt><dd>{formatMoney(receipt.value)}</dd></>}
      </dl>
      <ReceiptLines caption={receipt.number === null ? t('inward.lines') : t('inward.lines.of', { number: receipt.number })} lines={receipt.lines} />
      <div className="kit-actions">
        {mayQc && receipt.status === 'draft' ? (
          <Link className="kit-button kit-button-primary" href={`/purchases/receipts/${id}/qc`}>{t('inward.qc')}</Link>
        ) : null}
        {mayWrite && receipt.status === 'draft' ? (
          <>
            <Link className="kit-button" href={`/purchases/receipts/${id}/edit`}>{t('inward.edit')}</Link>
            <button type="button" className="kit-button" onClick={open('delete')}>{t('inward.delete')}</button>
          </>
        ) : null}
        {mayQc && receipt.status === 'posted' ? <button type="button" className="kit-button" onClick={open('cancel')}>{t('inward.cancel')}</button> : null}
      </div>

      <ConfirmDialog open={dialog === 'delete'} onOpenChange={shut} messages={RECEIPT_MESSAGES} title={t('inward.delete.title')}
        body={t('inward.delete.body')} action={t('inward.delete')} done={t('inward.deleted')}
        onConfirm={async () => { await remove.submit({ id }); router.push('/purchases/receipts'); }} />

      <Dialog open={dialog === 'cancel'} onOpenChange={shut} title={t('inward.cancel.title', { number: receiptNumber(receipt.number) })}
        description={t('inward.cancel.body')}>
        <Form schema={cancelSchema} saved={false} messages={RECEIPT_MESSAGES} defaultValues={{ businessDate: indiaDate(new Date()), reason: '' }}
          onSubmit={async (v) => { await cancel.submit({ id, ...v }); setDialog(null); later(t('inward.cancelled')); }}>
          <TextField name="businessDate" label={t('inward.cancel.date')} type="date" />
          <TextAreaField name="reason" label={t('inward.cancel.reason')} />
          <div className="kit-actions">
            <CloseButton>{t('inward.cancel.keep')}</CloseButton>
            <SubmitButton>{t('inward.cancel')}</SubmitButton>
          </div>
        </Form>
      </Dialog>
    </>
  );
}
