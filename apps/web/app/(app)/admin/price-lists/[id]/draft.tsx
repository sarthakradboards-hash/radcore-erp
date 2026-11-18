'use client';
// A price list's draft (RAD-99 on RAD-98's contracts). prices:write prices an item, changes or takes out a rate, says
// whether the rates include GST, and sends the draft for approval; none of it prices anything until someone else
// approves the draft as sent (RAD-38). Everyone who reads prices sees what the draft changes against the prices in force.
import { unitPriceString } from '@radcore/lib-common';
import {
  getPriceListChanges, getPriceListVersion, listPriceListRates, putPriceListRates, requestPriceListApproval, setPriceListTax,
} from '@radcore/lib-sales/contract';
import { listItems } from '@radcore/lib-stock/contract';
import { useState } from 'react';
import { z } from 'zod';
import { useMe } from '../../../../../components/shell/session-provider.tsx';
import { CloseButton, Dialog } from '../../../../../components/ui/dialog/dialog.tsx';
import { Menu } from '../../../../../components/ui/dialog/menu.tsx';
import { CheckboxField, TextField } from '../../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../../components/ui/form/form.tsx';
import { announce } from '../../../../../components/ui/live-region.tsx';
import { Picker } from '../../../../../components/ui/picker/picker.tsx';
import { DataTable, type Column } from '../../../../../components/ui/table/data-table.tsx';
import { useApiList, useApiMutation, useApiQuery, useApiSearch } from '../../../../../lib/api/query.ts';
import { t } from '../../../../../lib/i18n/index.ts';
import { ConfirmDialog, MESSAGES } from '../../shared.tsx';
import type { PriceRate, StockItem } from '../../types.ts';
import { PriceChanges } from '../changes.tsx';

const later = (text: string) => setTimeout(() => announce(text), 0);
const rateSchema = z.object({ rate: unitPriceString() });
const taxSchema = setPriceListTax.input.pick({ taxInclusive: true });
const DRAFT_MESSAGES = { ...MESSAGES, not_a_draft: t('admin.prices.err.not_a_draft'), unknown_item: t('admin.prices.err.unknown_item') };

/** A version's rates by item: the list's own page shows the ones in force with these, and the draft's. */
export const rateColumns: Column<PriceRate>[] = [
  { id: 'sku', header: t('admin.items.sku'), cell: (r) => r.sku },
  { id: 'name', header: t('admin.items.name'), cell: (r) => r.name },
  { id: 'unit', header: t('admin.items.unit'), cell: (r) => r.unit },
  { id: 'rate', header: t('admin.prices.rate'), numeric: true, cell: (r) => r.rate },
];

/** Prices an item in the draft: the kit's Picker over active items, then its rate. */
function AddRate({ onAdd }: { onAdd: (item: StockItem, rate: string) => Promise<unknown> }) {
  const [query, setQuery] = useState('');
  const [item, setItem] = useState<StockItem | null>(null);
  const found = useApiSearch(listItems, query, { params: { filter: { active: true } } });
  return (
    <section aria-labelledby="add-rate">
      <h3 id="add-rate">{t('admin.prices.addRate')}</h3>
      <Picker label={t('admin.prices.item')} hint={t('admin.prices.item.hint')} query={query} onQueryChange={setQuery}
        options={found.items} loading={found.isFetching} error={found.error} value={item} onChange={setItem}
        optionKey={(i) => i.id} optionLabel={(i) => i.name} optionDetail={(i) => i.sku} />
      {item === null ? null : (
        <Form key={item.id} aria-labelledby="add-rate" schema={rateSchema} defaultValues={{ rate: '' }} saved={false}
          messages={DRAFT_MESSAGES}
          onSubmit={async ({ rate }) => {
            await onAdd(item, rate);
            setItem(null);
            setQuery('');
            later(t('admin.prices.rateSet', { name: item.name }));
          }}>
          <TextField name="rate" label={t('admin.prices.rateFor', { name: item.name })} inputMode="decimal" autoComplete="off" />
          <SubmitButton>{t('admin.prices.setRate')}</SubmitButton>
        </Form>
      )}
    </section>
  );
}

type Acting = { kind: 'change' | 'out'; rate: PriceRate } | { kind: 'send' };

