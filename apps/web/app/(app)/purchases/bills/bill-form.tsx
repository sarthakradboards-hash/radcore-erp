'use client';
// The purchase bill draft form (RAD-143 on RAD-138's createPurchaseBill / updatePurchaseBill): the supplier's invoice as their
// bill says it, its file, and its lines. Goods lines are added a PO at a time: each of the PO's lines becomes one, at its PO rate
// until the bill says otherwise; once the goods are in, the receipt that brought them names its line. Charges (freight, packing,
// insurance) are their own lines with an HSN or SAC. The server works out the tax and the match; posting is on the bill's page.
import { listExpenseCategories, listParties } from '@radcore/lib-accounts/contract';
import { getGoodsReceipt, getPurchaseOrder, listGoodsReceipts, listPurchaseOrders } from '@radcore/lib-purchasing/contract';
import { purchaseBillFiles } from '@radcore/lib-platform/contract';
import { getJobWorkReceipt, listJobWorkReceipts } from '@radcore/lib-stock/contract';
import { useEffect, useId, useRef, useState } from 'react';
import { useFieldArray, useFormContext, useWatch } from 'react-hook-form';
import { useMe } from '../../../../components/shell/session-provider.tsx';
import { SelectField, TextAreaField, TextField } from '../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../components/ui/form/form.tsx';
import { ApiError } from '../../../../lib/api-client.ts';
import { useApiList, useApiMutation, useApiQuery, useApiSearch } from '../../../../lib/api/query.ts';
import { BucketRefused, postToBucket } from '../../../../lib/files/post-to-bucket.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { asPrice, asWritten } from '../../admin/decimal.ts';
import { PickedField } from '../../sales/picked-field.tsx';
import { PURCHASE_MESSAGES } from '../shared.tsx';
import { billSchema, blankCharge, categoryChoices, type BillInput, type BillLineInput } from './bill-values.ts';

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
        : e instanceof ApiError ? (PURCHASE_MESSAGES[e.code] ?? e.envelope.issues[0]?.message ?? e.envelope.message) : t('purchases.bill.file.err.offline') });
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

/** Adds one goods line for each line of a PO of the supplier's, placed or closed: a PO closes as soon as all its goods are in,
 * and one closed short usually has goods in to bill too, so both are offered (e2e-playwright and auditor-3 on #404). The server
 * holds each line to what came in (`over_received`). */
function AddFromPo({ onAdd }: { onAdd: (lines: BillLineInput[]) => void }) {
  const { control } = useFormContext<BillInput>();
  const supplierId = useWatch({ control, name: 'supplierId' });
  // shortcut: the supplier's 50 newest placed and 50 newest closed POs; a search by number is owed if a supplier has more.
  const placed = useApiList(listPurchaseOrders, { filter: { supplierId, status: 'placed' } }, { limit: 50, enabled: supplierId !== '' });
  const closed = useApiList(listPurchaseOrders, { filter: { supplierId, status: 'closed' } }, { limit: 50, enabled: supplierId !== '' });
  const pos = [...placed.items, ...closed.items];
  const [poId, setPoId] = useState('');
  const po = useApiQuery(getPurchaseOrder, { id: poId }, { enabled: poId !== '' }).data;
  const selectId = useId();
  // Another supplier's POs aren't offered, so a PO picked for the last one goes.
  const seen = useRef(supplierId);
  useEffect(() => { if (seen.current !== supplierId) { seen.current = supplierId; setPoId(''); } }, [supplierId]);
  if (supplierId === '') return <p>{t('purchases.bill.pickSupplierFirst')}</p>;
  return (
    <div className="admin-toolbar">
      <label htmlFor={selectId}>{t('purchases.bill.fromPo')}</label>
      <select id={selectId} className="kit-select" value={poId} onChange={(e) => setPoId(e.currentTarget.value)}>
        <option value="">{pos.length === 0 ? t('purchases.bill.noPos') : t('purchases.bill.pickPo')}</option>
        {pos.map((p) => <option key={p.id} value={p.id}>{p.status === 'closed' ? t('purchases.bill.poClosed', { number: p.number ?? '' }) : p.number}</option>)}
      </select>
      <button type="button" className="kit-button" disabled={po === undefined}
        onClick={() => { if (po !== undefined) { onAdd(po.lines.map((l) => ({ kind: 'goods', label: `${l.name} (${l.sku}), ${po.number ?? ''}`,
          poLineId: l.id, receiptId: '', receiptLineId: '', qty: '', rate: asPrice(l.rate) }))); setPoId(''); } }}>
        {t('purchases.bill.addPoLines')}
      </button>
    </div>
  );
}

