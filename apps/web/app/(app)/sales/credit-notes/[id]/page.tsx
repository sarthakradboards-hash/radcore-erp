'use client';
// One credit note (RAD-125 on RAD-114's contract), in the record layout: where it is (the status bar), the invoice it credits
// (a related-record button), its facts (kind, reason, a counter refund, whether it is late), its lines with the GST the
// server worked out, and its totals. A draft isn't edited: it is sent for approval (someone else with credit_notes:approve
// decides, and approving posts it, applies it to its invoice and pays any refund) or deleted. A posted note is cancelled with
// a date and a reason under credit_notes:cancel, refused while it is applied or refunded.
import { dateString, formatDate, formatMoney, indiaDate, isMasked } from '@radcore/lib-common';
import { cancelCreditNote, deleteCreditNote, getCreditNote, listCreditNotes, requestCreditNoteApproval } from '@radcore/lib-sales/contract';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { z } from 'zod';
import { useMe } from '../../../../../components/shell/session-provider.tsx';
import { CloseButton, Dialog } from '../../../../../components/ui/dialog/dialog.tsx';
import { TextAreaField, TextField } from '../../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../../components/ui/form/form.tsx';
import { announce } from '../../../../../components/ui/live-region.tsx';
import { Pii } from '../../../../../components/ui/masked.tsx';
import { CountCards, RelatedRecords, StatusBar } from '../../../../../components/ui/record/record.tsx';
import '../../../../../components/ui/table/table.css';
import { useApiMutation, useApiQuery } from '../../../../../lib/api/query.ts';
import { t } from '../../../../../lib/i18n/index.ts';
import { asWritten } from '../../../admin/decimal.ts';
import { ConfirmDialog } from '../../../admin/shared.tsx';
import { PlaceName } from '../../deliveries/shared.tsx';
import { AmountsSummary } from '../../shared.tsx';
import { creditSteps } from '../../status.ts';
import { CREDIT_CANCEL_MESSAGES, CREDIT_MESSAGES, type CreditNote } from '../shared.tsx';
import { Applications } from './applications.tsx';

const later = (text: string) => setTimeout(() => announce(text), 0);
const cancelSchema = z.object({ businessDate: dateString(), reason: cancelCreditNote.input.shape.reason });
type Dialogs = 'send' | 'cancel' | 'delete' | null;

const money = (x: string | null) => (x === null ? '' : formatMoney(x));

