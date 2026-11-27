'use client';
// Reverse-charge rules (RAD-169 on RAD-153's contracts, ADR-010 §4), built like the GST rates screen: gst:read sees every
// rule in one answer; gst:write adds one, or corrects the row for the same prefix, supplier and date, with a reason.
// Nothing is deleted. A rule reads "Unconfirmed" until the CA confirms it.
import { formatDate, indiaDate } from '@radcore/lib-common';
import { listRcmRules, setRcmRule } from '@radcore/lib-gst/contract';
import { useState } from 'react';
import { z } from 'zod';
import { useMe } from '../../../../components/shell/session-provider.tsx';
import { CloseButton, Dialog } from '../../../../components/ui/dialog/dialog.tsx';
import { CheckboxField, SelectField, TextAreaField, TextField } from '../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../components/ui/form/form.tsx';
import { announce } from '../../../../components/ui/live-region.tsx';
import { DataTable, type Column } from '../../../../components/ui/table/data-table.tsx';
import { useApiMutation, useApiQuery } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { MESSAGES } from '../shared.tsx';
import type { RcmRule } from '../types.ts';

// An empty note box is the contract's null.
const ruleSchema = setRcmRule.input.extend({
  note: z.string().trim().transform((s) => (s === '' ? null : s)).pipe(setRcmRule.input.shape.note),
});
const SUPPLIERS = setRcmRule.input.shape.supplier.options;
const supplierLabel = (s: RcmRule['supplier']) => t(`gst.rcm.supplier.${s}`);
const later = (text: string) => setTimeout(() => announce(text), 0);

export default function RcmRulesPage() {
  const mayWrite = useMe().permissions.includes('gst:write');
  const q = useApiQuery(listRcmRules, {});
  const save = useApiMutation(setRcmRule, { invalidates: [listRcmRules] });
  // 'new', the row being corrected, or closed.
  const [editing, setEditing] = useState<'new' | RcmRule | null>(null);

  const columns: Column<RcmRule>[] = [
    { id: 'prefix', header: t('gst.rcm.prefix'), cell: (r) => r.prefix },
    { id: 'supplier', header: t('gst.rcm.supplier'), cell: (r) => supplierLabel(r.supplier) },
    { id: 'from', header: t('gst.rcm.from'), cell: (r) => formatDate(r.effectiveFrom) },
    { id: 'source', header: t('gst.rcm.source'), cell: (r) => r.source },
    { id: 'note', header: t('gst.rcm.note'), cell: (r) => r.note ?? '' },
    { id: 'status', header: t('gst.rcm.status'), cell: (r) => t(r.confirmed ? 'gst.rcm.confirmed' : 'gst.rcm.unconfirmed') },
    ...(mayWrite ? [{ id: 'act', header: '', cell: (r: RcmRule) => (
      <button type="button" className="kit-button" onClick={() => setEditing(r)}
        aria-label={`${t('gst.rcm.correct')} ${r.prefix} ${supplierLabel(r.supplier)} ${formatDate(r.effectiveFrom)}`}>
        {t('gst.rcm.correct')}
      </button>
    ) }] : []),
  ];
  const correcting = editing !== null && editing !== 'new' ? editing : null;

  return (
    <>
      <h1>{t('gst.rcm.title')}</h1>
      <p>{t('gst.rcm.intro')}</p>
      {mayWrite ? (
        <div className="admin-toolbar">
          <button type="button" className="kit-button kit-button-primary" onClick={() => setEditing('new')}>{t('gst.rcm.add')}</button>
        </div>
      ) : null}
      <DataTable caption={t('gst.rcm.title')} columns={columns} rowKey={(r) => r.id} empty={t('gst.rcm.empty')} list={{
        items: q.data?.items ?? [], hasNextPage: false, fetchNextPage: () => undefined, isFetchingNextPage: false,
        isPending: q.isPending, error: q.error, refetch: () => void q.refetch(),
      }} />

      <Dialog open={editing !== null} onOpenChange={(open) => { if (!open) setEditing(null); }}
        title={correcting === null ? t('gst.rcm.add') : t('gst.rcm.correct.title', { prefix: correcting.prefix, from: formatDate(correcting.effectiveFrom) })}
        description={t(correcting === null ? 'gst.rcm.add.hint' : 'gst.rcm.correct.hint')}>
        {editing === null ? null : (
          <Form schema={ruleSchema} saved={false} messages={MESSAGES}
            defaultValues={correcting === null
              ? { prefix: '', supplier: 'unregistered', effectiveFrom: indiaDate(new Date()), source: '', note: '', confirmed: false, reason: '' }
              : { prefix: correcting.prefix, supplier: correcting.supplier, effectiveFrom: correcting.effectiveFrom, source: correcting.source,
                note: correcting.note ?? '', confirmed: correcting.confirmed, reason: '' }}
            onSubmit={async (v) => {
              await save.submit(v);
              setEditing(null);
              later(t('gst.rcm.saved', { prefix: v.prefix, from: formatDate(v.effectiveFrom) }));
            }}>
            {/* A correction keeps its prefix, supplier and date: changing one would add a new rule instead. */}
            {correcting === null ? (
              <>
                <TextField name="prefix" label={t('gst.rcm.prefix')} hint={t('gst.rcm.prefix.hint')} inputMode="numeric" autoComplete="off" />
                <SelectField name="supplier" label={t('gst.rcm.supplier')} options={SUPPLIERS.map((s) => ({ value: s, label: supplierLabel(s) }))} />
                <TextField name="effectiveFrom" label={t('gst.rcm.from')} type="date" />
              </>
            ) : (
              <p>{t('gst.rcm.supplier')}: {supplierLabel(correcting.supplier)}</p>
            )}
            <TextField name="source" label={t('gst.rcm.source')} hint={t('gst.rcm.source.hint')} autoComplete="off" />
            <TextAreaField name="note" label={t('gst.rcm.note.field')} />
            <CheckboxField name="confirmed" label={t('gst.rcm.confirmed.field')} />
            <TextAreaField name="reason" label={t('admin.reason')} />
            <div className="kit-actions">
              <CloseButton>{t('admin.cancel')}</CloseButton>
              <SubmitButton>{t('gst.rcm.save')}</SubmitButton>
            </div>
          </Form>
        )}
      </Dialog>
    </>
  );
}
