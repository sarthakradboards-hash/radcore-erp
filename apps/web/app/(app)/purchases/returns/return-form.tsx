'use client';
// The supplier return draft form (RAD-143 on RAD-140's createSupplierReturn / updateSupplierReturn): rejects going back to their
// supplier, out of a rejects place, with the reason the debit note prints. Lines are added from a posted goods receipt of the
// supplier's: each of its lines that had rejects, ready to send back all its rejected goods (boxes and units can be lowered).
// The server splits each line into its unbilled and billed parts and words the debit note; the screen adds up only quantities.
import { dec } from '@radcore/lib-common';
import { listParties } from '@radcore/lib-accounts/contract';
import { getGoodsReceipt, listGoodsReceipts } from '@radcore/lib-purchasing/contract';
import { listLocations } from '@radcore/lib-stock/contract';
import { useEffect, useId, useRef, useState } from 'react';
import { useController, useFieldArray, useFormContext, useWatch } from 'react-hook-form';
import { SelectField, TextAreaField, TextField } from '../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../components/ui/form/form.tsx';
import { useApiList, useApiQuery, useApiSearch } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { asWritten } from '../../admin/decimal.ts';
import { PickedField } from '../../sales/picked-field.tsx';
import { PURCHASE_MESSAGES } from '../shared.tsx';
import { returnSchema, type ReturnInput, type ReturnLineInput } from './return-values.ts';

const useSuppliers = (query: string) => useApiSearch(listParties, query, { params: { filter: { buysFrom: true, active: true } } });

function RejectsPlace() {
  const { control } = useFormContext<ReturnInput>();
  const current = useWatch({ control, name: 'locationId' });
  // shortcut: the first 50 rejects places, as there are a handful per company; a search is owed past that.
  const places = useApiList(listLocations, { filter: { kind: 'rejected', status: 'active' } }, { limit: 50 });
  const options = places.items.map((p) => ({ value: p.id, label: p.name }));
  if (current !== '' && !options.some((o) => o.value === current)) options.push({ value: current, label: t('purchases.return.place.saved') });
  return <SelectField name="locationId" label={t('purchases.return.place')} hint={t('purchases.return.place.hint')}
    placeholder={t('purchases.return.place.pick')} options={options} />;
}

