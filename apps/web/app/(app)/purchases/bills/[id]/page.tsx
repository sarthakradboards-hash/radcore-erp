'use client';
// One purchase bill (RAD-143 on RAD-138's contracts), in the record layout: the supplier's invoice it records, its match view
// against the POs and receipts, and the amounts the server worked out. A draft is posted (at once within the tolerance, else it
// waits for someone else's approval under bills:approve) or deleted; a posted one is cancelled by its mirror, dated, with a
// reason. bills:write does all of it; the server says whether it still may.
import { formatDate, formatMoney, indiaDate, reason as reasonString, dateString, stateName } from '@radcore/lib-common';
import { cancelPurchaseBill, deletePurchaseBill, getPurchaseBill, listPurchaseBills, postPurchaseBill, purchaseBillApproval } from '@radcore/lib-purchasing/contract';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { z } from 'zod';
import { useMe } from '../../../../../components/shell/session-provider.tsx';
import { CloseButton, Dialog } from '../../../../../components/ui/dialog/dialog.tsx';
import { TextAreaField, TextField } from '../../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../../components/ui/form/form.tsx';
import { announce } from '../../../../../components/ui/live-region.tsx';
import { CountCards, StatusBar } from '../../../../../components/ui/record/record.tsx';
import { useApiMutation, useApiQuery } from '../../../../../lib/api/query.ts';
import { t } from '../../../../../lib/i18n/index.ts';
import { ConfirmDialog } from '../../../admin/shared.tsx';
import { AmountsSummary } from '../../../sales/shared.tsx';
import { PURCHASE_MESSAGES } from '../../shared.tsx';
import { billNumberText, billSteps, MatchView } from '../bill-shared.tsx';

type Dialogs = 'post' | 'delete' | 'cancel' | null;
const cancelSchema = z.object({ businessDate: dateString(), reason: reasonString() });