function Lines({ c }: { c: CreditNote }) {
  const captionId = useId();
  const goods = c.kind === 'goods';
  return (
    <div className="kit-table">
      <div className="kit-table-scroll" role="region" aria-labelledby={captionId} tabIndex={0}>
        <table>
          <caption id={captionId}>{c.number === null ? t('sales.lines') : t('sales.lines.of', { number: c.number })}</caption>
          <thead>
            <tr>
              <th scope="col">{t('sales.line.item')}</th>
              {goods ? <th scope="col" className="kit-numeric">{t('sales.credit.col.qty')}</th> : null}
              <th scope="col" className="kit-numeric">{t('sales.credit.col.taxable')}</th>
              <th scope="col" className="kit-numeric">{t('sales.amounts.cgst')}</th>
              <th scope="col" className="kit-numeric">{t('sales.amounts.sgst')}</th>
              <th scope="col" className="kit-numeric">{t('sales.amounts.igst')}</th>
              <th scope="col" className="kit-numeric">{t('sales.amounts.lineTotal')}</th>
              {goods ? <th scope="col" className="kit-numeric">{t('sales.credit.col.cost')}</th> : null}
            </tr>
          </thead>
          <tbody>
            {c.lines.map((l) => (
              <tr key={l.id}>
                <td>{l.name} ({l.sku})</td>
                {goods ? <td className="kit-numeric">{l.qty === null ? '' : asWritten(l.qty)}</td> : null}
                <td className="kit-numeric">{money(l.taxable)}</td>
                <td className="kit-numeric">{money(l.cgst)}</td>
                <td className="kit-numeric">{money(l.sgst)}</td>
                <td className="kit-numeric">{money(l.igst)}</td>
                <td className="kit-numeric">{money(l.lineTotal)}</td>
                {goods ? <td className="kit-numeric">{l.cost === null ? '' : isMasked(l.cost) ? <Pii value={l.cost} /> : formatMoney(l.cost)}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function CreditNotePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { permissions } = useMe();
  const mayWrite = permissions.includes('credit_notes:write');
  const mayCancel = permissions.includes('credit_notes:cancel');
  const q = useApiQuery(getCreditNote, { id });
  const again = [getCreditNote, listCreditNotes];
  const send = useApiMutation(requestCreditNoteApproval, { invalidates: again });
  const cancel = useApiMutation(cancelCreditNote, { invalidates: again });
  // A deleted record is gone: refetching it would be a 404, so only the list is refreshed.
  const remove = useApiMutation(deleteCreditNote, { invalidates: [listCreditNotes] });
  const [dialog, setDialog] = useState<Dialogs>(null);
  const note = q.data;

  if (q.error !== null) {
    return (
      <>
        <p><Link href="/sales/credit-notes">{t('sales.back')}</Link></p>
        <div role="alert" className="kit-form-alert">
          {t('sales.missing')} <button type="button" className="kit-button" onClick={() => void q.refetch()}>{t('error.retry')}</button>
        </div>
      </>
    );
  }
  if (note === undefined) return <p>{t('loading')}</p>;
  const open = (which: Exclude<Dialogs, null>) => () => setDialog(which);
  const shut = (isOpen: boolean) => { if (!isOpen) setDialog(null); };
  const worked = note.status !== 'draft';

  return (
    <>
      <p><Link href="/sales/credit-notes">{t('sales.back')}</Link></p>
      <h1>{note.number === null ? t('sales.credit.title.draft') : t('sales.credit.title', { number: note.number })}</h1>
      <StatusBar label={t('sales.status.step')} steps={creditSteps(note.status)} current={note.status} />
      <RelatedRecords label={t('sales.related')} links={[{ label: t('sales.credit.invoice'), href: `/sales/invoices/${note.invoiceId}` }]} />
      <CountCards label={t('sales.counts')} cards={[
        { label: t('sales.count.lines'), value: String(note.lines.length) },
        { label: t('sales.amounts.total'), value: formatMoney(note.total) },
      ]} />
      <dl className="admin-facts" aria-label={t('sales.facts')}>
        <dt>{t('sales.party')}</dt><dd>{note.partyName}</dd>
        <dt>{t('sales.date')}</dt><dd>{formatDate(note.businessDate)}</dd>
        <dt>{t('sales.credit.kind')}</dt><dd>{t(`sales.credit.kind.${note.kind}`)}</dd>
        {note.locationId === null ? null : <><dt>{t('sales.credit.place')}</dt><dd><PlaceName id={note.locationId} /></dd></>}
        <dt>{t('sales.credit.reason')}</dt><dd>{note.reason}</dd>
        <dt>{t('sales.credit.refund')}</dt>
        <dd>{note.refund === null ? t('sales.credit.refund.none') : t(worked ? 'sales.credit.refund.paid' : 'sales.credit.refund.amount', { amount: formatMoney(note.refund.amount) })}</dd>
        {note.late ? <><dt>{t('sales.credit.late')}</dt><dd>{t('sales.credit.late.yes')}</dd></> : null}
      </dl>
      <Lines c={note} />
      {worked ? (
        <AmountsSummary number={note.number} amounts={{ placeOfSupply: null, taxable: note.taxable, cgst: note.cgst, sgst: note.sgst, igst: note.igst,
          roundOff: note.roundOff, total: note.total, note: null }} />
      ) : <p>{t('sales.invoice.notPosted')}</p>}
      {worked ? <Applications applications={note.applications} /> : null}
      {note.status === 'draft' ? <p>{t('sales.credit.draftNote')}</p> : null}
      {note.status === 'draft' && note.approval === 'pending' ? <p className="admin-notice">{t('sales.credit.pending')}</p> : null}
      <div className="kit-actions">
        {mayWrite && note.status === 'draft' ? (
          <>
            {note.approval === 'none' ? <button type="button" className="kit-button kit-button-primary" onClick={open('send')}>{t('sales.credit.send')}</button> : null}
            {note.approval === 'pending' ? null : <button type="button" className="kit-button" onClick={open('delete')}>{t('sales.delete')}</button>}
          </>
        ) : null}
        {mayCancel && note.status === 'posted' ? (
          <button type="button" className="kit-button" onClick={open('cancel')}>{t('sales.credit.cancel')}</button>
        ) : null}
      </div>

      <ConfirmDialog open={dialog === 'send'} onOpenChange={shut} messages={CREDIT_MESSAGES} title={t('sales.credit.send.title')}
        body={t('sales.credit.send.body')} action={t('sales.credit.send')} done={t('sales.credit.sent')}
        onConfirm={async () => { await send.submit({ id }); }} />

      <ConfirmDialog open={dialog === 'delete'} onOpenChange={shut} messages={CREDIT_MESSAGES} title={t('sales.credit.delete.title')}
        body={t('sales.credit.delete.body')} action={t('sales.delete')} done={t('sales.credit.deleted')}
        onConfirm={async () => { await remove.submit({ id }); router.push('/sales/credit-notes'); }} />

      <Dialog open={dialog === 'cancel'} onOpenChange={shut} title={t('sales.credit.cancel.title', { number: note.number ?? '' })}
        description={t('sales.credit.cancel.body')}>
        <Form schema={cancelSchema} saved={false} messages={CREDIT_CANCEL_MESSAGES} defaultValues={{ businessDate: indiaDate(new Date()), reason: '' }}
          onSubmit={async (v) => { await cancel.submit({ id, ...v }); setDialog(null); later(t('sales.credit.cancelled')); }}>
          <TextField name="businessDate" label={t('sales.credit.cancel.date')} type="date" />
          <TextAreaField name="reason" label={t('sales.reason')} />
          <div className="kit-actions">
            <CloseButton>{t('sales.cancel')}</CloseButton>
            <SubmitButton>{t('sales.credit.cancel')}</SubmitButton>
          </div>
        </Form>
      </Dialog>
    </>
  );
}