/** Adds a line for each line of a posted receipt that had rejects, ready to send all of them back. */
function AddFromReceipt({ onAdd }: { onAdd: (l: ReturnLineInput) => void }) {
  const { control } = useFormContext<ReturnInput>();
  const supplierId = useWatch({ control, name: 'supplierId' });
  const onReturn = useWatch({ control, name: 'lines' }).map((l) => l.receiptLineId);
  // shortcut: the supplier's 50 newest posted receipts; older rejects need a search here.
  const receipts = useApiList(listGoodsReceipts, { filter: { supplierId, status: 'posted' } }, { limit: 50, enabled: supplierId !== '' });
  const [receiptId, setReceiptId] = useState('');
  const receipt = useApiQuery(getGoodsReceipt, { id: receiptId }, { enabled: receiptId !== '' }).data;
  const selectId = useId();
  // A receipt picked for the last supplier goes with them (auditor-3 on #406).
  const seen = useRef(supplierId);
  useEffect(() => { if (seen.current !== supplierId) { seen.current = supplierId; setReceiptId(''); } }, [supplierId]);
  if (supplierId === '') return <p>{t('purchases.return.pickSupplierFirst')}</p>;
  // A receipt line already on this return isn't offered again: one line each, as the server counts it.
  const withRejects = (receipt?.lines ?? []).filter((l) => l.rejected !== null && !dec(l.rejected).isZero() && !onReturn.includes(l.id));
  return (
    <div>
      <div className="admin-toolbar">
        <label htmlFor={selectId}>{t('purchases.return.fromReceipt')}</label>
        <select id={selectId} className="kit-select" value={receiptId} onChange={(e) => setReceiptId(e.currentTarget.value)}>
          <option value="">{receipts.items.length === 0 ? t('purchases.return.noReceipts') : t('purchases.return.pickReceipt')}</option>
          {receipts.items.map((r) => <option key={r.id} value={r.id}>{r.number ?? ''}, {r.orderNumber ?? ''}</option>)}
        </select>
      </div>
      {receipt === undefined ? null : withRejects.length === 0 ? <p>{t('purchases.return.noRejects')}</p> : (
        <ul>
          {withRejects.map((l) => (
            <li key={l.id}>
              {t('purchases.return.rejectedOn', { name: `${l.name} (${l.sku})`, qty: asWritten(l.rejected ?? '0') })}{' '}
              <button type="button" className="kit-button" onClick={() => {
                const batches = l.batches.filter((b) => !dec(b.rejected).isZero());
                const serials = l.serials.filter((s) => s.rejected).map((s) => s.serialNo);
                onAdd({ receiptLineId: l.id, label: `${l.name} (${l.sku}), ${receipt.number ?? ''}`,
                  batchOptions: batches.map((b) => ({ batchId: b.batchId, batchNo: b.batchNo, qty: b.rejected })), serialOptions: serials,
                  batches: Object.fromEntries(batches.map((b) => [b.batchId, b.rejected])), serials });
              }}>{t('purchases.return.addLine')}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Units({ index, options }: { index: number; options: readonly string[] }) {
  const { field } = useController<ReturnInput, `lines.${number}.serials`>({ name: `lines.${index}.serials` });
  const picked: readonly string[] = field.value;
  return (
    <fieldset>
      <legend>{t('purchases.return.units')}</legend>
      <ul className="admin-checklist">
        {options.map((s) => (
          <li key={s}>
            <label className="admin-grant">
              <input type="checkbox" checked={picked.includes(s)}
                onChange={() => field.onChange(picked.includes(s) ? picked.filter((x) => x !== s) : [...picked, s])} />
              <span>{s}</span>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

function Lines() {
  const { control } = useFormContext<ReturnInput>();
  const { fields, append, remove, replace } = useFieldArray({ control, name: 'lines' });
  // Another supplier's receipts can't be on this return, so changing the supplier empties its lines (auditor-3 on #404's form);
  // not on the first render, so a saved draft keeps its own.
  const supplierId = useWatch({ control, name: 'supplierId' });
  const seen = useRef(supplierId);
  useEffect(() => {
    if (seen.current === supplierId) return;
    seen.current = supplierId;
    replace([]);
  }, [supplierId, replace]);
  return (
    <>
      <AddFromReceipt onAdd={(l) => append(l)} />
      {fields.map((f, i) => (
        <fieldset key={f.id}>
          <legend>{t('purchases.return.line', { n: String(i + 1), label: f.label })}</legend>
          {f.batchOptions.map((b) => (
            <TextField key={b.batchId} name={`lines.${i}.batches.${b.batchId}`} inputMode="decimal" autoComplete="off"
              label={b.qty === '' ? t('purchases.return.batch.saved', { batch: b.batchNo }) : t('purchases.return.batch', { batch: b.batchNo, qty: asWritten(b.qty) })} />
          ))}
          {f.serialOptions.length === 0 ? null : <Units index={i} options={f.serialOptions} />}
          <button type="button" className="kit-button" onClick={() => remove(i)}>{t('purchases.return.removeLine', { n: String(i + 1) })}</button>
        </fieldset>
      ))}
    </>
  );
}

export function ReturnForm({ labelledBy, initial, supplier, onSubmit }: {
  labelledBy: string; initial: ReturnInput; supplier?: { id: string; name: string };
  onSubmit: (v: import('zod').output<typeof returnSchema>) => Promise<void>;
}) {
  return (
    <Form aria-labelledby={labelledBy} schema={returnSchema} saved={false} messages={PURCHASE_MESSAGES} defaultValues={initial} onSubmit={onSubmit}>
      {supplier === undefined
        ? <PickedField name="supplierId" label={t('purchases.order.supplier')} initial={null} useSearch={useSuppliers} optionLabel={(p) => p.name} />
        : <p>{t('purchases.return.supplier', { name: supplier.name })}</p>}
      <TextField name="businessDate" label={t('purchases.order.date')} type="date" />
      <RejectsPlace />
      <TextAreaField name="reason" label={t('purchases.return.reason')} hint={t('purchases.return.reason.hint')} />
      <TextAreaField name="notes" label={t('purchases.order.notes')} />
      <Lines />
      <SubmitButton>{t('purchases.return.save')}</SubmitButton>
    </Form>
  );
}