export function Draft({ draftId, name }: { draftId: string; name: string }) {
  const mayWrite = useMe().permissions.includes('prices:write');
  const version = useApiQuery(getPriceListVersion, { id: draftId });
  const rates = useApiList(listPriceListRates, { id: draftId, filter: {} });
  const put = useApiMutation(putPriceListRates, { invalidates: [listPriceListRates, getPriceListChanges] });
  const tax = useApiMutation(setPriceListTax, { invalidates: [getPriceListVersion, getPriceListChanges] });
  const send = useApiMutation(requestPriceListApproval);
  const [acting, setActing] = useState<Acting | null>(null);
  const close = (open: boolean) => { if (!open) setActing(null); };
  const setRate = (itemId: string, rate: string | null) => put.submit({ id: draftId, rates: [{ itemId, rate }] });
  const target = acting !== null && acting.kind !== 'send' ? acting.rate : undefined;

  const columns: Column<PriceRate>[] = mayWrite ? [...rateColumns, {
    id: 'actions', header: t('admin.users.col.actions'),
    cell: (r) => <Menu label={t('admin.prices.rateActionsFor', { name: r.name })} items={[
      { label: t('admin.prices.change'), onSelect: () => setActing({ kind: 'change', rate: r }) },
      { label: t('admin.prices.takeOut'), onSelect: () => setActing({ kind: 'out', rate: r }) },
    ]} />,
  }] : rateColumns;

  return (
    <>
      <p>{t('admin.prices.draft.intro')}</p>
      {mayWrite && version.data !== undefined ? (
        <Form aria-labelledby="draft" schema={taxSchema} messages={DRAFT_MESSAGES}
          defaultValues={{ taxInclusive: version.data.taxInclusive }}
          onSubmit={({ taxInclusive }) => tax.submit({ id: draftId, taxInclusive })}>
          <CheckboxField name="taxInclusive" label={t('admin.prices.taxInclusive')} hint={t('admin.prices.taxInclusive.hint')} />
          <SubmitButton>{t('admin.prices.tax.save')}</SubmitButton>
        </Form>
      ) : null}
      {mayWrite ? <AddRate onAdd={(item, rate) => setRate(item.id, rate)} /> : null}
      <DataTable caption={t('admin.prices.rates.draft', { name })} columns={columns} rowKey={(r) => r.itemId} list={rates}
        empty={t('admin.prices.rates.empty')} />

      <h3>{t('admin.prices.changes.heading')}</h3>
      <PriceChanges versionId={draftId} />
      {mayWrite ? (
        <button type="button" className="kit-button kit-button-primary" onClick={() => setActing({ kind: 'send' })}>
          {t('admin.prices.send')}
        </button>
      ) : null}

      <Dialog open={acting?.kind === 'change'} onOpenChange={close} title={t('admin.prices.change.title', { name: target?.name ?? '' })}>
        {target === undefined ? null : (
          <Form schema={rateSchema} saved={false} messages={DRAFT_MESSAGES} defaultValues={{ rate: target.rate }}
            onSubmit={async ({ rate }) => {
              await setRate(target.itemId, rate);
              setActing(null);
              later(t('admin.prices.rateSet', { name: target.name }));
            }}>
            <TextField name="rate" label={t('admin.prices.rateFor', { name: target.name })} inputMode="decimal" autoComplete="off" />
            <div className="kit-actions">
              <CloseButton>{t('admin.cancel')}</CloseButton>
              <SubmitButton>{t('admin.prices.setRate')}</SubmitButton>
            </div>
          </Form>
        )}
      </Dialog>
      <ConfirmDialog open={acting?.kind === 'out'} onOpenChange={close} messages={DRAFT_MESSAGES}
        title={t('admin.prices.takeOut.title', { name: target?.name ?? '' })} body={t('admin.prices.takeOut.body')}
        action={t('admin.prices.takeOut')} done={t('admin.prices.takenOut', { name: target?.name ?? '' })}
        onConfirm={async () => { if (target !== undefined) await setRate(target.itemId, null); }} />
      <ConfirmDialog open={acting?.kind === 'send'} onOpenChange={close} messages={DRAFT_MESSAGES}
        title={t('admin.prices.send.title', { name })} body={t('admin.prices.send.body')} action={t('admin.prices.send')}
        done={t('admin.prices.sent', { name })} onConfirm={async () => { await send.submit({ id: draftId }); }} />
    </>
  );
}
