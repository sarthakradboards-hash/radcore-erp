'use client';
// One quote (RAD-125 on RAD-112's contracts), in the record layout: where it is (the status bar), its facts, its lines, and
// what can be done next. A draft is edited, sent (it draws its number then) or deleted; a sent quote is accepted, which
// makes a draft order, or closed as declined or expired. sales:write does all of it; the server says whether the status
// still allows it.
import { dateString, formatDate, formatMoney, indiaDate, stateName } from '@radcore/lib-common';
import { acceptQuote, closeQuote, deleteQuote, getQuote, listQuotes, printQuote, sendQuote } from '@radcore/lib-sales/contract';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { z } from 'zod';
import { useMe } from '../../../../../components/shell/session-provider.tsx';
import { CloseButton, Dialog } from '../../../../../components/ui/dialog/dialog.tsx';
import { RadioField, TextField } from '../../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../../components/ui/form/form.tsx';
import { announce } from '../../../../../components/ui/live-region.tsx';
import { CountCards, RelatedRecords, StatusBar } from '../../../../../components/ui/record/record.tsx';
import { useApiMutation, useApiQuery } from '../../../../../lib/api/query.ts';
import { t } from '../../../../../lib/i18n/index.ts';
import { ConfirmDialog } from '../../../admin/shared.tsx';
import { AmountsSummary, LinesTable, SALES_MESSAGES } from '../../shared.tsx';
import { quoteSteps } from '../../status.ts';
import { PrintButtons } from '../../print-buttons.tsx';

const later = (text: string) => setTimeout(() => announce(text), 0);
const acceptSchema = z.object({ businessDate: dateString() });
const closeSchema = closeQuote.input.pick({ outcome: true });
type Dialogs = 'send' | 'accept' | 'close' | 'delete' | null;

