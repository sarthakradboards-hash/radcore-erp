'use client';
// The counter quick bill (RAD-124 on RAD-115's contracts): a sale in one save, or held for an approval and completed once it is
// given. It needs sales:write, deliveries:write and invoices:write (the server names any that is missing); the screen checks the three
// and says which are not held. While the bill is made up the server's preview shows its total, what the payments leave and which
// checks need an approval; once more right before the save, and if the total moved since the cashier looked, the save waits for them to
// look again. A bill a check refuses (needs_override) can be held; held bills are listed below to complete or discard. When a bill is
// saved or completed the page shows what the server worked out.
import { holdQuickBill, createQuickBill, listHeldQuickBills, listInvoices, previewQuickBill } from '@radcore/lib-sales/contract';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { useMe } from '../../../../components/shell/session-provider.tsx';
import { announce } from '../../../../components/ui/live-region.tsx';
import { ApiError, callContract } from '../../../../lib/api-client.ts';
import { keyOf, useApiMutation } from '../../../../lib/api/query.ts';
import { dec, formatMoney } from '@radcore/lib-common';
import { t } from '../../../../lib/i18n/index.ts';
import { HeldBills } from './held-bills.tsx';
import { QuickBillDone, type Sold } from './quick-bill-done.tsx';
import { QuickBillForm } from './quick-bill-form.tsx';
import { NEW_QUICK_BILL, type Refusal } from './quick-bill-values.ts';

const NEEDS = ['sales:write', 'deliveries:write', 'invoices:write'] as const;
type Figures = { total: string; left: string; issues: readonly string[] };

export default function QuickBillPage() {
  const { permissions } = useMe();
  const client = useQueryClient();
  const save = useApiMutation(createQuickBill, { invalidates: [listInvoices] });
  const hold = useApiMutation(holdQuickBill, { invalidates: [listHeldQuickBills] });
  const [done, setDone] = useState<Sold | null>(null);
  // Starting another bill remounts the form, so nothing of the last one stays in it.
  const [round, setRound] = useState(0);
  const [refused, setRefused] = useState<Refusal>(null);
  const [figures, setFigures] = useState<Figures | null>(null);
  const [moved, setMoved] = useState<string | null>(null);
  const [heldNote, setHeldNote] = useState(false);
  const onFigures = useCallback((f: Figures | null) => setFigures(f), []);
  const next = () => { setDone(null); setRefused(null); setFigures(null); setMoved(null); setHeldNote(false); setRound((n) => n + 1); };
  const missing = NEEDS.filter((k) => !permissions.includes(k));
  if (missing.length > 0) {
    return <><h1>{t('sales.quick.title')}</h1><p role="alert" className="kit-form-alert">{t('sales.quick.err.forbidden', { keys: missing.join(', ') })}</p></>;
  }
  const completed = (sold: Sold) => { setDone(sold); setTimeout(() => announce(t('sales.quick.saved', { number: sold.invoice.number })), 0); };
  return (
    <>
      <h1 id="quick-bill">{t('sales.quick.title')}</h1>
      <p>{t('sales.quick.intro')}</p>
      {done === null ? (
        <>
          {heldNote ? <p role="status" className="admin-notice">{t('sales.quick.held')}</p> : null}
          {moved === null ? null : <p role="alert" className="kit-form-alert">{t('sales.quick.preview.moved', { total: formatMoney(moved) })}</p>}
          <QuickBillForm key={round} labelledBy="quick-bill" initial={NEW_QUICK_BILL} refused={refused} figures={figures} onFigures={onFigures}
            onSubmit={async (v) => {
              setMoved(null);
              if (v.mode === 'hold') {
                await hold.submit({ ...v.bill, ...(v.buyer === undefined ? {} : { buyer: v.buyer }) });
                next();
                setHeldNote(true);
                setTimeout(() => announce(t('sales.quick.held')), 0);
                return;
              }
              // Once more before the save: if the total is not what the cashier was looking at, they look again first.
              const fresh = await callContract(previewQuickBill, v.bill, { idempotencyKey: crypto.randomUUID() });
              if (figures !== null && !dec(fresh.total).eq(figures.total)) {
                setFigures({ total: fresh.total, left: fresh.left, issues: fresh.issues });
                setMoved(fresh.total);
                // The figures on screen are the old ones until the preview is read again.
                await client.invalidateQueries({ queryKey: keyOf(previewQuickBill) });
                return;
              }
              try {
                completed(await save.submit(v.bill));
              } catch (e) {
                if (e instanceof ApiError && e.code === 'needs_override') setRefused('override');
                if (e instanceof ApiError && e.code === 'walk_in_pays_in_full') setRefused('walk_in');
                throw e;
              }
            }} />
        </>
      ) : <QuickBillDone sold={done} onNext={next} />}
      <HeldBills onCompleted={completed} />
    </>
  );
}
