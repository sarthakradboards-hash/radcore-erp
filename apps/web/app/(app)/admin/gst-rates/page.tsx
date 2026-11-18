'use client';
// GST rates (RAD-99 on RAD-91's contracts): each HSN code's rate from a date, with the notification it comes from.
// gst:read sees them a page at a time, narrowed by an HSN prefix, and can ask what rate applies to an item's HSN on a
// date; no rate there is said as such, never read as 0% (RC-115). gst:write adds a rate from a new date, or corrects
// the row for the same code and date, with a reason; nothing is deleted. The rules (which row wins) are the server's.
import { formatDate, indiaDate } from '@radcore/lib-common';
import { getGstRateInForce, listGstRates, setGstRate } from '@radcore/lib-gst/contract';
import { useState } from 'react';
import { z } from 'zod';
import { useMe } from '../../../../components/shell/session-provider.tsx';
import { CloseButton, Dialog } from '../../../../components/ui/dialog/dialog.tsx';
import { TextAreaField, TextField } from '../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../components/ui/form/form.tsx';
import { SearchBox } from '../../../../components/ui/form/search-box.tsx';
import { announce } from '../../../../components/ui/live-region.tsx';
import { DataTable, type Column } from '../../../../components/ui/table/data-table.tsx';
import { ApiError, callContract } from '../../../../lib/api-client.ts';
import { useApiList, useApiMutation } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { MESSAGES } from '../shared.tsx';
import type { GstRate } from '../types.ts';

// An empty note box is the contract's null.
const rateSchema = setGstRate.input.extend({
  note: z.string().trim().transform((s) => (s === '' ? null : s)).pipe(setGstRate.input.shape.note),
});
// The API sends six places ("5.000000"); a rate reads as written: 5, 2.5, 18 (e2e on #199).
const percent = (rate: string) => (rate.includes('.') ? rate.replace(/\.?0+$/, '') : rate);
const columns: Column<GstRate>[] = [
  { id: 'hsn', header: t('admin.gst.hsn'), cell: (r) => r.hsn },
  { id: 'from', header: t('admin.gst.from'), cell: (r) => formatDate(r.effectiveFrom) },
  { id: 'rate', header: t('admin.gst.rate'), cell: (r) => `${percent(r.rate)}%`, numeric: true },
  { id: 'source', header: t('admin.gst.source'), cell: (r) => r.source },
  { id: 'note', header: t('admin.gst.note'), cell: (r) => r.note ?? '' },
];
const later = (text: string) => setTimeout(() => announce(text), 0);

export default function GstRatesPage() {
  const mayWrite = useMe().permissions.includes('gst:write');
  const [hsn, setHsn] = useState('');
  const list = useApiList(listGstRates, { filter: hsn === '' ? {} : { hsn } });
  const [adding, setAdding] = useState(false);
  const save = useApiMutation(setGstRate, { invalidates: [listGstRates] });
  const [found, setFound] = useState<string>('');

  return (
    <>
      <h1>{t('admin.gst.title')}</h1>
      <p>{t('admin.gst.intro')}</p>
      <div className="admin-toolbar">
        <SearchBox label={t('admin.gst.search')} action={t('admin.audit.apply')} onSearch={setHsn} maxLength={8} />
        {mayWrite ? (
          <button type="button" className="kit-button kit-button-primary" onClick={() => setAdding(true)}>{t('admin.gst.add')}</button>
        ) : null}
      </div>
      <DataTable caption={t('admin.gst.title')} columns={columns} rowKey={(r) => r.id} list={list} empty={t('admin.gst.empty')} />

      <h2 id="in-force-title">{t('admin.gst.inForce')}</h2>
      <p>{t('admin.gst.inForce.intro')}</p>
      <Form aria-labelledby="in-force-title" schema={getGstRateInForce.input} saved={false} messages={MESSAGES}
        defaultValues={{ hsn: '', on: indiaDate(new Date()) }}
        onSubmit={async (v) => {
          setFound('');
          try {
            const r = await callContract(getGstRateInForce, v);
            setFound(t('admin.gst.inForce.found', { rate: percent(r.rate), hsn: r.hsn, from: formatDate(r.effectiveFrom), source: r.source }));
          } catch (e) {
            if (!(e instanceof ApiError && e.code === 'no_gst_rate')) throw e;
            setFound(t('admin.gst.inForce.none', { hsn: v.hsn, on: formatDate(v.on) }));
          }
        }}>
        <TextField name="hsn" label={t('admin.gst.itemHsn')} hint={t('admin.items.hsn.hint')} inputMode="numeric" autoComplete="off" />
        <TextField name="on" label={t('admin.gst.on')} type="date" />
        <SubmitButton>{t('admin.gst.inForce.ask')}</SubmitButton>
      </Form>
      <p role="status">{found}</p>

      <Dialog open={adding} onOpenChange={setAdding} title={t('admin.gst.add')} description={t('admin.gst.add.hint')}>
        <Form schema={rateSchema} saved={false} messages={MESSAGES}
          defaultValues={{ hsn: '', effectiveFrom: indiaDate(new Date()), rate: '', source: '', note: '', reason: '' }}
          onSubmit={async (v) => {
            await save.submit(v);
            setAdding(false);
            later(t('admin.gst.saved', { hsn: v.hsn, from: formatDate(v.effectiveFrom) }));
          }}>
          <TextField name="hsn" label={t('admin.gst.hsn')} hint={t('admin.gst.hsn.hint')} inputMode="numeric" autoComplete="off" />
          <TextField name="effectiveFrom" label={t('admin.gst.from')} type="date" />
          <TextField name="rate" label={t('admin.gst.rate.field')} hint={t('admin.gst.rate.hint')} inputMode="decimal" autoComplete="off" />
          <TextField name="source" label={t('admin.gst.source')} hint={t('admin.gst.source.hint')} autoComplete="off" />
          <TextAreaField name="note" label={t('admin.gst.note.field')} />
          <TextAreaField name="reason" label={t('admin.reason')} />
          <div className="kit-actions">
            <CloseButton>{t('admin.cancel')}</CloseButton>
            <SubmitButton>{t('admin.gst.save')}</SubmitButton>
          </div>
        </Form>
      </Dialog>
    </>
  );
}
