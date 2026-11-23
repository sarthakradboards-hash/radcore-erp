'use client';
// One receipt, payment or refund (RAD-126 on RAD-116's read routes), in the record layout: where it stands (the status bar), the
// customer's statement or the receipt a refund pays back (related-record buttons), its figures (the amount, what is applied to bills,
// what is refunded, what is left: all the server's), its facts and where it is applied. With payments:write a posted one is
// cancelled (refused while applied or refunded), a posted receipt with something left is applied to bills or refunded, and an
// application is undone; a posted receipt prints on the roll or A4 with receipts:print. Nothing is worked out here.
import { dec, formatDate, formatMoment, formatMoney } from '@radcore/lib-common';
import { getPaymentContract } from '@radcore/lib-accounts/contract';
import { printReceipt } from '@radcore/lib-sales/contract';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useId, useState } from 'react';
import { useMe } from '../../../../../components/shell/session-provider.tsx';
import { CloseButton, Dialog } from '../../../../../components/ui/dialog/dialog.tsx';
import { CountCards, RelatedRecords, StatusBar } from '../../../../../components/ui/record/record.tsx';
import '../../../../../components/ui/table/table.css';
import { useApiQuery } from '../../../../../lib/api/query.ts';
import { t } from '../../../../../lib/i18n/index.ts';
import { PrintButtons } from '../../../sales/print-buttons.tsx';
import { documentHref, documentWord } from '../../collect/document-href.ts';
import { AllocateForm } from '../allocate-form.tsx';
import { CancelPayment, ReverseApplication, RefundReceipt } from './payment-actions.tsx';

type Dialogs = 'cancel' | 'refund' | 'apply' | null;

/** Where a payment stands: waiting for approval (a draft), posted, or cancelled after it was posted. */
const steps = (status: string) => (status === 'cancelled' ? ['draft', 'posted', 'cancelled'] : ['draft', 'posted'])
  .map((key) => ({ key, label: t(`books.pay.status.${key as 'draft'}`) }));

