'use client';
// Test rides (RAD-127 on RAD-117's contracts): soonest first, a page at a time. A ride is a record on a demo unit for a lead;
// bookings:write schedules one and records how it went, once. What an outcome may be (before its time only "called off") and
// whether it was recorded already are the server's to say; the screen words its refusal.
import { formatMoment } from '@radcore/lib-common';
import { listTestRides, recordTestRide } from '@radcore/lib-sales/contract';
import Link from 'next/link';
import { useState } from 'react';
import { z } from 'zod';
import { useMe } from '../../../../components/shell/session-provider.tsx';
import { CloseButton, Dialog } from '../../../../components/ui/dialog/dialog.tsx';
import { SelectField, TextAreaField } from '../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../components/ui/form/form.tsx';
import { announce } from '../../../../components/ui/live-region.tsx';
import { DataTable, type Column } from '../../../../components/ui/table/data-table.tsx';
import { useApiList, useApiMutation } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { OUTCOMES, RIDE_MESSAGES, type RideRow } from './shared.ts';

const shape = recordTestRide.input.shape;
const outcomeSchema = z.object({
  outcome: z.string().min(1, t('sales.ride.record.outcome.none')).pipe(shape.outcome),
  note: z.string().trim().transform((s) => (s === '' ? undefined : s)).pipe(shape.note),
});

/** The dialog that records how a ride went. */
function RecordOutcome({ ride, onClose }: { ride: RideRow; onClose: () => void }) {
  const record = useApiMutation(recordTestRide, { invalidates: [listTestRides] });
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }} title={t('sales.ride.record.title')} description={t('sales.ride.record.body')}>
      <Form schema={outcomeSchema} saved={false} messages={RIDE_MESSAGES} defaultValues={{ outcome: '', note: '' }}
        onSubmit={async (v) => {
          await record.submit({ id: ride.id, outcome: v.outcome, ...(v.note === undefined ? {} : { note: v.note }) });
          onClose();
          setTimeout(() => announce(t('sales.ride.recorded')), 0);
        }}>
        <SelectField name="outcome" label={t('sales.ride.record.outcome')} placeholder={t('sales.ride.record.outcome.none')}
          options={OUTCOMES.map((o) => ({ value: o, label: t(`sales.ride.outcome.${o}`) }))} />
        <TextAreaField name="note" label={t('sales.ride.record.note')} />
        <div className="kit-actions">
          <CloseButton>{t('sales.cancel')}</CloseButton>
          <SubmitButton>{t('sales.ride.record.save')}</SubmitButton>
        </div>
      </Form>
    </Dialog>
  );
}

export default function TestRidesPage() {
  const mayWrite = useMe().permissions.includes('bookings:write');
  const list = useApiList(listTestRides, { filter: {} });
  const [recording, setRecording] = useState<RideRow | null>(null);
  const columns: Column<RideRow>[] = [
    { id: 'when', header: t('sales.ride.col.when'), cell: (r) => formatMoment(r.scheduledAt) },
    { id: 'unit', header: t('sales.ride.col.unit'), cell: (r) => r.serialNo },
    { id: 'outcome', header: t('sales.ride.col.outcome'), cell: (r) => (r.outcome === null ? t('sales.ride.outcome.none') : t(`sales.ride.outcome.${r.outcome}`)) },
    { id: 'note', header: t('sales.ride.col.note'), cell: (r) => r.note ?? '' },
    ...(mayWrite ? [{ id: 'action', header: t('sales.ride.col.action'), cell: (r: RideRow) => (r.outcome === null ? (
      <button type="button" className="kit-button" aria-label={t('sales.ride.record.for', { unit: r.serialNo })} onClick={() => setRecording(r)}>
        {t('sales.ride.record')}
      </button>
    ) : '') }] : []),
  ];
  return (
    <>
      <h1>{t('sales.rides.title')}</h1>
      <p>{t('sales.rides.intro')}</p>
      <div className="admin-toolbar">
        {mayWrite ? <Link className="kit-button kit-button-primary" href="/sales/test-rides/new">{t('sales.rides.new')}</Link> : null}
      </div>
      <DataTable caption={t('sales.rides.title')} columns={columns} rowKey={(r) => r.id} list={list} empty={t('sales.rides.empty')} />
      {recording === null ? null : <RecordOutcome ride={recording} onClose={() => setRecording(null)} />}
    </>
  );
}
