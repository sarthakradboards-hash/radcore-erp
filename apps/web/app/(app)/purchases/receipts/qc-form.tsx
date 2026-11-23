'use client';
// The form QC is done in (RAD-143 on RAD-137's postGoodsReceipt): each line of the arrival split into accepted and rejected by the
// supplier's batch, why anything was rejected and, for a serialised item, each unit with its chassis number where the item carries
// one. Whether the units are named is read off the item (items:read); a person who can't read it is offered the units anyway and
// the server refuses a wrong one. The server posts it all in one save and judges every refusal (units sold or in stock, the stock
// and the ledger); the screen only words them.
import { getItem } from '@radcore/lib-stock/contract';
import { useFieldArray, useFormContext, useWatch } from 'react-hook-form';
import { CheckboxField, SelectField, TextAreaField, TextField } from '../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../components/ui/form/form.tsx';
import { useApiQuery } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { asWritten } from '../../admin/decimal.ts';
import { qcSchema, type QcInput, type QcValues } from './qc-values.ts';
import { RECEIPT_MESSAGES } from './shared.tsx';

function Batches({ index }: { index: number }) {
  const { control } = useFormContext<QcInput>();
  const { fields, append, remove } = useFieldArray({ control, name: `lines.${index}.batches` });
  return (
    <>
      {fields.map((f, b) => (
        <fieldset key={f.id}>
          <legend>{t('inward.qc.batch', { n: String(b + 1) })}</legend>
          <TextField name={`lines.${index}.batches.${b}.batchNo`} label={t('inward.qc.batchNo')} hint={t('inward.qc.batchNo.hint')} autoComplete="off" />
          <TextField name={`lines.${index}.batches.${b}.accepted`} label={t('inward.qc.accepted')} inputMode="decimal" autoComplete="off" />
          <TextField name={`lines.${index}.batches.${b}.rejected`} label={t('inward.qc.rejected')} inputMode="decimal" autoComplete="off" />
          {fields.length > 1 ? (
            <button type="button" className="kit-button" onClick={() => remove(b)}>{t('inward.qc.batch.remove', { n: String(b + 1), line: String(index + 1) })}</button>
          ) : null}
        </fieldset>
      ))}
      <button type="button" className="kit-button" onClick={() => append({ batchNo: '', accepted: '', rejected: '' })}>{t('inward.qc.batch.add')}</button>
    </>
  );
}

function Units({ index, itemId }: { index: number; itemId: string }) {
  const { control } = useFormContext<QcInput>();
  const { fields, append, remove } = useFieldArray({ control, name: `lines.${index}.serials` });
  const batches = useWatch({ control, name: `lines.${index}.batches` });
  const item = useApiQuery(getItem, { id: itemId });
  const data = item.data;
  // Read: an item without serial numbers has no units to name. Not read (no items:read): offered, the server refuses a wrong one.
  if (item.isPending) return <p>{t('loading')}</p>;
  if (data !== undefined && !data.serialised) return null;
  const chassis = data === undefined || data.hasChassis;
  const named = [...new Set(batches.map((b) => b.batchNo.trim()).filter((n) => n !== ''))].map((n) => ({ value: n, label: n }));
  return (
    <section aria-label={t('inward.qc.units')}>
      <h3>{t('inward.qc.units')}</h3>
      <p>{t('inward.qc.units.intro')}</p>
      {data === undefined ? <p>{t('inward.qc.units.unknown')}</p> : null}
      {fields.map((f, u) => (
        <fieldset key={f.id}>
          <legend>{t('inward.qc.unit', { n: String(u + 1) })}</legend>
          <TextField name={`lines.${index}.serials.${u}.serialNo`} label={t('inward.qc.unit.serial')} autoComplete="off" />
          {chassis
            ? <TextField name={`lines.${index}.serials.${u}.chassisNo`} label={t('inward.qc.unit.chassis')} hint={t('inward.qc.unit.chassis.hint')} autoComplete="off" />
            : null}
          <SelectField name={`lines.${index}.serials.${u}.batchNo`} label={t('inward.qc.unit.batch')} placeholder={t('inward.qc.unit.ownBatch')} options={named} />
          <CheckboxField name={`lines.${index}.serials.${u}.rejected`} label={t('inward.qc.unit.rejected')} />
          <button type="button" className="kit-button" onClick={() => remove(u)}>{t('inward.qc.unit.remove', { n: String(u + 1), line: String(index + 1) })}</button>
        </fieldset>
      ))}
      <button type="button" className="kit-button" onClick={() => append({ serialNo: '', chassisNo: '', batchNo: '', rejected: false })}>{t('inward.qc.unit.add')}</button>
    </section>
  );
}

function Lines() {
  const { control } = useFormContext<QcInput>();
  const lines = useWatch({ control, name: 'lines' });
  return (
    <>
      {lines.map((l, i) => (
        <fieldset key={l.lineId}>
          <legend>{t('inward.qc.line', { n: String(i + 1), item: l.label })}</legend>
          <p>{t('inward.qc.received', { qty: asWritten(l.received) })}</p>
          <Batches index={i} />
          <TextAreaField name={`lines.${i}.rejectReason`} label={t('inward.qc.reason')} hint={t('inward.qc.reason.hint')} />
          <Units index={i} itemId={l.itemId} />
        </fieldset>
      ))}
    </>
  );
}

/** The form. `initial` has each line's received quantity accepted whole; the inspector changes what was not. */
export function QcForm({ labelledBy, initial, onSubmit }: { labelledBy: string; initial: QcInput; onSubmit: (values: QcValues) => Promise<unknown> }) {
  return (
    <Form aria-labelledby={labelledBy} schema={qcSchema} saved={false} messages={RECEIPT_MESSAGES} defaultValues={initial} onSubmit={onSubmit}>
      <p>{t('inward.qc.intro')}</p>
      <Lines />
      <SubmitButton>{t('inward.qc.save')}</SubmitButton>
    </Form>
  );
}
