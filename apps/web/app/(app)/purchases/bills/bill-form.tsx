'use client';
// The purchase bill draft form (RAD-143 on RAD-138's createPurchaseBill / updatePurchaseBill): the supplier's invoice as their
// bill says it, its file, and its lines. Goods lines are added a PO at a time: each of the PO's lines becomes one, at its PO rate
// until the bill says otherwise; once the goods are in, the receipt that brought them names its line. Charges (freight, packing,
// insurance) are their own lines with an HSN or SAC. The server works out the tax and the match; posting is on the bill's page.
import { listParties } from '@radcore/lib-accounts/contract';
import { getGoodsReceipt, getPurchaseOrder, listGoodsReceipts, listPurchaseOrders } from '@radcore/lib-purchasing/contract';
import { purchaseBillFiles } from '@radcore/lib-platform/contract';
import { useEffect, useId, useRef, useState } from 'react';
import { useFieldArray, useFormContext, useWatch } from 'react-hook-form';
import { SelectField, TextAreaField, TextField } from '../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../components/ui/form/form.tsx';
import { ApiError } from '../../../../lib/api-client.ts';
import { useApiList, useApiMutation, useApiQuery, useApiSearch } from '../../../../lib/api/query.ts';
import { BucketRefused, postToBucket } from '../../../../lib/files/post-to-bucket.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { asPrice } from '../../admin/decimal.ts';
import { PickedField } from '../../sales/picked-field.tsx';
import { PURCHASE_MESSAGES } from '../shared.tsx';
import { billSchema, blankCharge, type BillInput, type BillLineInput } from './bill-values.ts';

const useSuppliers = (query: string) => useApiSearch(listParties, query, { params: { filter: { buysFrom: true, active: true } } });
const TYPES = purchaseBillFiles.startUpload.input.shape.contentType.options;
const CHARGE_KINDS = ['freight', 'packing', 'insurance', 'other'] as const;

/** The supplier's bill itself: chosen, sent straight to the bucket, then checked by the server; the draft keeps its id. */
function BillFile() {
  const inputId = useId();
  const { control, setValue } = useFormContext<BillInput>();
  const fileId = useWatch({ control, name: 'fileId' });
  const start = useApiMutation(purchaseBillFiles.startUpload);
  const confirm = useApiMutation(purchaseBillFiles.confirmUpload);
  const [state, setState] = useState<{ busy: boolean; problem: string }>({ busy: false, problem: '' });
  const add = async (file: File) => {
    setState({ busy: true, problem: '' });
    try {
      const { id, url, fields } = await start.submit({ filename: file.name, contentType: file.type });
      await postToBucket(url, fields, file);
      await confirm.submit({ id });
      setValue('fileId', id, { shouldDirty: true });
      setState({ busy: false, problem: '' });
    } catch (e) {
      setState({ busy: false, problem: e instanceof BucketRefused ? t('purchases.bill.file.err.bucket')
        : e instanceof ApiError ? (e.envelope.issues[0]?.message ?? e.envelope.message) : t('purchases.bill.file.err.offline') });
    }
  };
  return (
    <div className="kit-field">
      <label htmlFor={inputId}>{t('purchases.bill.file')}</label>
      <p className="kit-hint">{fileId === '' ? t('purchases.bill.file.hint') : t('purchases.bill.file.ready')}</p>
      <input id={inputId} type="file" accept={TYPES.join(',')} disabled={state.busy}
        onChange={(e) => { const f = e.currentTarget.files?.[0]; if (f !== undefined) void add(f); }} />
      {state.busy ? <p role="status">{t('purchases.bill.file.uploading')}</p> : null}
      {state.problem === '' ? null : <p role="alert" className="kit-form-alert">{state.problem}</p>}
    </div>
  );
}

/** Adds one goods line for each line of a placed PO of the supplier's. */
function AddFromPo({ onAdd }: { onAdd: (lines: BillLineInput[]) => void }) {
  const { control } = useFormContext<BillInput>();
  const supplierId = useWatch({ control, name: 'supplierId' });
  // shortcut: the supplier's first 50 placed POs, newest first; a search is owed if a supplier has more open at once.
  const pos = useApiList(listPurchaseOrders, { filter: { supplierId, status: 'placed' } }, { limit: 50, enabled: supplierId !== '' });
  const [poId, setPoId] = useState('');
  const po = useApiQuery(getPurchaseOrder, { id: poId }, { enabled: poId !== '' }).data;
  const selectId = useId();
  if (supplierId === '') return <p>{t('purchases.bill.pickSupplierFirst')}</p>;
  return (
    <div className="admin-toolbar">
      <label htmlFor={selectId}>{t('purchases.bill.fromPo')}</label>
      <select id={selectId} className="kit-select" value={poId} onChange={(e) => setPoId(e.currentTarget.value)}>
        <option value="">{pos.items.length === 0 ? t('purchases.bill.noPos') : t('purchases.bill.pickPo')}</option>
        {pos.items.map((p) => <option key={p.id} value={p.id}>{p.number}</option>)}
      </select>
      <button type="button" className="kit-button" disabled={po === undefined}
        onClick={() => { if (po !== undefined) { onAdd(po.lines.map((l) => ({ kind: 'goods', label: `${l.name} (${l.sku}), ${po.number ?? ''}`,
          poLineId: l.id, receiptId: '', receiptLineId: '', qty: '', rate: asPrice(l.rate) }))); setPoId(''); } }}>
        {t('purchases.bill.addPoLines')}
      </button>
    </div>
  );
}

