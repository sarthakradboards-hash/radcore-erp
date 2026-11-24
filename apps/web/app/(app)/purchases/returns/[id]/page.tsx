'use client';
// One supplier return (RAD-143 on RAD-140's contracts): the rejects that went back, and each line split as the server splits it
// (ADR-008 §8): its unbilled part, back against Goods Received Not Billed at the receipt's rate, then its billed part, debited
// against each bill that billed it at that bill's rate and GST. The debit note totals the billed parts and is applied to those
// bills as it posts. A draft is edited, posted or deleted; a posted one is printed (the statutory debit note) or cancelled.
import { formatDate, formatMoney, indiaDate, reason as reasonString, dateString, stateName } from '@radcore/lib-common';
import {
  cancelSupplierReturn, deleteSupplierReturn, getSupplierReturn, listSupplierReturns, postSupplierReturn, printSupplierReturn,
} from '@radcore/lib-purchasing/contract';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { z } from 'zod';
import { useMe } from '../../../../../components/shell/session-provider.tsx';
import { CloseButton, Dialog } from '../../../../../components/ui/dialog/dialog.tsx';
import { TextAreaField, TextField } from '../../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../../components/ui/form/form.tsx';
import { announce } from '../../../../../components/ui/live-region.tsx';
import { StatusBar } from '../../../../../components/ui/record/record.tsx';
import { useApiMutation, useApiQuery } from '../../../../../lib/api/query.ts';
import { t } from '../../../../../lib/i18n/index.ts';
import '../../../../../components/ui/table/table.css';
import { asPrice, asWritten } from '../../../admin/decimal.ts';
import { ConfirmDialog } from '../../../admin/shared.tsx';
import { PrintButtons } from '../../../sales/print-buttons.tsx';
import { PURCHASE_MESSAGES } from '../../shared.tsx';

type Dialogs = 'post' | 'delete' | 'cancel' | null;
type Status = 'draft' | 'posted' | 'cancelled';
const cancelSchema = z.object({ businessDate: dateString(), reason: reasonString() });
const steps = (s: Status) => (s === 'cancelled' ? ['draft', 'posted', 'cancelled'] as const : ['draft', 'posted'] as const)
  .map((key) => ({ key, label: t(`purchases.bill.status.${key}`) }));
const gst = (x: { cgst: string | null; sgst: string | null; igst: string | null }) =>
  [x.cgst, x.sgst, x.igst].filter((v) => v !== null).map((v) => formatMoney(v)).join(' + ');