/** Adds a job worker's charges (#408): the lines of one of their posted job-work receipts that made goods, each at its charge
 * rate until the bill says otherwise. Lines already on the bill aren't offered again. The SAC is the bill's to give. */
function AddFromJobWork({ onAdd }: { onAdd: (lines: BillLineInput[]) => void }) {
  const { control } = useFormContext<BillInput>();
  const supplierId = useWatch({ control, name: 'supplierId' });
  const onBill = useWatch({ control, name: 'lines' }).flatMap((l) => (l.kind === 'job_work' ? [l.jobWorkReceiptLineId] : []));
  // shortcut: the job worker's 50 newest posted receipts; a search is owed past that. Read under stock:read, so a bill writer
  // without it sees none here.
  const receipts = useApiList(listJobWorkReceipts, { filter: { partyId: supplierId, status: 'posted' } }, { limit: 50, enabled: supplierId !== '' });
  const [receiptId, setReceiptId] = useState('');
  const receipt = useApiQuery(getJobWorkReceipt, { id: receiptId }, { enabled: receiptId !== '' }).data;
  const seen = useRef(supplierId);
  useEffect(() => { if (seen.current !== supplierId) { seen.current = supplierId; setReceiptId(''); } }, [supplierId]);
  const selectId = useId();
  if (supplierId === '' || receipts.items.length === 0) return null;
  const made = (receipt?.lines ?? []).filter((l) => l.made !== null && !onBill.includes(l.id));
  return (
    <div className="admin-toolbar">
      <label htmlFor={selectId}>{t('purchases.bill.fromJobWork')}</label>
      <select id={selectId} className="kit-select" value={receiptId} onChange={(e) => setReceiptId(e.currentTarget.value)}>
        <option value="">{t('purchases.bill.pickJobWork')}</option>
        {receipts.items.map((r) => <option key={r.id} value={r.id}>{r.number}, {r.challanNumber}</option>)}
      </select>
      {receipt !== undefined && made.length === 0 ? <p>{t('purchases.bill.jobWorkNothing')}</p> : null}
      <button type="button" className="kit-button" disabled={receipt === undefined || made.length === 0}
        onClick={() => { if (receipt !== undefined) { onAdd(made.flatMap((l) => (l.made === null ? [] : [{ kind: 'job_work' as const,
          label: `${l.made.name} (${l.made.sku}), ${receipt.number}`, jobWorkReceiptLineId: l.id, qty: asWritten(l.made.qty),
          rate: asPrice(l.made.chargeRate), hsn: '' }]))); setReceiptId(''); } }}>
        {t('purchases.bill.addJobWork')}
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
        : <p className="kit-hint">{t('purchases.bill.receipt.accepted', { qty: asWritten(found.accepted), rate: asPrice(found.rate) })}</p>}
    </>
  );
}

/** A charge's expense category and the account it posts to, from the categories (expenses:read): only switched-on ones, and
 * only the chosen category's accounts. A new category empties the account, which may not be one of its own. */