/** The receipt line for this goods line: pick the receipt that brought the goods, and its line for this PO line is found. */
function ReceiptPick({ index }: { index: number }) {
  const { control, setValue } = useFormContext<BillInput>();
  const supplierId = useWatch({ control, name: 'supplierId' });
  const receiptId = useWatch({ control, name: `lines.${index}.receiptId` }) as string;
  const receiptLineId = useWatch({ control, name: `lines.${index}.receiptLineId` }) as string;
  const poLineId = useWatch({ control, name: `lines.${index}.poLineId` }) as string;
  // shortcut: the supplier's 50 newest posted receipts; one for this line's PO further back is named by its saved line.
  const receipts = useApiList(listGoodsReceipts, { filter: { supplierId, status: 'posted' } }, { limit: 50, enabled: supplierId !== '' });
  const receipt = useApiQuery(getGoodsReceipt, { id: receiptId }, { enabled: receiptId !== '' }).data;
  const found = receipt?.lines.find((l) => l.orderLineId === poLineId);
  useEffect(() => {
    if (receipt !== undefined) setValue(`lines.${index}.receiptLineId`, found?.id ?? '', { shouldDirty: true });
  }, [receipt, found, index, setValue]);
  // Picking "not in yet" after a receipt clears its line; a saved draft's own line stays until another receipt is picked.
  const picked = useRef(receiptId);
  useEffect(() => {
    if (picked.current !== '' && receiptId === '') setValue(`lines.${index}.receiptLineId`, '', { shouldDirty: true });
    picked.current = receiptId;
  }, [receiptId, index, setValue]);
  return (
    <>
      <SelectField name={`lines.${index}.receiptId`} label={t('purchases.bill.receipt')} hint={t('purchases.bill.receipt.hint')}
        options={[{ value: '', label: receiptLineId !== '' && receiptId === '' ? t('purchases.bill.receipt.saved') : t('purchases.bill.receipt.none') },
          ...receipts.items.map((r) => ({ value: r.id, label: `${r.number ?? ''}, ${r.orderNumber ?? ''}` }))]} />
      {receipt !== undefined && found === undefined ? <p role="alert" className="kit-form-alert">{t('purchases.bill.receipt.noLine')}</p> : null}
      {found === undefined || found.accepted === null ? null
        : <p className="kit-hint">{t('purchases.bill.receipt.accepted', { qty: found.accepted, rate: asPrice(found.rate) })}</p>}
    </>
  );
}

function Lines() {
  const { control } = useFormContext<BillInput>();
  const { fields, append, remove } = useFieldArray({ control, name: 'lines' });
  const kinds = CHARGE_KINDS.map((k) => ({ value: k, label: t(`purchases.bill.charge.${k}`) }));
  return (
    <>
      <AddFromPo onAdd={(ls) => append(ls)} />
      {fields.map((f, i) => (
        <fieldset key={f.id}>
          {f.kind === 'goods' ? (
            <>
              <legend>{t('purchases.bill.goodsLine', { n: String(i + 1), label: f.label })}</legend>
              <ReceiptPick index={i} />
              <TextField name={`lines.${i}.qty`} label={t('purchases.bill.col.qty')} inputMode="decimal" autoComplete="off" />
              <TextField name={`lines.${i}.rate`} label={t('purchases.bill.col.rate')} hint={t('purchases.bill.rate.hint')} inputMode="decimal" autoComplete="off" />
            </>
          ) : (
            <>
              <legend>{t('purchases.bill.chargeLine', { n: String(i + 1) })}</legend>
              <SelectField name={`lines.${i}.charge`} label={t('purchases.bill.col.charge')} options={kinds} />
              <TextField name={`lines.${i}.description`} label={t('purchases.bill.chargeDescription')} autoComplete="off" />
              <TextField name={`lines.${i}.hsn`} label={t('purchases.bill.col.hsn')} inputMode="numeric" autoComplete="off" />
              <TextField name={`lines.${i}.amount`} label={t('purchases.bill.chargeAmount')} inputMode="decimal" autoComplete="off" />
            </>
          )}
          <button type="button" className="kit-button" onClick={() => remove(i)}>{t('purchases.bill.removeLine', { n: String(i + 1) })}</button>
        </fieldset>
      ))}
      {fields.length < 200 ? <button type="button" className="kit-button" onClick={() => append(blankCharge())}>{t('purchases.bill.addCharge')}</button> : null}
    </>
  );
}

export function BillForm({ labelledBy, initial, supplier, submit, onSubmit }: {
  labelledBy: string; initial: BillInput; supplier?: { id: string; name: string }; submit: string;
  onSubmit: (v: import('zod').output<typeof billSchema>) => Promise<void>;
}) {
  return (
    <Form aria-labelledby={labelledBy} schema={billSchema} saved={false} messages={PURCHASE_MESSAGES} defaultValues={initial} onSubmit={onSubmit}>
      <PickedField name="supplierId" label={t('purchases.order.supplier')} initial={supplier ?? null} useSearch={useSuppliers} optionLabel={(p) => p.name} />
      <TextField name="supplierInvoiceNumber" label={t('purchases.bill.invoiceNumber')} hint={t('purchases.bill.invoiceNumber.hint')} autoComplete="off" />
      <TextField name="supplierInvoiceDate" label={t('purchases.bill.invoiceDate')} type="date" />
      <TextField name="businessDate" label={t('purchases.bill.date')} hint={t('purchases.bill.date.hint')} type="date" />
      <TextField name="supplierGstin" label={t('purchases.bill.supplierGstin')} hint={t('purchases.bill.gstin.hint')} autoComplete="off" />
      <TextField name="statedTotal" label={t('purchases.bill.statedTotal')} hint={t('purchases.bill.statedTotal.hint')} inputMode="decimal" autoComplete="off" />
      <BillFile />
      <TextAreaField name="notes" label={t('purchases.order.notes')} />
      <Lines />
      <SubmitButton>{submit}</SubmitButton>
    </Form>
  );
}
