'use client';
// A new job work challan (RAD-144 on RAD-142's createJobWorkChallan): inputs sent from a place of ours to a job worker, picked from
// what's on hand there by batch and serial, as a transfer's (StockPick reads the place as `locationId`, sent as `fromId`). It posts
// at once with its number. The job worker is any party; one without a job work place is refused in words (`no_job_work_place`),
// as is a job worker's own place or rejects as the source (`use_job_work`, `needs_qc`).
import { indiaDate } from '@radcore/lib-common';
import { listParties } from '@radcore/lib-accounts/contract';
import { createJobWorkChallan, getItem, listItems, listJobWorkChallans } from '@radcore/lib-stock/contract';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
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

const shape = createJobWorkChallan.input.shape;
const line = z.object({ itemId: z.string().min(1, t('stock.line.pick')), qty: z.string(), pick: z.record(z.string(), z.string()), serials: z.array(z.string()) })
  .transform((l, ctx) => {
    const batches = Object.entries(l.pick).filter(([, qty]) => qty.trim() !== '').map(([key, qty]) => ({ batchId: key === 'unknown' ? null : key, qty: qty.trim() }));
    if (batches.length === 0) {
      ctx.addIssue({ code: 'custom', message: t('stock.adjustment.err.pick'), path: ['qty'] });
      return z.NEVER;
    }
    return { itemId: l.itemId, qty: l.qty.trim(), batches, serials: l.serials };
  }).pipe(shape.lines.element);
const challanSchema = z.object({
  locationId: z.string().min(1, t('stock.jobWork.from.pick')).pipe(shape.fromId),
  partyId: z.string().min(1, t('stock.jobWork.party.pick')).pipe(shape.partyId),
  businessDate: shape.businessDate,
  notes: z.string().trim().transform((s) => (s === '' ? null : s)).pipe(shape.notes),
  lines: z.array(line).min(1, t('stock.lines.min')).max(200, t('stock.lines.max')),
});
type ChallanInput = z.input<typeof challanSchema>;
const blankLine = (itemId = ''): ChallanInput['lines'][number] => ({ itemId, qty: '', pick: {}, serials: [] });

const useItems = (query: string) => useApiSearch(listItems, query, { params: { filter: { active: true } } });
const useParties = (query: string) => useApiSearch(listParties, query, { params: { filter: { active: true } } });

function LineFields({ index, onSplit }: { index: number; onSplit: () => void }) {
  const { control, setValue } = useFormContext<ChallanInput>();
  const itemId = useWatch({ control, name: `lines.${index}.itemId` });
  const from = useWatch({ control, name: 'locationId' });
  // A new item or From place leaves none of the old picks or serials, as the transfer form (auditor-3 on #375).
  const seen = useRef({ itemId, from });
  useEffect(() => {
    if (seen.current.itemId === itemId && seen.current.from === from) return;
    seen.current = { itemId, from };
    setValue(`lines.${index}.pick`, {});
    setValue(`lines.${index}.serials`, []);
  }, [itemId, from, index, setValue]);
  const item = useApiQuery(getItem, { id: itemId }, { enabled: itemId !== '' }).data ?? null;
  return (
    <>
      <PickedField name={`lines.${index}.itemId`} label={t('stock.line.item')} hint={t('stock.line.item.hint')} initial={item}
        useSearch={useItems} optionLabel={(i) => i.name} optionDetail={(i) => i.sku} />
      <TextField name={`lines.${index}.qty`} label={t('stock.transfer.qty')} inputMode="decimal" autoComplete="off" />
      {itemId === '' ? null : from === '' ? <p>{t('stock.jobWork.pickFrom')}</p> : <StockPick index={index} itemId={itemId} onSplit={onSplit} />}
    </>
  );
}

function Lines() {
  const { control, getValues } = useFormContext<ChallanInput>();
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

function From() {
  const { control } = useFormContext<ChallanInput>();
  const from = useWatch({ control, name: 'locationId' });
  return <SelectField name="locationId" label={t('stock.jobWork.from')} placeholder={t('stock.jobWork.from.pick')} options={usePlaces(from)} />;
}

export default function NewJobWorkChallanPage() {
  const router = useRouter();
  const create = useApiMutation(createJobWorkChallan, { invalidates: [listJobWorkChallans] });
  return (
    <>
      <p><Link href="/stock/job-work">{t('stock.jobWork.back')}</Link></p>
      <h1 id="new-challan">{t('stock.jobWork.new.title')}</h1>
      <Form aria-labelledby="new-challan" schema={challanSchema} saved={false} messages={STOCK_MESSAGES}
        defaultValues={{ locationId: '', partyId: '', businessDate: indiaDate(new Date()), notes: '', lines: [blankLine()] }}
        onSubmit={async ({ locationId, ...v }) => {
          const r = await create.submit({ fromId: locationId, ...v });
          setTimeout(() => announce(t('stock.jobWork.posted', { number: r.number })), 0);
          router.push(`/stock/job-work/${r.id}`);
        }}>
        <From />
        <PickedField name="partyId" label={t('stock.jobWork.party')} hint={t('stock.jobWork.party.hint')} initial={null}
          useSearch={useParties} optionLabel={(p) => p.name} optionDetail={(p) => p.gstin} />
        <TextField name="businessDate" label={t('stock.date')} type="date" />
        <TextAreaField name="notes" label={t('stock.jobWork.notes')} />
        <Lines />
        <SubmitButton>{t('stock.jobWork.save')}</SubmitButton>
      </Form>
    </>
  );
}