export default function PurchaseBillPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const mayWrite = useMe().permissions.includes('bills:write');
  const q = useApiQuery(getPurchaseBill, { id });
  const again = [getPurchaseBill, listPurchaseBills, purchaseBillApproval.listPending];
  const post = useApiMutation(postPurchaseBill, { invalidates: again });
  const cancel = useApiMutation(cancelPurchaseBill, { invalidates: again });
  const remove = useApiMutation(deletePurchaseBill, { invalidates: [listPurchaseBills, purchaseBillApproval.listPending] });
  const [dialog, setDialog] = useState<Dialogs>(null);
  const b = q.data;
  if (q.error !== null) {
    return (
      <>
        <p><Link href="/purchases/bills">{t('purchases.bill.back')}</Link></p>
        <div role="alert" className="kit-form-alert">
          {t('purchases.bill.missing')} <button type="button" className="kit-button" onClick={() => void q.refetch()}>{t('error.retry')}</button>
        </div>
      </>
    );
  }
  if (b === undefined) return <p>{t('loading')}</p>;
  const shut = (isOpen: boolean) => { if (!isOpen) setDialog(null); };
  const draft = b.status === 'draft';
  return (
    <>
      <p><Link href="/purchases/bills">{t('purchases.bill.back')}</Link></p>
      <h1>{b.number === null ? t('purchases.bill.title.draft', { invoice: b.supplierInvoiceNumber }) : t('purchases.bill.title', { number: b.number })}</h1>
      <StatusBar label={t('purchases.status.step')} steps={billSteps(b.status)} current={b.status} />
      {b.awaitingApproval ? <p className="admin-notice">{t('purchases.bill.awaiting')}</p> : null}
      {draft && b.fileId === null ? <p className="admin-notice">{t('purchases.bill.noFile')}</p> : null}
      <CountCards label={t('purchases.bill.counts')} cards={[
        { label: t('purchases.bill.statedTotal'), value: formatMoney(b.statedTotal) },
        ...(b.amounts.total === null ? [] : [{ label: t('purchases.bill.workedTotal'), value: formatMoney(b.amounts.total) }]),
      ]} />
      <dl className="admin-facts" aria-label={t('purchases.bill.facts')}>
        <dt>{t('purchases.order.supplier')}</dt><dd>{b.supplierName}</dd>
        <dt>{t('purchases.bill.supplierGstin')}</dt><dd>{b.supplierGstin ?? t('purchases.bill.unregistered')}</dd>
        <dt>{t('purchases.bill.supplierInvoice')}</dt><dd>{b.supplierInvoiceNumber}, {formatDate(b.supplierInvoiceDate)}</dd>
        <dt>{t('purchases.bill.date')}</dt><dd>{formatDate(b.businessDate)}</dd>
        {b.amounts.placeOfSupply === null ? null
          : <><dt>{t('sales.amounts.placeOfSupply')}</dt><dd>{stateName(b.amounts.placeOfSupply) ?? b.amounts.placeOfSupply}</dd></>}
        <dt>{t('purchases.bill.file')}</dt><dd>{b.fileId === null ? t('purchases.bill.file.none') : t('purchases.bill.file.attached')}</dd>
        <dt>{t('purchases.order.notes')}</dt><dd>{b.notes ?? t('purchases.order.noNotes')}</dd>
        {b.cancelReason === null ? null : <><dt>{t('purchases.bill.cancelReason')}</dt><dd>{b.cancelReason}</dd></>}
      </dl>
      <MatchView bill={b} />
      <AmountsSummary number={billNumberText(b.number)} amounts={b.amounts} />
      {mayWrite ? (
        <div className="kit-actions">
          {draft && !b.awaitingApproval
            ? <button type="button" className="kit-button kit-button-primary" onClick={() => setDialog('post')}>{t('purchases.bill.post')}</button> : null}
          {draft ? <Link className="kit-button" href={`/purchases/bills/${id}/edit`}>{t('purchases.edit')}</Link> : null}
          {draft ? <button type="button" className="kit-button" onClick={() => setDialog('delete')}>{t('purchases.delete')}</button> : null}
          {b.status === 'posted' ? <button type="button" className="kit-button" onClick={() => setDialog('cancel')}>{t('purchases.bill.cancel')}</button> : null}
        </div>
      ) : null}

      <ConfirmDialog open={dialog === 'post'} onOpenChange={shut} messages={PURCHASE_MESSAGES} title={t('purchases.bill.post.title')}
        body={t('purchases.bill.post.body')} action={t('purchases.bill.post')} done={t('purchases.bill.sentForApproval')}
        onConfirm={async () => {
          const r = await post.submit({ id });
          return r.status === 'posted' && r.number !== null ? t('purchases.bill.posted', { number: r.number }) : t('purchases.bill.sentForApproval');
        }} />
      <ConfirmDialog open={dialog === 'delete'} onOpenChange={shut} messages={PURCHASE_MESSAGES} title={t('purchases.bill.delete.title')}
        body={t('purchases.bill.delete.body')} action={t('purchases.delete')} done={t('purchases.deleted')}
        onConfirm={async () => { await remove.submit({ id }); router.push('/purchases/bills'); }} />
      <Dialog open={dialog === 'cancel'} onOpenChange={shut} title={t('purchases.bill.cancel.title')} description={t('purchases.bill.cancel.body')}>
        <Form schema={cancelSchema} saved={false} messages={PURCHASE_MESSAGES} defaultValues={{ businessDate: indiaDate(new Date()), reason: '' }}
          onSubmit={async (v) => { await cancel.submit({ id, ...v }); setDialog(null); setTimeout(() => announce(t('purchases.bill.cancelled')), 0); }}>
          <TextField name="businessDate" label={t('purchases.bill.cancel.date')} type="date" />
          <TextAreaField name="reason" label={t('admin.reason')} />
          <div className="kit-actions">
            <CloseButton>{t('admin.cancel')}</CloseButton>
            <SubmitButton>{t('purchases.bill.cancel')}</SubmitButton>
          </div>
        </Form>
      </Dialog>
    </>
  );
}
