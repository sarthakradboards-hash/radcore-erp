'use client';
// The held quick bills (RAD-124's hold and recall, on RAD-115's contracts): bills held for an approval, oldest first, each with its
// customer, its items, its planned payments, where its approval stands and who held it. An approved one is completed: its planned
// payments are taken (each card with its approval code from the machine), then the order, its delivery and its invoice go through on
// the approval. One that is not going ahead is discarded, which is deleting its draft order and takes the hold with it. Whether the
// approval still fits (the balance moved) and whether the bill is still held are the server's to say; the screen words the refusals.
import { formatMoment, formatMoney, indiaDate, looksLikeCardNumber } from '@radcore/lib-common';
import { completeQuickBill, deleteOrder, listHeldQuickBills } from '@radcore/lib-sales/contract';
import { useState } from 'react';
import { z } from 'zod';
import { useMe } from '../../../../components/shell/session-provider.tsx';
import { CloseButton, Dialog } from '../../../../components/ui/dialog/dialog.tsx';
import { TextField } from '../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../components/ui/form/form.tsx';
import { DataTable, type Column } from '../../../../components/ui/table/data-table.tsx';
import { useApiList, useApiMutation } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { ConfirmDialog } from '../../admin/shared.tsx';
import type { Sold } from './quick-bill-done.tsx';
import { QUICK_BILL_MESSAGES } from './shared.ts';

type Held = z.output<typeof listHeldQuickBills.output>['items'][number];

const MESSAGES: Partial<Record<string, string>> = {
  ...QUICK_BILL_MESSAGES, version_changed: t('sales.held.err.version_changed'), not_held: t('sales.held.err.not_held'),
};

/** The planned payments as one line: "Cash 500.00, Card 200.00". */
const planned = (h: Held) => (h.payments.length === 0 ? t('sales.held.payments.none')
  : h.payments.map((p) => t('sales.held.payment', { method: t(`sales.held.method.${p.method}`), amount: formatMoney(p.amount) })).join(', '));

/** The dialog that completes an approved held bill: a date, and the machine's approval code for each planned card payment, in order. */
function Complete({ held, onClose, onDone }: { held: Held; onClose: () => void; onDone: (sold: Sold) => void }) {
  const complete = useApiMutation(completeQuickBill, { invalidates: [listHeldQuickBills] });
  const cards = held.payments.filter((p) => p.method === 'card');
  const schema = z.object({
    businessDate: z.string().min(1),
    codes: z.array(z.string().trim().min(1, t('sales.quick.err.approval')).refine((c) => !looksLikeCardNumber(c), t('sales.quick.err.card.digits'))),
  });
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }} title={t('sales.held.complete.title', { party: held.partyName })} description={t('sales.held.complete.body')}>
      <Form schema={schema} saved={false} messages={MESSAGES} defaultValues={{ businessDate: indiaDate(new Date()), codes: cards.map(() => '') }}
        onSubmit={async (v) => {
          const sold = await complete.submit({ orderId: held.orderId, businessDate: v.businessDate, approvalCodes: v.codes });
          onClose();
          onDone(sold);
        }}>
        <TextField name="businessDate" label={t('sales.held.complete.date')} type="date" />
        {cards.map((_, i) => <TextField key={i} name={`codes.${i}`} label={t('sales.held.complete.code', { n: String(i + 1) })} autoComplete="off" />)}
        <div className="kit-actions">
          <CloseButton>{t('sales.cancel')}</CloseButton>
          <SubmitButton>{t('sales.held.complete.save')}</SubmitButton>
        </div>
      </Form>
    </Dialog>
  );
}

export function HeldBills({ onCompleted }: { onCompleted: (sold: Sold) => void }) {
  const { permissions } = useMe();
  const mayDiscard = permissions.includes('sales:write');
  const list = useApiList(listHeldQuickBills, { filter: {} });
  const discard = useApiMutation(deleteOrder, { invalidates: [listHeldQuickBills] });
  const [completing, setCompleting] = useState<Held | null>(null);
  const [discarding, setDiscarding] = useState<Held | null>(null);
  const columns: Column<Held>[] = [
    { id: 'party', header: t('sales.held.col.party'), cell: (h) => h.partyName },
    { id: 'items', header: t('sales.held.col.items'), cell: (h) => String(h.items) },
    { id: 'payments', header: t('sales.held.col.payments'), cell: planned },
    { id: 'approval', header: t('sales.held.col.approval'), cell: (h) => t(`sales.held.approval.${h.approval}`) },
    { id: 'by', header: t('sales.held.col.by'), cell: (h) => t('sales.held.by', { name: h.heldBy.displayName ?? '', when: formatMoment(h.heldAt) }) },
    { id: 'action', header: t('sales.held.col.action'), cell: (h) => (
      <>
        {h.approval === 'approved' ? (
          <button type="button" className="kit-button kit-button-primary" aria-label={t('sales.held.complete.for', { party: h.partyName })}
            onClick={() => setCompleting(h)}>{t('sales.held.complete')}</button>
        ) : null}
        {mayDiscard ? (
          <button type="button" className="kit-button" aria-label={t('sales.held.discard.for', { party: h.partyName })}
            onClick={() => setDiscarding(h)}>{t('sales.held.discard')}</button>
        ) : null}
      </>
    ) },
  ];
  return (
    <section aria-labelledby="held-title">
      <h2 id="held-title">{t('sales.held.title')}</h2>
      <p>{t('sales.held.intro')}</p>
      <DataTable caption={t('sales.held.title')} columns={columns} rowKey={(h) => h.orderId} list={list} empty={t('sales.held.empty')} />
      {completing === null ? null : <Complete held={completing} onClose={() => setCompleting(null)} onDone={onCompleted} />}
      <ConfirmDialog open={discarding !== null} onOpenChange={(open) => { if (!open) setDiscarding(null); }} messages={MESSAGES}
        title={t('sales.held.discard.title', { party: discarding?.partyName ?? '' })} body={t('sales.held.discard.body')} action={t('sales.held.discard')}
        done={t('sales.held.discarded')}
        onConfirm={async () => { if (discarding !== null) await discard.submit({ id: discarding.orderId }); }} />
    </section>
  );
}