export default function SupplierReturnPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const mayWrite = useMe().permissions.includes('supplier_returns:write');
  const q = useApiQuery(getSupplierReturn, { id });
  const again = [getSupplierReturn, listSupplierReturns];
  const post = useApiMutation(postSupplierReturn, { invalidates: again });
  const cancel = useApiMutation(cancelSupplierReturn, { invalidates: again });
  const remove = useApiMutation(deleteSupplierReturn, { invalidates: [listSupplierReturns] });
  const [dialog, setDialog] = useState<Dialogs>(null);
  const linesId = useId();
  const r = q.data;
  const back = <p><Link href="/purchases/returns">{t('purchases.return.back')}</Link></p>;
  if (q.error !== null) {
    return (
      <>
        {back}
        <div role="alert" className="kit-form-alert">
          {t('purchases.return.missing')} <button type="button" className="kit-button" onClick={() => void q.refetch()}>{t('error.retry')}</button>
        </div>
      </>
    );
  }
  if (r === undefined) return <p>{t('loading')}</p>;
  const shut = (isOpen: boolean) => { if (!isOpen) setDialog(null); };
  const draft = r.status === 'draft';
  const dn = r.debitNote;
  return (
    <>
      {back}
      <h1>{r.number === null ? t('purchases.return.title.draft') : t('purchases.return.title', { number: r.number })}</h1>
      <StatusBar label={t('purchases.status.step')} steps={steps(r.status)} current={r.status} />
      {r.amountsNote === null ? null : <p className="admin-notice">{r.amountsNote}</p>}
      <dl className="admin-facts" aria-label={t('purchases.return.facts')}>
        <dt>{t('purchases.order.supplier')}</dt><dd>{r.supplierName}</dd>
        <dt>{t('purchases.return.place')}</dt><dd>{r.locationName}</dd>
        <dt>{t('purchases.order.date')}</dt><dd>{formatDate(r.businessDate)}</dd>
        <dt>{t('purchases.return.reason')}</dt><dd>{r.reason}</dd>
        <dt>{t('purchases.order.notes')}</dt><dd>{r.notes ?? t('purchases.order.noNotes')}</dd>
        <dt>{t('purchases.return.unbilledValue')}</dt><dd>{formatMoney(r.unbilledValue)}</dd>
        {r.cancelReason === null ? null : <><dt>{t('purchases.bill.cancelReason')}</dt><dd>{r.cancelReason}</dd></>}
      </dl>
      <div className="kit-table">
        <div className="kit-table-scroll" role="region" aria-labelledby={linesId} tabIndex={0}>
          <table>
            <caption id={linesId}>{t('purchases.return.lines')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('purchases.bill.col.item')}</th>
                <th scope="col">{t('purchases.return.receipt')}</th>
                <th scope="col" className="kit-numeric">{t('purchases.bill.col.qty')}</th>
                <th scope="col">{t('purchases.return.batchesAndUnits')}</th>
                <th scope="col">{t('purchases.return.unbilled')}</th>
                <th scope="col">{t('purchases.return.billed')}</th>
              </tr>
            </thead>
            <tbody>
              {r.lines.map((l) => (
                <tr key={l.id}>
                  <td>{l.name} ({l.sku})</td>
                  <td>{l.receiptId === null ? '' : <Link href={`/purchases/receipts/${l.receiptId}`}>{l.receiptNumber}</Link>}</td>
                  <td className="kit-numeric">{asWritten(l.qty)} {l.unit}</td>
                  <td>{[...l.batches.map((b) => `${b.batchNo} (${asWritten(b.qty)})`), ...l.serials].join(', ')}</td>
                  <td>{t('purchases.return.unbilledPart', { qty: asWritten(l.unbilledQty), rate: asPrice(l.rate), value: formatMoney(l.unbilledValue) })}</td>
                  <td>
                    {l.billed.length === 0 ? t('purchases.none') : (
                      <ul>
                        {l.billed.map((b) => (
                          <li key={b.billLineId}>
                            <Link href={`/purchases/bills/${b.billId}`}>{b.billNumber}</Link>: {t('purchases.return.billedPart',
                              { qty: asWritten(b.qty), rate: asPrice(b.rate), taxable: formatMoney(b.taxable), gst: gst(b) })}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <h2>{t('purchases.return.debitNote')}</h2>
      {dn === null ? <p>{t('purchases.return.noDebit')}</p> : (
        <dl className="admin-facts" aria-label={t('purchases.return.debitNote')}>
          <dt>{t('purchases.col.number')}</dt><dd>{dn.number ?? t('purchases.return.debitOnPost')}</dd>
          {dn.placeOfSupply === null ? null : <><dt>{t('sales.amounts.placeOfSupply')}</dt><dd>{stateName(dn.placeOfSupply) ?? dn.placeOfSupply}</dd></>}
          <dt>{t('sales.amounts.taxable')}</dt><dd>{formatMoney(dn.taxable)}</dd>
          {dn.cgst === null ? null : <><dt>{t('sales.amounts.cgst')}</dt><dd>{formatMoney(dn.cgst)}</dd></>}
          {dn.sgst === null ? null : <><dt>{t('sales.amounts.sgst')}</dt><dd>{formatMoney(dn.sgst)}</dd></>}
          {dn.igst === null ? null : <><dt>{t('sales.amounts.igst')}</dt><dd>{formatMoney(dn.igst)}</dd></>}
          <dt>{t('sales.amounts.roundOff')}</dt><dd>{formatMoney(dn.roundOff)}</dd>
          <dt>{t('sales.amounts.total')}</dt><dd>{formatMoney(dn.total)}</dd>
        </dl>
      )}
      {r.applications.length === 0 ? null : (
        <>
          <h3>{t('purchases.return.applied')}</h3>
          <ul>
            {r.applications.map((a) => (
              <li key={a.id}>
                {t('purchases.return.appliedTo', { number: a.documentNumber ?? t('purchases.bill.status.draft'), amount: formatMoney(a.amount), date: formatDate(a.businessDate) })}
                {a.reversed ? `, ${t('purchases.return.reversed')}` : ''}
              </li>
            ))}
          </ul>
        </>
      )}
      {r.status === 'draft' ? null : <div className="kit-actions"><PrintButtons contract={printSupplierReturn} id={id} papers={['a4']} /></div>}
      {mayWrite ? (
        <div className="kit-actions">
          {draft ? <Link className="kit-button" href={`/purchases/returns/${id}/edit`}>{t('purchases.edit')}</Link> : null}
          {draft ? <button type="button" className="kit-button kit-button-primary" onClick={() => setDialog('post')}>{t('purchases.return.post')}</button> : null}
          {draft ? <button type="button" className="kit-button" onClick={() => setDialog('delete')}>{t('purchases.delete')}</button> : null}
          {r.status === 'posted' ? <button type="button" className="kit-button" onClick={() => setDialog('cancel')}>{t('purchases.bill.cancel')}</button> : null}
        </div>
      ) : null}

      <ConfirmDialog open={dialog === 'post'} onOpenChange={shut} messages={PURCHASE_MESSAGES} title={t('purchases.return.post.title')}
        body={t('purchases.return.post.body')} action={t('purchases.return.post')} done={t('purchases.return.posted.plain')}
        onConfirm={async () => {
          const p = await post.submit({ id });
          return p.debitNoteNumber === null ? t('purchases.return.posted', { number: p.number })
            : t('purchases.return.postedWithDebit', { number: p.number, debit: p.debitNoteNumber });
        }} />
      <ConfirmDialog open={dialog === 'delete'} onOpenChange={shut} messages={PURCHASE_MESSAGES} title={t('purchases.return.delete.title')}
        body={t('purchases.return.delete.body')} action={t('purchases.delete')} done={t('purchases.deleted')}
        onConfirm={async () => { await remove.submit({ id }); router.push('/purchases/returns'); }} />
      <Dialog open={dialog === 'cancel'} onOpenChange={shut} title={t('purchases.return.cancel.title')} description={t('purchases.return.cancel.body')}>
        <Form schema={cancelSchema} saved={false} messages={PURCHASE_MESSAGES} defaultValues={{ businessDate: indiaDate(new Date()), reason: '' }}
          onSubmit={async (v) => { await cancel.submit({ id, ...v }); setDialog(null); setTimeout(() => announce(t('purchases.return.cancelled')), 0); }}>
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
