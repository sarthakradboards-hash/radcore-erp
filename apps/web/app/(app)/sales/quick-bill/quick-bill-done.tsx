'use client';
// A saved or completed quick bill (RAD-124): what the server worked out (the invoice, the total, what was paid and what is left
// unpaid, the receipts), links to the invoice and the delivery, and the way to the next bill. (The one-tap print on the 80 mm roll
// comes with the print buttons.) Nothing is worked out here.
import { formatMoney } from '@radcore/lib-common';
import type { createQuickBill } from '@radcore/lib-sales/contract';
import Link from 'next/link';
import type { z } from 'zod';
import { t } from '../../../../lib/i18n/index.ts';

export type Sold = z.output<typeof createQuickBill.output>;

export function QuickBillDone({ sold, onNext }: { sold: Sold; onNext: () => void }) {
  return (
    <section aria-labelledby="quick-done">
      <h2 id="quick-done">{t('sales.quick.done.title', { number: sold.invoice.number })}</h2>
      <dl className="admin-facts">
        <dt>{t('sales.quick.done.total')}</dt><dd>{formatMoney(sold.total)}</dd>
        <dt>{t('sales.quick.done.paid')}</dt><dd>{formatMoney(sold.paid)}</dd>
        <dt>{t('sales.quick.done.left')}</dt><dd>{formatMoney(sold.left)}</dd>
        <dt>{t('sales.quick.done.receipts')}</dt><dd>{sold.receipts.map((r) => r.number).join(', ')}</dd>
      </dl>
      <div className="kit-actions">
        <Link className="kit-button" href={`/sales/invoices/${sold.invoice.id}`}>{t('sales.quick.done.invoice')}</Link>
        <Link className="kit-button" href={`/sales/deliveries/${sold.delivery.id}`}>{t('sales.quick.done.delivery')}</Link>
        <button type="button" className="kit-button kit-button-primary" onClick={onNext}>{t('sales.quick.done.next')}</button>
      </div>
    </section>
  );
}