export default function PaymentPage() {
  const { id } = useParams<{ id: string }>();
  const { permissions } = useMe();
  const mayWrite = permissions.includes('payments:write');
  const q = useApiQuery(getPaymentContract, { id });
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [reversing, setReversing] = useState<string | null>(null);
  const captionId = useId();
  const back = <p><Link href="/accounts/payments">{t('books.pay.rec.back')}</Link></p>;
  if (q.error !== null) {
    return (
      <>
        {back}
        <div role="alert" className="kit-form-alert">
          {t('books.pay.rec.missing')} <button type="button" className="kit-button" onClick={() => void q.refetch()}>{t('error.retry')}</button>
        </div>
      </>
    );
  }
  const p = q.data;
  if (p === undefined) return <>{back}<p>{t('loading')}</p></>;
  const posted = p.status === 'posted';
  const hasLeft = p.kind === 'receipt' && posted && dec(p.left).gt(0);
  const links = [
    // The statement is read with receivables:read: a person without it isn't offered a page that would refuse them.
    ...(p.kind === 'payment' || !permissions.includes('receivables:read') ? [] : [{ label: t('books.pay.rec.statement'), href: `/accounts/collect/${p.partyId}` }]),
    ...(p.refundOf === null ? [] : [{ label: t('books.pay.rec.refundOf'), href: `/accounts/payments/${p.refundOf}` }]),
    ...(p.credit === null ? [] : [{ label: t('books.pay.rec.credit'), href: documentHref(p.credit.table, p.credit.id) ?? '' }].filter((l) => l.href !== '')),
  ];
  const title = p.number === null ? t('books.pay.rec.title.draft', { kind: t(`books.pay.kind.short.${p.kind}`) }) : t('books.pay.rec.title', { kind: t(`books.pay.kind.short.${p.kind}`), number: p.number });
  return (
    <>
      {back}
      <h1>{title}</h1>
      <StatusBar label={t('books.pay.rec.step')} steps={steps(p.status)} current={p.status} />
      {links.length === 0 ? null : <RelatedRecords label={t('books.pay.rec.related')} links={links} />}
      <CountCards label={t('books.pay.rec.counts')} cards={[
        { label: t('books.pay.rec.count.amount'), value: formatMoney(p.amount) },
        { label: t('books.pay.rec.count.allocated'), value: formatMoney(p.allocated) },
        { label: t('books.pay.rec.count.refunded'), value: formatMoney(p.refunded) },
        { label: t('books.pay.rec.count.left'), value: formatMoney(p.left) },
      ]} />
      <dl className="admin-facts" aria-label={t('books.pay.rec.facts')}>
        <dt>{t('books.pay.rec.party')}</dt><dd>{p.partyName}</dd>
        <dt>{t('books.pay.rec.date')}</dt><dd>{formatDate(p.businessDate)}</dd>
        <dt>{t('books.pay.rec.recorded')}</dt><dd>{formatMoment(p.recordedAt)}</dd>
        <dt>{t('books.pay.rec.tds')}</dt><dd>{formatMoney(p.tds)}</dd>
        <dt>{t('books.pay.rec.account')}</dt><dd>{p.accountName}</dd>
        <dt>{t('books.pay.rec.reference')}</dt><dd>{p.reference ?? t('books.pay.rec.none')}</dd>
        <dt>{t('books.pay.rec.narration')}</dt><dd>{p.narration ?? t('books.pay.rec.none')}</dd>
        {p.cancelReason === null ? null : <><dt>{t('books.pay.rec.cancelReason')}</dt><dd>{p.cancelReason}</dd></>}
      </dl>

      <section aria-labelledby={captionId}>
        <h2 id={captionId}>{t('books.pay.alloc.title')}</h2>
        {p.allocations.length === 0 ? <p>{t('books.pay.alloc.none')}</p> : (
          <div className="kit-table">
            <div className="kit-table-scroll" role="region" aria-labelledby={captionId} tabIndex={0}>
              <table>
                <thead>
                  <tr>
                    <th scope="col">{t('books.pay.alloc.col.document')}</th>
                    <th scope="col" className="kit-numeric">{t('books.pay.alloc.col.amount')}</th>
                    <th scope="col">{t('books.pay.alloc.col.date')}</th>
                    {mayWrite && posted ? <th scope="col">{t('books.pay.alloc.col.action')}</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {p.allocations.map((a) => {
                    const href = documentHref(a.documentTable, a.documentId);
                    const doc = documentWord(a.documentTable);
                    return (
                      <tr key={a.id}>
                        <td>{href === null ? doc : <Link href={href}>{doc}</Link>}</td>
                        <td className="kit-numeric">{formatMoney(a.amount)}</td>
                        <td>{formatDate(a.businessDate)}</td>
                        {mayWrite && posted ? (
                          <td>
                            <button type="button" className="kit-button" aria-label={t('books.pay.alloc.reverse.for', { amount: formatMoney(a.amount), document: doc })}
                              onClick={() => setReversing(a.id)}>{t('books.pay.alloc.reverse')}</button>
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      <div className="kit-actions">
        {p.kind === 'receipt' && posted ? <PrintButtons contract={printReceipt} id={id} /> : null}
        {mayWrite && hasLeft ? <button type="button" className="kit-button" onClick={() => setDialog('apply')}>{t('books.pay.apply')}</button> : null}
        {mayWrite && hasLeft ? <button type="button" className="kit-button" onClick={() => setDialog('refund')}>{t('books.pay.refund')}</button> : null}
        {mayWrite && posted ? <button type="button" className="kit-button" onClick={() => setDialog('cancel')}>{t('books.pay.cancel')}</button> : null}
      </div>

      {dialog === 'cancel' ? <CancelPayment id={id} onClose={() => setDialog(null)} /> : null}
      {dialog === 'refund' && p.number !== null ? <RefundReceipt receipt={{ id, number: p.number, partyId: p.partyId }} onClose={() => setDialog(null)} /> : null}
      {dialog === 'apply' ? (
        <Dialog open onOpenChange={(open) => { if (!open) setDialog(null); }} title={t('books.pay.allocate.title')} description={t('books.pay.allocate.intro')}>
          <AllocateForm paymentId={id} partyId={p.partyId} amount={p.left} onDone={() => setDialog(null)} />
          <div className="kit-actions"><CloseButton>{t('books.pay.close')}</CloseButton></div>
        </Dialog>
      ) : null}
      {reversing === null ? null : <ReverseApplication allocationId={reversing} onClose={() => setReversing(null)} />}
    </>
  );
}
