'use client';
// One order (RAD-125 on RAD-112's contracts), in the record layout: where it is (the status bar), the quote it came from,
// its facts and lines, and what can be done next. A draft is edited, confirmed or deleted; confirming runs the credit and
// price checks, and when they find issues the dialog names them and offers to ask for an override (someone else with
// sales:override decides). A confirmed order is closed (short, with a reason, while lines are undelivered) or cancelled
// (with a reason, before anything is delivered). sales:write does all of it; the server says whether it still may.
import { formatDate } from '@radcore/lib-common';
import {
  cancelOrder, closeOrder, confirmOrder, deleteOrder, getOrder, listOrders, requestOrderOverride,
} from '@radcore/lib-sales/contract';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { z } from 'zod';
import { useMe } from '../../../../../components/shell/session-provider.tsx';
import { CloseButton, Dialog } from '../../../../../components/ui/dialog/dialog.tsx';
import { ReasonDialog } from '../../../../../components/ui/dialog/reason-dialog.tsx';
import { TextAreaField } from '../../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../../components/ui/form/form.tsx';
import { announce } from '../../../../../components/ui/live-region.tsx';
import { CountCards, RelatedRecords, StatusBar } from '../../../../../components/ui/record/record.tsx';
import { useApiMutation, useApiQuery } from '../../../../../lib/api/query.ts';
import { t } from '../../../../../lib/i18n/index.ts';
import { ConfirmDialog } from '../../../admin/shared.tsx';
import { OverrideConfirm } from '../../override-confirm.tsx';
import { LinesTable, SALES_MESSAGES } from '../../shared.tsx';
import { orderSteps } from '../../status.ts';

const later = (text: string) => setTimeout(() => announce(text), 0);
// An empty reason box means none: the server asks for one only when lines are still undelivered.
const closeSchema = z.object({
  reason: z.string().trim().transform((s) => (s === '' ? undefined : s)).pipe(closeOrder.input.shape.reason),
});
type Dialogs = 'confirm' | 'close' | 'cancel' | 'delete' | null;

export default function OrderPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const mayWrite = useMe().permissions.includes('sales:write');
  const q = useApiQuery(getOrder, { id });
  const again = [getOrder, listOrders];
  const confirm = useApiMutation(confirmOrder, { invalidates: again });
  const override = useApiMutation(requestOrderOverride, { invalidates: again });
  const close = useApiMutation(closeOrder, { invalidates: again });
  const cancel = useApiMutation(cancelOrder, { invalidates: again });
  // A deleted record is gone: refetching it would be a 404, so only the list is refreshed (e2e-2 on #278).
  const remove = useApiMutation(deleteOrder, { invalidates: [listOrders] });
  const [dialog, setDialog] = useState<Dialogs>(null);
  const order = q.data;

  if (q.error !== null) {
    return (
      <>
        <p><Link href="/sales/orders">{t('sales.back')}</Link></p>
        <div role="alert" className="kit-form-alert">
          {t('sales.missing')} <button type="button" className="kit-button" onClick={() => void q.refetch()}>{t('error.retry')}</button>
        </div>
      </>
    );
  }
  if (order === undefined) return <p>{t('loading')}</p>;
  const open = (which: Exclude<Dialogs, null>) => () => setDialog(which);
  const shut = (isOpen: boolean) => { if (!isOpen) setDialog(null); };
  return (
    <>
      <p><Link href="/sales/orders">{t('sales.back')}</Link></p>
      <h1>{order.number === null ? t('sales.order.title.draft') : t('sales.order.title', { number: order.number })}</h1>
      <StatusBar label={t('sales.status.step')} steps={orderSteps(order.status)} current={order.status} />
      <RelatedRecords label={t('sales.related')}
        links={order.quoteId === null ? [] : [{ label: t('sales.order.quote'), href: `/sales/quotes/${order.quoteId}` }]} />
      <CountCards label={t('sales.counts')} cards={[{ label: t('sales.count.lines'), value: String(order.lines.length) }]} />
      <dl className="admin-facts" aria-label={t('sales.facts')}>
        <dt>{t('sales.party')}</dt><dd>{order.partyName}</dd>
        <dt>{t('sales.date')}</dt><dd>{formatDate(order.businessDate)}</dd>
        <dt>{t('sales.notes')}</dt><dd>{order.notes ?? t('sales.noNotes')}</dd>
        {order.closeReason === null ? null : <><dt>{t('sales.order.closeReason')}</dt><dd>{order.closeReason}</dd></>}
      </dl>
      <LinesTable number={order.number} lines={order.lines} />
      {mayWrite ? (
        <div className="kit-actions">
          {order.status === 'draft' || order.status === 'confirmed' ? (
            <Link className="kit-button" href={`/sales/orders/${id}/edit`}>{t('sales.edit')}</Link>
          ) : null}
          {order.status === 'draft' ? (
            <>
              <button type="button" className="kit-button kit-button-primary" onClick={open('confirm')}>{t('sales.order.confirm')}</button>
              <button type="button" className="kit-button" onClick={open('delete')}>{t('sales.delete')}</button>
            </>
          ) : null}
          {order.status === 'confirmed' ? (
            <>
              <button type="button" className="kit-button" onClick={open('close')}>{t('sales.order.close')}</button>
              <button type="button" className="kit-button" onClick={open('cancel')}>{t('sales.order.cancel')}</button>
            </>
          ) : null}
        </div>
      ) : null}

      <OverrideConfirm open={dialog === 'confirm'} onOpenChange={shut} title={t('sales.order.confirm.title')} body={t('sales.order.confirm.body')}
        action={t('sales.order.confirm')} overrideBody={t('sales.order.override.body')} overrideAction={t('sales.order.override')}
        onConfirm={async () => t('sales.order.confirmed', { number: (await confirm.submit({ id })).number })}
        onAskOverride={async () => { await override.submit({ id }); return t('sales.order.overridden'); }} />

      <ConfirmDialog open={dialog === 'delete'} onOpenChange={shut} messages={SALES_MESSAGES} title={t('sales.order.delete.title')}
        body={t('sales.order.delete.body')} action={t('sales.delete')} done={t('sales.order.deleted')}
        onConfirm={async () => { await remove.submit({ id }); router.push('/sales/orders'); }} />

      <Dialog open={dialog === 'close'} onOpenChange={shut} title={t('sales.order.close.title')} description={t('sales.order.close.body')}>
        <Form schema={closeSchema} saved={false} messages={SALES_MESSAGES} defaultValues={{ reason: '' }}
          onSubmit={async (v) => {
            const { short } = await close.submit({ id, ...v });
            shut(false);
            later(t(short ? 'sales.order.closedShort' : 'sales.order.closed'));
          }}>
          <TextAreaField name="reason" label={t('sales.reason')} />
          <div className="kit-actions">
            <CloseButton>{t('sales.cancel')}</CloseButton>
            <SubmitButton>{t('sales.order.close')}</SubmitButton>
          </div>
        </Form>
      </Dialog>

      <ReasonDialog open={dialog === 'cancel'} onOpenChange={shut} messages={SALES_MESSAGES} title={t('sales.order.cancel.title')}
        action={t('sales.order.cancel')} done={t('sales.order.cancelled')}
        onConfirm={(why) => cancel.submit({ id, reason: why })} />
    </>
  );
}