export default function QuotePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const mayWrite = useMe().permissions.includes('sales:write');
  const q = useApiQuery(getQuote, { id });
  const again = [getQuote, listQuotes];
  const send = useApiMutation(sendQuote, { invalidates: again });
  const accept = useApiMutation(acceptQuote, { invalidates: again });
  const close = useApiMutation(closeQuote, { invalidates: again });
  // A deleted record is gone: refetching it would be a 404, so only the list is refreshed (e2e-2 on #278).
  const remove = useApiMutation(deleteQuote, { invalidates: [listQuotes] });
  const [dialog, setDialog] = useState<Dialogs>(null);
  const quote = q.data;

  if (q.error !== null) {
    return (
      <>
        <p><Link href="/sales/quotes">{t('sales.back')}</Link></p>
        <div role="alert" className="kit-form-alert">
          {t('sales.missing')} <button type="button" className="kit-button" onClick={() => void q.refetch()}>{t('error.retry')}</button>
        </div>
      </>
    );
  }
  if (quote === undefined) return <p>{t('loading')}</p>;
  const open = (which: Exclude<Dialogs, null>) => () => setDialog(which);
  const shut = (isOpen: boolean) => { if (!isOpen) setDialog(null); };

  return (
    <>
      <p><Link href="/sales/quotes">{t('sales.back')}</Link></p>
      <h1>{quote.number === null ? t('sales.quote.title.draft') : t('sales.quote.title', { number: quote.number })}</h1>
      <StatusBar label={t('sales.status.step')} steps={quoteSteps(quote.status)} current={quote.status} />
      <RelatedRecords label={t('sales.related')}
        links={quote.orderId === null ? [] : [{ label: t('sales.quote.order'), href: `/sales/orders/${quote.orderId}` }]} />
      <CountCards label={t('sales.counts')} cards={[
        { label: t('sales.count.lines'), value: String(quote.lines.length) },
        ...(quote.amounts.total === null ? [] : [{ label: t('sales.amounts.total'), value: formatMoney(quote.amounts.total) }]),
      ]} />
      <dl className="admin-facts" aria-label={t('sales.facts')}>
        <dt>{t('sales.party')}</dt><dd>{quote.partyName}</dd>
        <dt>{t('sales.date')}</dt><dd>{formatDate(quote.businessDate)}</dd>
        {quote.amounts.placeOfSupply === null ? null : <><dt>{t('sales.amounts.placeOfSupply')}</dt><dd>{stateName(quote.amounts.placeOfSupply) ?? quote.amounts.placeOfSupply}</dd></>}
        <dt>{t('sales.quote.validUntil')}</dt><dd>{quote.validUntil === null ? t('sales.quote.noValidUntil') : formatDate(quote.validUntil)}</dd>
        <dt>{t('sales.notes')}</dt><dd>{quote.notes ?? t('sales.noNotes')}</dd>
      </dl>
      <LinesTable number={quote.number} lines={quote.lines} />
      <AmountsSummary number={quote.number} amounts={quote.amounts} />
      {mayWrite ? (
        <div className="kit-actions">
        <PrintButtons contract={printQuote} id={id} />
          {quote.status === 'draft' ? (
            <>
              <Link className="kit-button" href={`/sales/quotes/${id}/edit`}>{t('sales.edit')}</Link>
              <button type="button" className="kit-button kit-button-primary" onClick={open('send')}>{t('sales.quote.send')}</button>
              <button type="button" className="kit-button" onClick={open('delete')}>{t('sales.delete')}</button>
            </>
          ) : null}
          {quote.status === 'sent' ? (
            <>
              <button type="button" className="kit-button kit-button-primary" onClick={open('accept')}>{t('sales.quote.accept')}</button>
              <button type="button" className="kit-button" onClick={open('close')}>{t('sales.quote.close')}</button>
            </>
          ) : null}
        </div>
      ) : null}

      <ConfirmDialog open={dialog === 'send'} onOpenChange={shut} messages={SALES_MESSAGES} title={t('sales.quote.send.title')}
        body={t('sales.quote.send.body')} action={t('sales.quote.send')} done=""
        onConfirm={async () => t('sales.quote.sent', { number: (await send.submit({ id })).number })} />
      <ConfirmDialog open={dialog === 'delete'} onOpenChange={shut} messages={SALES_MESSAGES} title={t('sales.quote.delete.title')}
        body={t('sales.quote.delete.body')} action={t('sales.delete')} done={t('sales.quote.deleted')}
        onConfirm={async () => { await remove.submit({ id }); router.push('/sales/quotes'); }} />

      <Dialog open={dialog === 'accept'} onOpenChange={shut} title={t('sales.quote.accept.title')} description={t('sales.quote.accept.body')}>
        <Form schema={acceptSchema} saved={false} messages={SALES_MESSAGES} defaultValues={{ businessDate: indiaDate(new Date()) }}
          onSubmit={async (v) => {
            const { orderId } = await accept.submit({ id, ...v });
            setDialog(null);
            later(t('sales.quote.accepted'));
            router.push(`/sales/orders/${orderId}`);
          }}>
          <TextField name="businessDate" label={t('sales.quote.accept.date')} type="date" />
          <div className="kit-actions">
            <CloseButton>{t('sales.cancel')}</CloseButton>
            <SubmitButton>{t('sales.quote.accept')}</SubmitButton>
          </div>
        </Form>
      </Dialog>

      <Dialog open={dialog === 'close'} onOpenChange={shut} title={t('sales.quote.close.title')}>
        <Form schema={closeSchema} saved={false} messages={SALES_MESSAGES} defaultValues={{ outcome: 'declined' }}
          onSubmit={async (v) => { await close.submit({ id, ...v }); setDialog(null); later(t('sales.quote.closed')); }}>
          <RadioField name="outcome" label={t('sales.quote.close.outcome')} options={[
            { value: 'declined', label: t('sales.quote.declined') }, { value: 'expired', label: t('sales.quote.expired') },
          ]} />
          <div className="kit-actions">
            <CloseButton>{t('sales.cancel')}</CloseButton>
            <SubmitButton>{t('sales.quote.close')}</SubmitButton>
          </div>
        </Form>
      </Dialog>
    </>
  );
}