function ChargeCategory({ index }: { index: number }) {
  const { control, setValue } = useFormContext<BillInput>();
  const categoryId = useWatch({ control, name: `lines.${index}.expenseCategoryId` });
  const seen = useRef(categoryId);
  useEffect(() => {
    if (seen.current === categoryId) return;
    seen.current = categoryId;
    setValue(`lines.${index}.expenseAccountId`, '');
  }, [categoryId, index, setValue]);
  const may = useMe().permissions.includes('expenses:read');
  const q = useApiQuery(listExpenseCategories, {}, { enabled: may });
  if (!may || q.error !== null) return <p className="kit-hint">{t('purchases.bill.category.hidden')}</p>;
  // Drawn only once the categories are in: a select drawn with "None" alone can't show a saved draft's category, and
  // would save it unseen (e2e-playwright on #450).
  const choices = categoryChoices(q.data?.items, categoryId);
  if (choices === null) return <p>{t('loading')}</p>;
  const chosen = q.data?.items.find((c) => c.id === categoryId);
  return (
    <>
      <SelectField name={`lines.${index}.expenseCategoryId`} label={t('purchases.bill.category')} hint={t('purchases.bill.category.hint')}
        options={[{ value: '', label: t('purchases.bill.category.none') }, ...choices]} />
      {chosen === undefined ? null : (
        <SelectField name={`lines.${index}.expenseAccountId`} label={t('purchases.bill.expenseAccount')} placeholder={t('purchases.bill.expenseAccount.pick')}
          options={chosen.accounts.map((a) => ({ value: a.id, label: a.name }))} />
      )}
    </>
  );
}

function Lines() {
  const { control, getValues } = useFormContext<BillInput>();
  const { fields, append, remove, replace } = useFieldArray({ control, name: 'lines' });
  // Another supplier's POs can't be on this bill, so changing the supplier drops its goods lines; charges stay. Not on the first
  // render, so a saved draft keeps its own (auditor-3 on #404).
  const supplierId = useWatch({ control, name: 'supplierId' });
  const seen = useRef(supplierId);
  useEffect(() => {
    if (seen.current === supplierId) return;
    seen.current = supplierId;
    replace(getValues('lines').filter((l) => l.kind === 'charge'));
  }, [supplierId, replace, getValues]);
  const kinds = CHARGE_KINDS.map((k) => ({ value: k, label: t(`purchases.bill.charge.${k}`) }));
  return (
    <>
      <AddFromPo onAdd={(ls) => append(ls)} />
      <AddFromJobWork onAdd={(ls) => append(ls)} />
      {fields.map((f, i) => (
        <fieldset key={f.id}>
          {f.kind === 'goods' ? (
            <>
              <legend>{t('purchases.bill.goodsLine', { n: String(i + 1), label: f.label })}</legend>
              <ReceiptPick index={i} />
              <TextField name={`lines.${i}.qty`} label={t('purchases.bill.col.qty')} inputMode="decimal" autoComplete="off" />
              <TextField name={`lines.${i}.rate`} label={t('purchases.bill.col.rate')} hint={t('purchases.bill.rate.hint')} inputMode="decimal" autoComplete="off" />
            </>
          ) : f.kind === 'job_work' ? (
            <>
              <legend>{t('purchases.bill.jobWorkLine', { n: String(i + 1), label: f.label })}</legend>
              <TextField name={`lines.${i}.qty`} label={t('purchases.bill.col.qty')} inputMode="decimal" autoComplete="off" />
              <TextField name={`lines.${i}.rate`} label={t('purchases.bill.col.rate')} hint={t('purchases.bill.jobWorkRate.hint')} inputMode="decimal" autoComplete="off" />
              <TextField name={`lines.${i}.hsn`} label={t('purchases.bill.sac')} inputMode="numeric" autoComplete="off" />
            </>
          ) : (
            <>
              <legend>{t('purchases.bill.chargeLine', { n: String(i + 1) })}</legend>
              <SelectField name={`lines.${i}.charge`} label={t('purchases.bill.col.charge')} options={kinds} />
              <TextField name={`lines.${i}.description`} label={t('purchases.bill.chargeDescription')} autoComplete="off" />
              <TextField name={`lines.${i}.hsn`} label={t('purchases.bill.col.hsn')} inputMode="numeric" autoComplete="off" />
              <TextField name={`lines.${i}.amount`} label={t('purchases.bill.chargeAmount')} inputMode="decimal" autoComplete="off" />
              <ChargeCategory index={i} />
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
