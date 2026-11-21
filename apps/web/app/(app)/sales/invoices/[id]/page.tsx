'use client';
// One invoice (RAD-125 on RAD-113's contract), in the record layout: where it is (the status bar), its facts (the issuer and
// buyer frozen when it was posted, the place of supply), its lines with the GST worked out, and its totals. A draft is
// edited, posted (the checks run; when they find issues the dialog names them and offers to ask for an override) or
// deleted. A posted invoice is cancelled with a date and a reason, which mirrors its entry and opens its deliveries for
// invoicing again. invoices:write and invoices:cancel are the server's keys; it says whether the status still allows it.
import { dateString, formatDate, formatMoney, indiaDate, stateName, type Masked } from '@radcore/lib-common';
import { cancelInvoice, deleteInvoice, getInvoice, listInvoices, postInvoice, requestInvoiceOverride } from '@radcore/lib-sales/contract';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Fragment, useId, useState } from 'react';
import { z } from 'zod';
import { useMe } from '../../../../../components/shell/session-provider.tsx';
import { CloseButton, Dialog } from '../../../../../components/ui/dialog/dialog.tsx';
import { TextAreaField, TextField } from '../../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../../components/ui/form/form.tsx';
import { Pii } from '../../../../../components/ui/masked.tsx';
import { CountCards, StatusBar } from '../../../../../components/ui/record/record.tsx';
import '../../../../../components/ui/table/table.css';
import { announce } from '../../../../../components/ui/live-region.tsx';
import { useApiMutation, useApiQuery } from '../../../../../lib/api/query.ts';
import { t } from '../../../../../lib/i18n/index.ts';
import { asPrice, asWritten } from '../../../admin/decimal.ts';
import { ConfirmDialog } from '../../../admin/shared.tsx';
import { OverrideConfirm } from '../../override-confirm.tsx';
import { ItemName, SALES_MESSAGES } from '../../shared.tsx';
import { invoiceSteps } from '../../status.ts';
import type { Invoice } from '../shared.ts';

const later = (text: string) => setTimeout(() => announce(text), 0);
const cancelSchema = z.object({ businessDate: dateString(), reason: cancelInvoice.input.shape.reason });
type Dialogs = 'post' | 'cancel' | 'delete' | null;

/** A money figure from a posted line; a draft's are not worked out yet. */
const money = (x: string | null) => (x === null ? '' : formatMoney(x));

function Totals({ i }: { i: Invoice }) {
  const rows: [string, string][] = [
    [t('sales.invoice.taxable'), formatMoney(i.taxable)], [t('sales.invoice.cgst'), formatMoney(i.cgst)],
    [t('sales.invoice.sgst'), formatMoney(i.sgst)], [t('sales.invoice.igst'), formatMoney(i.igst)],
    [t('sales.invoice.cess'), formatMoney(i.cess)], [t('sales.invoice.roundOff'), formatMoney(i.roundOff)],
    [t('sales.invoice.total'), formatMoney(i.total)],
  ];
  return (
    <dl className="admin-facts" aria-label={t('sales.invoice.totals', { number: i.number ?? t('sales.draft') })}>
      {rows.map(([label, value]) => <Fragment key={label}><dt>{label}</dt><dd>{value}</dd></Fragment>)}
    </dl>
  );
}

