'use client';
// A new job work receipt (RAD-144 on RAD-142's createJobWorkReceipt), against the challan named in `?challan=`: for each of its
// lines still out, the goods made and, of the inputs, what was used, came back and was lost, by the challan's batches and units.
// It posts at once with its number. Without a challan named, the open challans are offered to pick from.
import { dec, indiaDate } from '@radcore/lib-common';
import { createJobWorkReceipt, getItem, getJobWorkChallan, listItems, listJobWorkChallans, listJobWorkReceipts } from '@radcore/lib-stock/contract';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useMemo } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import type { z } from 'zod';
import { SelectField, TextAreaField, TextField } from '../../../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../../../components/ui/form/form.tsx';
import { announce } from '../../../../../../components/ui/live-region.tsx';
import { useApiList, useApiMutation, useApiQuery, useApiSearch } from '../../../../../../lib/api/query.ts';
import { t } from '../../../../../../lib/i18n/index.ts';
import { asWritten } from '../../../../admin/decimal.ts';
import { PickedField } from '../../../../sales/picked-field.tsx';
import { STOCK_MESSAGES, usePlaces } from '../../../shared.tsx';
import { batchKey, blankReceiptLine, PARTS, receiptSchema, type ReceiptInput } from '../receipt-values.ts';

type Challan = z.output<typeof getJobWorkChallan.output>;
type Line = Challan['lines'][number];
const useItems = (query: string) => useApiSearch(listItems, query, { params: { filter: { active: true } } });

function Made({ index }: { index: number }) {
  const { control } = useFormContext<ReceiptInput>();
  const itemId = useWatch({ control, name: `lines.${index}.made.itemId` });
  const item = useApiQuery(getItem, { id: itemId }, { enabled: itemId !== '' }).data ?? null;
  return (
    <fieldset>
      <legend>{t('stock.jobWork.receipt.made')}</legend>
      <PickedField name={`lines.${index}.made.itemId`} label={t('stock.jobWork.receipt.made.item')} initial={item}
        useSearch={useItems} optionLabel={(i) => i.name} optionDetail={(i) => i.sku} />
      <TextField name={`lines.${index}.made.qty`} label={t('stock.jobWork.receipt.made.qty')} inputMode="decimal" autoComplete="off" />
      <TextField name={`lines.${index}.made.chargeRate`} label={t('stock.jobWork.receipt.rate')} hint={t('stock.jobWork.receipt.rate.hint')}
        inputMode="decimal" autoComplete="off" />
      <TextAreaField name={`lines.${index}.made.serialsText`} label={t('stock.jobWork.receipt.made.serials')} hint={t('stock.jobWork.receipt.made.serials.hint')} />
    </fieldset>
  );
}

function LineFields({ index, line }: { index: number; line: Line }) {
  const fateOptions = [{ value: '', label: t('stock.jobWork.receipt.fate.none') },
    ...PARTS.map((p) => ({ value: p, label: t(`stock.jobWork.receipt.part.${p}`) }))];
  return (
    <fieldset>
      <legend>{t('stock.jobWork.receipt.line', { name: `${line.name} (${line.sku})`, left: asWritten(line.left) })}</legend>
      <Made index={index} />
      {PARTS.map((p) => (
        <fieldset key={p}>
          <legend>{t(`stock.jobWork.receipt.part.${p}`)}</legend>
          {line.batches.map((b) => (
            <TextField key={batchKey(b.batchId)} name={`lines.${index}.${p}.${batchKey(b.batchId)}`} inputMode="decimal" autoComplete="off"
              label={t('stock.jobWork.receipt.batch', { batch: b.batchNo ?? t('stock.batch.none'), sent: asWritten(b.qty) })} />
          ))}
        </fieldset>
      ))}
      {line.serials.length === 0 ? null : (
        <fieldset>
          <legend>{t('stock.jobWork.receipt.units')}</legend>
          {line.serials.map((s, k) => (
            <SelectField key={s} name={`lines.${index}.fates.${k}`} label={t('stock.jobWork.receipt.fate', { serial: s })} options={fateOptions} />
          ))}
        </fieldset>
      )}
    </fieldset>
  );
}

function To() {
  const { control } = useFormContext<ReceiptInput>();
  const to = useWatch({ control, name: 'locationId' });
  return <SelectField name="locationId" label={t('stock.jobWork.receipt.to')} hint={t('stock.jobWork.receipt.to.hint')}
    placeholder={t('stock.jobWork.to.pick')} options={usePlaces(to)} />;
}

function ReceiptForm({ challan }: { challan: Challan }) {
  const router = useRouter();
  const create = useApiMutation(createJobWorkReceipt, { invalidates: [listJobWorkReceipts, getJobWorkChallan, listJobWorkChallans] });
  const open = useMemo(() => challan.lines.filter((l) => dec(l.left).gt(0)), [challan]);
  const schema = useMemo(() => receiptSchema(challan.id, open), [challan.id, open]);
  if (open.length === 0) return <p>{t('stock.jobWork.receipt.nothingLeft')}</p>;
  return (
    <Form aria-labelledby="new-receipt" schema={schema} saved={false} messages={STOCK_MESSAGES}
      defaultValues={{ locationId: '', businessDate: indiaDate(new Date()), notes: '', lines: open.map(blankReceiptLine) }}
      onSubmit={async (v) => {
        const r = await create.submit(v);
        setTimeout(() => announce(t('stock.jobWork.receipt.posted', { number: r.number })), 0);
        router.push(`/stock/job-work/receipts/${r.id}`);
      }}>
      <To />
      <TextField name="businessDate" label={t('stock.date')} type="date" />
      <TextAreaField name="notes" label={t('stock.jobWork.notes')} />
      {open.map((l, i) => <LineFields key={l.id} index={i} line={l} />)}
      <SubmitButton>{t('stock.jobWork.receipt.save')}</SubmitButton>
    </Form>
  );
}

function PickChallan() {
  const list = useApiList(listJobWorkChallans, { filter: { status: 'posted', open: true } }, { limit: 50 });
  if (list.items.length === 0) return <p>{list.isPending ? t('loading') : t('stock.jobWork.receipt.noOpen')}</p>;
  return (
    <>
      <p>{t('stock.jobWork.receipt.pickChallan')}</p>
      <ul>{list.items.map((c) => <li key={c.id}><Link href={`/stock/job-work/receipts/new?challan=${c.id}`}>{c.number}</Link>, {c.partyName}</li>)}</ul>
    </>
  );
}

function NewReceipt() {
  const challanId = useSearchParams().get('challan') ?? '';
  const q = useApiQuery(getJobWorkChallan, { id: challanId }, { enabled: challanId !== '' });
  const c = q.data;
  return (
    <>
      <p><Link href={challanId === '' ? '/stock/job-work' : `/stock/job-work/${challanId}`}>{t('stock.jobWork.back')}</Link></p>
      <h1 id="new-receipt">{c === undefined ? t('stock.jobWork.receipt.new') : t('stock.jobWork.receipt.new.for', { number: c.number, party: c.partyName })}</h1>
      {challanId === '' ? <PickChallan />
        : q.error !== null ? <p role="alert" className="kit-form-alert">{t('stock.jobWork.missing')}</p>
          : c === undefined ? <p>{t('loading')}</p> : <ReceiptForm challan={c} />}
    </>
  );
}

export default function NewJobWorkReceiptPage() {
  return <Suspense fallback={<p>{t('loading')}</p>}><NewReceipt /></Suspense>;
}
