'use client';
// Record a payment (RAD-126 on RAD-116's routes): a receipt from a customer or a payment to a supplier. A posted receipt can then be
// applied to the customer's open bills. payments:write (which needs the second factor). The payments list and a payment's own page wait
// for the list and get routes; refunds, which name a receipt, wait with them.
import { formatMoney } from '@radcore/lib-common';
import { recordPaymentContract } from '@radcore/lib-accounts/contract';
import { useState } from 'react';
import type { z } from 'zod';
import { useMe } from '../../../../../components/shell/session-provider.tsx';
import { announce } from '../../../../../components/ui/live-region.tsx';
import { useApiMutation } from '../../../../../lib/api/query.ts';
import { t } from '../../../../../lib/i18n/index.ts';
import { AllocateForm } from '../allocate-form.tsx';
import { PaymentForm } from '../payment-form.tsx';
import { NEW_PAYMENT, type PaymentValues } from '../payment-values.ts';

type Recorded = z.output<typeof recordPaymentContract.output> & Pick<PaymentValues, 'kind' | 'partyId' | 'amount'>;

export default function NewPaymentPage() {
  const mayWrite = useMe().permissions.includes('payments:write');
  const record = useApiMutation(recordPaymentContract);
  const [done, setDone] = useState<Recorded | null>(null);
  const [applied, setApplied] = useState<number | null>(null);
  // Starting another remounts the form, so nothing of the last one stays in it.
  const [round, setRound] = useState(0);
  if (!mayWrite) return <><h1>{t('books.pay.title')}</h1><p role="alert" className="kit-form-alert">{t('books.pay.err.noWrite')}</p></>;
  return (
    <>
      <h1 id="record-payment">{t('books.pay.title')}</h1>
      <p>{t('books.pay.intro')}</p>
      {done === null ? (
        <PaymentForm key={round} labelledBy="record-payment" initial={NEW_PAYMENT}
          onSubmit={async (v) => {
            const result = await record.submit(v);
            setDone({ ...result, kind: v.kind, partyId: v.partyId, amount: v.amount });
            setTimeout(() => announce(result.status === 'posted' ? t('books.pay.done.posted', { kind: t(`books.pay.done.kind.${v.kind}`), number: result.number ?? '' }) : t('books.pay.done.waiting', { kind: t(`books.pay.done.kind.${v.kind}`) })), 0);
          }} />
      ) : (
        <section aria-labelledby="payment-done">
          <h2 id="payment-done">{t(`books.pay.done.kind.${done.kind}`)} {done.number ?? ''}</h2>
          <p>{done.status === 'posted' ? t('books.pay.done.posted', { kind: t(`books.pay.done.kind.${done.kind}`), number: done.number ?? '' }) : t('books.pay.done.waiting', { kind: t(`books.pay.done.kind.${done.kind}`) })}</p>
          <p>{formatMoney(done.amount)}</p>
          {done.kind === 'receipt' && done.status === 'posted' && applied === null ? (
            <section aria-labelledby="payment-apply">
              <h3 id="payment-apply">{t('books.pay.allocate.title')}</h3>
              <p>{t('books.pay.allocate.intro')}</p>
              <AllocateForm paymentId={done.id} partyId={done.partyId} amount={done.amount} onDone={setApplied} />
            </section>
          ) : null}
          {applied === null ? null : <p role="status">{t('books.pay.allocate.done', { n: String(applied) })}</p>}
          <div className="kit-actions">
            <button type="button" className="kit-button kit-button-primary" onClick={() => { setDone(null); setApplied(null); setRound((n) => n + 1); }}>{t('books.pay.done.next')}</button>
          </div>
        </section>
      )}
    </>
  );
}
