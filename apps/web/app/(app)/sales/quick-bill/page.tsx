'use client';
// The counter quick bill (RAD-124 on RAD-115's contract): a sale in one save. It needs sales:write, deliveries:write and invoices:write
// (the server names any that is missing); the screen checks the three and says which are not held. When it is saved the page
// shows what the server worked out: the invoice, the total, what was paid and what is left unpaid, and the receipts.
import { formatMoney } from '@radcore/lib-common';
import { createQuickBill, listInvoices } from '@radcore/lib-sales/contract';
import Link from 'next/link';
import { useState } from 'react';
import type { z } from 'zod';
import { useMe } from '../../../../components/shell/session-provider.tsx';
import { announce } from '../../../../components/ui/live-region.tsx';
import { useApiMutation } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { QuickBillForm } from './quick-bill-form.tsx';
import { NEW_QUICK_BILL } from './quick-bill-values.ts';

const NEEDS = ['sales:write', 'deliveries:write', 'invoices:write'] as const;
type Sold = z.output<typeof createQuickBill.output>;

export default function QuickBillPage() {
  const { permissions } = useMe();
  const save = useApiMutation(createQuickBill, { invalidates: [listInvoices] });
  const [done, setDone] = useState<Sold | null>(null);
  // Starting another bill remounts the form, so nothing of the last one stays in it.
  const [round, setRound] = useState(0);
  const missing = NEEDS.filter((k) => !permissions.includes(k));
  if (missing.length > 0) {
    return <><h1>{t('sales.quick.title')}</h1><p role="alert" className="kit-form-alert">{t('sales.quick.err.forbidden', { keys: missing.join(', ') })}</p></>;
  }
  return (
    <>
      <h1 id="quick-bill">{t('sales.quick.title')}</h1>
      <p>{t('sales.quick.intro')}</p>
      {done === null ? (
        <QuickBillForm key={round} labelledBy="quick-bill" initial={NEW_QUICK_BILL}
          onSubmit={async (v) => {
            const sold = await save.submit(v);
            setDone(sold);
            setTimeout(() => announce(t('sales.quick.saved', { number: sold.invoice.number })), 0);
          }} />
      ) : (
        <section aria-labelledby="quick-done">
          <h2 id="quick-done">{t('sales.quick.done.title', { number: done.invoice.number })}</h2>
          <dl className="admin-facts">
            <dt>{t('sales.quick.done.total')}</dt><dd>{formatMoney(done.total)}</dd>
            <dt>{t('sales.quick.done.paid')}</dt><dd>{formatMoney(done.paid)}</dd>
            <dt>{t('sales.quick.done.left')}</dt><dd>{formatMoney(done.left)}</dd>
            <dt>{t('sales.quick.done.receipts')}</dt><dd>{done.receipts.map((r) => r.number).join(', ')}</dd>
          </dl>
          <div className="kit-actions">
            <Link className="kit-button" href={`/sales/invoices/${done.invoice.id}`}>{t('sales.quick.done.invoice')}</Link>
            <Link className="kit-button" href={`/sales/deliveries/${done.delivery.id}`}>{t('sales.quick.done.delivery')}</Link>
            <button type="button" className="kit-button kit-button-primary" onClick={() => { setDone(null); setRound((n) => n + 1); }}>{t('sales.quick.done.next')}</button>
          </div>
        </section>
      )}
    </>
  );
}
