'use client';
// A new stock transfer (RAD-144 on RAD-141's contracts): from one place to another, with a reason, its goods picked from what's
// on hand at the place they leave, by batch and serial, with the delivery form's picker (ui-2's StockPick reads the place as
// `locationId`, so the form keeps the source under that name and sends it as `fromId`). It posts at once and takes its
// number; one into a franchisee's place, while that needs approval, is kept and sent for approval instead. The server
// refuses the same place twice, rejects to a sellable place (QC's), and job work places (a challan's).
import { indiaDate } from '@radcore/lib-common';
import { createStockTransfer, getItem, listItems, listStockTransfers, stockTransferApproval } from '@radcore/lib-stock/contract';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFieldArray, useFormContext, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { SelectField, TextAreaField, TextField } from '../../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../../components/ui/form/form.tsx';
import { announce } from '../../../../../components/ui/live-region.tsx';
import { useApiMutation, useApiQuery, useApiSearch } from '../../../../../lib/api/query.ts';
import { t } from '../../../../../lib/i18n/index.ts';
import { StockPick } from '../../../sales/deliveries/stock-pick.tsx';
import { PickedField } from '../../../sales/picked-field.tsx';
import { STOCK_MESSAGES, usePlaces } from '../../shared.tsx';

const shape = createStockTransfer.input.shape;
const line = z.object({ itemId: z.string().min(1, t('stock.line.pick')), qty: z.string(), pick: z.record(z.string(), z.string()), serials: z.array(z.string()) })
  .transform((l, ctx) => {
    const batches = Object.entries(l.pick).filter(([, qty]) => qty.trim() !== '').map(([key, qty]) => ({ batchId: key === 'unknown' ? null : key, qty: qty.trim() }));
    if (batches.length === 0) {
      ctx.addIssue({ code: 'custom', message: t('stock.adjustment.err.pick'), path: ['qty'] });
      return z.NEVER;
    }
    return { itemId: l.itemId, qty: l.qty.trim(), batches, serials: l.serials };
  }).pipe(shape.lines.element);
const transferSchema = z.object({
  locationId: z.string().min(1, t('stock.transfer.from.pick')).pipe(shape.fromId),
  toId: z.string().min(1, t('stock.transfer.to.pick')).pipe(shape.toId),
  businessDate: shape.businessDate, reason: shape.reason,
  lines: z.array(line).min(1, t('stock.lines.min')).max(200, t('stock.lines.max')),
});
type TransferInput = z.input<typeof transferSchema>;
const blankLine = (itemId = ''): TransferInput['lines'][number] => ({ itemId, qty: '', pick: {}, serials: [] });

const useItems = (query: string) => useApiSearch(listItems, query, { params: { filter: { active: true } } });

function LineFields({ index, onSplit }: { index: number; onSplit: () => void }) {
  const { control } = useFormContext<TransferInput>();
  const itemId = useWatch({ control, name: `lines.${index}.itemId` });
  const from = useWatch({ control, name: 'locationId' });
  const item = useApiQuery(getItem, { id: itemId }, { enabled: itemId !== '' }).data ?? null;
  return (
    <>
      <PickedField name={`lines.${index}.itemId`} label={t('stock.line.item')} hint={t('stock.line.item.hint')} initial={item}
        useSearch={useItems} optionLabel={(i) => i.name} optionDetail={(i) => i.sku} />
      <TextField name={`lines.${index}.qty`} label={t('stock.transfer.qty')} inputMode="decimal" autoComplete="off" />
      {itemId === '' ? null : from === '' ? <p>{t('stock.transfer.pickFrom')}</p> : <StockPick index={index} itemId={itemId} onSplit={onSplit} />}
    </>
  );
}

function Lines() {
  const { control, getValues } = useFormContext<TransferInput>();
  const { fields, append, remove } = useFieldArray({ control, name: 'lines' });
  return (
    <>
      {fields.map((f, i) => (
        <fieldset key={f.id}>
          <legend>{t('stock.line', { n: String(i + 1) })}</legend>
          <LineFields index={i} onSplit={() => append(blankLine(getValues(`lines.${i}.itemId`)))} />
          {fields.length > 1 ? <button type="button" className="kit-button" onClick={() => remove(i)}>{t('stock.line.remove', { n: String(i + 1) })}</button> : null}
        </fieldset>
      ))}
      {fields.length < 200 ? <button type="button" className="kit-button" onClick={() => append(blankLine())}>{t('stock.line.add')}</button> : null}
    </>
  );
}

function Places() {
  const { control } = useFormContext<TransferInput>();
  const from = useWatch({ control, name: 'locationId' });
  const to = useWatch({ control, name: 'toId' });
  const fromOptions = usePlaces(from);
  const toOptions = usePlaces(to);
  return (
    <>
      <SelectField name="locationId" label={t('stock.transfer.from')} placeholder={t('stock.transfer.from.pick')} options={fromOptions} />
      <SelectField name="toId" label={t('stock.transfer.to')} placeholder={t('stock.transfer.to.pick')} options={toOptions} />
    </>
  );
}

export default function NewStockTransferPage() {
  const router = useRouter();
  const create = useApiMutation(createStockTransfer, { invalidates: [listStockTransfers, stockTransferApproval.listPending] });
  return (
    <>
      <p><Link href="/stock/transfers">{t('stock.transfer.back')}</Link></p>
      <h1 id="new-transfer">{t('stock.transfer.new.title')}</h1>
      <Form aria-labelledby="new-transfer" schema={transferSchema} saved={false} messages={STOCK_MESSAGES}
        defaultValues={{ locationId: '', toId: '', businessDate: indiaDate(new Date()), reason: '', lines: [blankLine()] }}
        onSubmit={async ({ locationId, ...v }) => {
          const r = await create.submit({ fromId: locationId, ...v });
          setTimeout(() => announce(r.number === null ? t('stock.transfer.waiting') : t('stock.transfer.posted', { number: r.number })), 0);
          router.push(`/stock/transfers/${r.id}`);
        }}>
        <Places />
        <TextField name="businessDate" label={t('stock.date')} type="date" />
        <TextAreaField name="reason" label={t('stock.reason')} hint={t('stock.reason.hint')} />
        <Lines />
        <SubmitButton>{t('stock.transfer.save')}</SubmitButton>
      </Form>
    </>
  );
}