function Lines({ i }: { i: Invoice }) {
  const captionId = useId();
  return (
    <div className="kit-table">
      <div className="kit-table-scroll" role="region" aria-labelledby={captionId} tabIndex={0}>
        <table>
          <caption id={captionId}>{i.number === null ? t('sales.lines') : t('sales.lines.of', { number: i.number })}</caption>
          <thead>
            <tr>
              <th scope="col">{t('sales.line.item')}</th>
              <th scope="col">{t('sales.invoice.hsn')}</th>
              <th scope="col" className="kit-numeric">{t('sales.line.qty')}</th>
              <th scope="col" className="kit-numeric">{t('sales.line.rate')}</th>
              <th scope="col" className="kit-numeric">{t('sales.line.discount')}</th>
              <th scope="col" className="kit-numeric">{t('sales.invoice.taxable')}</th>
              <th scope="col" className="kit-numeric">{t('sales.invoice.cgst')}</th>
              <th scope="col" className="kit-numeric">{t('sales.invoice.sgst')}</th>
              <th scope="col" className="kit-numeric">{t('sales.invoice.igst')}</th>
              <th scope="col" className="kit-numeric">{t('sales.invoice.lineTotal')}</th>
            </tr>
          </thead>
          <tbody>
            {i.lines.map((l) => (
              <tr key={l.id}>
                <td><ItemName id={l.itemId} /></td>
                <td>{l.hsn ?? ''}</td>
                <td className="kit-numeric">{asWritten(l.qty)}</td>
                <td className="kit-numeric">{asPrice(l.rate)}</td>
                <td className="kit-numeric">{asWritten(l.discountPercent)}</td>
                <td className="kit-numeric">{money(l.taxable)}</td>
                <td className="kit-numeric">{money(l.cgst)}</td>
                <td className="kit-numeric">{money(l.sgst)}</td>
                <td className="kit-numeric">{money(l.igst)}</td>
                <td className="kit-numeric">{money(l.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Address lines as one, each part masked on its own for a person who may not see it. */
function Address({ parts }: { parts: readonly (string | Masked | null)[] }) {
  const shown = parts.filter((p): p is string | Masked => p !== null);
  return shown.length === 0 ? t('admin.items.none') : shown.map((p, n) => <span key={n}>{n > 0 ? ', ' : null}<Pii value={p} /></span>);
}

function Facts({ i }: { i: Invoice }) {
  const { buyer, issuer, shipTo } = i;
  return (
    <dl className="admin-facts" aria-label={t('sales.facts')}>
      <dt>{t('sales.party')}</dt><dd>{i.partyName}</dd>
      <dt>{t('sales.date')}</dt><dd>{formatDate(i.businessDate)}</dd>
      {i.placeOfSupply === null ? null : <><dt>{t('sales.invoice.placeOfSupply')}</dt><dd>{stateName(i.placeOfSupply) ?? i.placeOfSupply}</dd></>}
      <dt>{t('sales.invoice.notes')}</dt><dd>{i.notes ?? t('sales.noNotes')}</dd>
      {buyer === null ? null : (
        <>
          <dt>{t('sales.invoice.buyer')}</dt><dd>{buyer.name}</dd>
          <dt>{t('sales.invoice.buyer.gstin')}</dt><dd>{buyer.gstin ?? t('sales.invoice.unregistered')}</dd>
          <dt>{t('sales.invoice.buyer.address')}</dt>
          <dd><Address parts={[buyer.addressLine1, buyer.addressLine2, buyer.city, buyer.pincode]} /></dd>
        </>
      )}
      {shipTo === null ? null : (
        <><dt>{t('sales.invoice.shipTo')}</dt><dd>{shipTo.name}, <Pii value={shipTo.address} />, {stateName(shipTo.stateCode) ?? shipTo.stateCode}</dd></>
      )}
      {issuer === null ? null : (
        <>
          <dt>{t('sales.invoice.issuer')}</dt>
          <dd>{issuer.legalName}, {issuer.gstin}, {[issuer.addressLine1, issuer.addressLine2, issuer.city, issuer.pincode].filter(Boolean).join(', ')}</dd>
        </>
      )}
    </dl>
  );
}

export default function InvoicePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { permissions } = useMe();
  const mayWrite = permissions.includes('invoices:write');
  const mayCancel = permissions.includes('invoices:cancel');
  const q = useApiQuery(getInvoice, { id });
  const again = [getInvoice, listInvoices];
  const post = useApiMutation(postInvoice, { invalidates: again });
  const override = useApiMutation(requestInvoiceOverride, { invalidates: again });
  const cancel = useApiMutation(cancelInvoice, { invalidates: again });
  // A deleted record is gone: refetching it would be a 404, so only the list is refreshed (the same rule as quotes and orders).
  const remove = useApiMutation(deleteInvoice, { invalidates: [listInvoices] });
  const [dialog, setDialog] = useState<Dialogs>(null);
  const invoice = q.data;

  if (q.error !== null) {
    return (
      <>
        <p><Link href="/sales/invoices">{t('sales.back')}</Link></p>
        <div role="alert" className="kit-form-alert">
          {t('sales.missing')} <button type="button" className="kit-button" onClick={() => void q.refetch()}>{t('error.retry')}</button>
        </div>
      </>
    );
  }
  if (invoice === undefined) return <p>{t('loading')}</p>;
  const open = (which: Exclude<Dialogs, null>) => () => setDialog(which);
  const shut = (isOpen: boolean) => { if (!isOpen) setDialog(null); };
  const worked = invoice.status !== 'draft';

  return (
    <>
      <p><Link href="/sales/invoices">{t('sales.back')}</Link></p>
      <h1>{invoice.number === null ? t('sales.invoice.title.draft') : t('sales.invoice.title', { number: invoice.number })}</h1>
      <StatusBar label={t('sales.status.step')} steps={invoiceSteps(invoice.status)} current={invoice.status} />
      <CountCards label={t('sales.counts')} cards={[
        { label: t('sales.count.lines'), value: String(invoice.lines.length) },
        ...(worked ? [{ label: t('sales.invoice.total'), value: formatMoney(invoice.total) }] : []),
      ]} />
      <Facts i={invoice} />
      <Lines i={invoice} />
      {worked ? <Totals i={invoice} /> : <p>{t('sales.invoice.notPosted')}</p>}
      <div className="kit-actions">
        {mayWrite && invoice.status === 'draft' ? (
          <>
            <Link className="kit-button" href={`/sales/invoices/${id}/edit`}>{t('sales.edit')}</Link>
            <button type="button" className="kit-button kit-button-primary" onClick={open('post')}>{t('sales.invoice.post')}</button>
            <button type="button" className="kit-button" onClick={open('delete')}>{t('sales.delete')}</button>
          </>
        ) : null}
        {mayCancel && invoice.status === 'posted' ? (
          <button type="button" className="kit-button" onClick={open('cancel')}>{t('sales.invoice.cancel')}</button>
        ) : null}
      </div>

      <OverrideConfirm open={dialog === 'post'} onOpenChange={shut} title={t('sales.invoice.post.title')} body={t('sales.invoice.post.body')}
        action={t('sales.invoice.post')} overrideBody={t('sales.invoice.override.body')} overrideAction={t('sales.invoice.override')}
        onConfirm={async () => {
          const done = await post.submit({ id });
          return t('sales.invoice.posted', { number: done.number, total: formatMoney(done.total) });
        }}
        onAskOverride={async () => { await override.submit({ id }); return t('sales.invoice.overridden'); }} />

      <ConfirmDialog open={dialog === 'delete'} onOpenChange={shut} messages={SALES_MESSAGES} title={t('sales.invoice.delete.title')}
        body={t('sales.invoice.delete.body')} action={t('sales.delete')} done={t('sales.invoice.deleted')}
        onConfirm={async () => { await remove.submit({ id }); router.push('/sales/invoices'); }} />

      <Dialog open={dialog === 'cancel'} onOpenChange={shut} title={t('sales.invoice.cancel.title', { number: invoice.number ?? '' })}
        description={t('sales.invoice.cancel.body')}>
        <Form schema={cancelSchema} saved={false} messages={SALES_MESSAGES} defaultValues={{ businessDate: indiaDate(new Date()), reason: '' }}
          onSubmit={async (v) => { await cancel.submit({ id, ...v }); setDialog(null); later(t('sales.invoice.cancelled')); }}>
          <TextField name="businessDate" label={t('sales.invoice.cancel.date')} type="date" />
          <TextAreaField name="reason" label={t('sales.reason')} />
          <div className="kit-actions">
            <CloseButton>{t('sales.cancel')}</CloseButton>
            <SubmitButton>{t('sales.invoice.cancel')}</SubmitButton>
          </div>
        </Form>
      </Dialog>
    </>
  );
}
