'use client';
// Ad spend and cost per lead (RAD-122 on RAD-110's contracts). Cost per lead over a range of days is worked out by the server
// on read: spend recorded within the range, divided by enquiries received in it, none when there were none. The spend
// recorded, newest first. campaigns:write records more, on one campaign or one source; it posts nothing to the books (the
// ad bill is booked through purchases, so nothing is counted twice: the architect).
import { formatDate, formatMoney, indiaDate } from '@radcore/lib-common';
import { costPerLead, listAdSpend, listCampaigns, listLeadSources, recordAdSpend } from '@radcore/lib-crm/contract';
import { useId, useState } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { useMe } from '../../../../components/shell/session-provider.tsx';
import { CloseButton, Dialog } from '../../../../components/ui/dialog/dialog.tsx';
import { RadioField, SelectField, TextField } from '../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../components/ui/form/form.tsx';
import { announce } from '../../../../components/ui/live-region.tsx';
import { DataTable, type Column } from '../../../../components/ui/table/data-table.tsx';
import { useApiList, useApiMutation, useApiQuery } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { CRM_MESSAGES } from '../shared.ts';

type Cost = z.output<typeof costPerLead.output>['campaigns'][number];
type Spend = z.output<typeof listAdSpend.output>['items'][number];
const today = () => indiaDate(new Date());
const monthStart = () => `${today().slice(0, 8)}01`;

const rangeSchema = z.object({ fromDate: costPerLead.input.shape.fromDate, toDate: costPerLead.input.shape.toDate })
  .refine((r) => r.toDate >= r.fromDate, { path: ['toDate'], error: t('crm.adSpend.rangeBad') });

function CostTable({ caption, rows }: { caption: string; rows: readonly Cost[] }) {
  const captionId = useId();
  return (
    <div className="kit-table">
      <div className="kit-table-scroll" role="region" aria-labelledby={captionId} tabIndex={0}>
        <table>
          <caption id={captionId}>{caption}</caption>
          <thead><tr>
            <th scope="col">{t('crm.adSpend.col.name')}</th>
            <th scope="col" className="kit-numeric">{t('crm.adSpend.col.spend')}</th>
            <th scope="col" className="kit-numeric">{t('crm.adSpend.col.enquiries')}</th>
            <th scope="col" className="kit-numeric">{t('crm.adSpend.col.cpl')}</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 ? <tr><td colSpan={4}>{t('crm.adSpend.none')}</td></tr> : rows.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td className="kit-numeric">{formatMoney(r.spend)}</td>
                <td className="kit-numeric">{String(r.enquiries)}</td>
                <td className="kit-numeric">{r.costPerLead === null ? t('crm.adSpend.noEnquiries') : formatMoney(r.costPerLead)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const spendShape = recordAdSpend.input.shape;
const recordSchema = z.object({
  on: z.enum(['campaign', 'source']), campaignId: z.string(), sourceId: z.string(),
  fromDate: spendShape.fromDate, toDate: spendShape.toDate, amount: z.string().trim(), note: z.string().trim(),
}).transform((v, ctx) => {
  const target = v.on === 'campaign' ? v.campaignId : v.sourceId;
  if (target === '') {
    ctx.addIssue({ code: 'custom', path: [v.on === 'campaign' ? 'campaignId' : 'sourceId'], message: t(v.on === 'campaign' ? 'crm.adSpend.campaign.pick' : 'crm.adSpend.source.pick') });
    return z.NEVER;
  }
  const rest = { fromDate: v.fromDate, toDate: v.toDate, amount: v.amount, note: v.note === '' ? null : v.note };
  const out: z.input<typeof recordAdSpend.input> = v.on === 'campaign' ? { ...rest, campaignId: target } : { ...rest, sourceId: target };
  return out;
}).pipe(recordAdSpend.input);

/** The campaign or source box, as the spend is on one or the other. */
function Target({ campaigns, sources }: { campaigns: { value: string; label: string }[]; sources: { value: string; label: string }[] }) {
  const on = useWatch({ control: useFormContext().control, name: 'on' }) as unknown;
  return on === 'campaign'
    ? <SelectField name="campaignId" label={t('crm.adSpend.campaign')} placeholder={t('crm.adSpend.campaign.pick')} options={campaigns} />
    : <SelectField name="sourceId" label={t('crm.adSpend.sourceField')} placeholder={t('crm.adSpend.source.pick')} options={sources} />;
}

export default function AdSpendPage() {
  const { permissions } = useMe();
  const mayWrite = permissions.includes('campaigns:write');
  const [range, setRange] = useState({ fromDate: monthStart(), toDate: today() });
  const cost = useApiQuery(costPerLead, range);
  const entries = useApiList(listAdSpend, { filter: {} });
  const campaigns = useApiList(listCampaigns, { filter: {} }, { limit: 200 }).items;
  const sources = useApiQuery(listLeadSources, {}, { enabled: permissions.includes('leads:setup') }).data?.sources ?? [];
  const [recording, setRecording] = useState(false);
  const record = useApiMutation(recordAdSpend, { invalidates: [listAdSpend, costPerLead] });
  const nameOf = (s: Spend) => (s.campaignId !== null ? campaigns.find((c) => c.id === s.campaignId)?.name : sources.find((x) => x.id === s.sourceId)?.name)
    ?? t('crm.adSpend.unknown');
  const columns: Column<Spend>[] = [
    { id: 'on', header: t('crm.adSpend.col.on'), cell: (s) => nameOf(s) },
    { id: 'range', header: t('crm.adSpend.col.range'), cell: (s) => t('crm.adSpend.range', { from: formatDate(s.fromDate), to: formatDate(s.toDate) }) },
    { id: 'amount', header: t('crm.adSpend.col.amount'), numeric: true, cell: (s) => formatMoney(s.amount) },
    { id: 'note', header: t('crm.adSpend.col.note'), cell: (s) => s.note ?? '' },
  ];
  return (
    <>
      <h1>{t('crm.adSpend.title')}</h1>
      <p>{t('crm.adSpend.intro')}</p>
      <h2>{t('crm.adSpend.cost')}</h2>
      <p>{t('crm.adSpend.cost.intro')}</p>
      <Form schema={rangeSchema} saved={false} messages={CRM_MESSAGES} defaultValues={range} onSubmit={async (v) => { setRange(v); }}>
        <div className="admin-toolbar">
          <TextField name="fromDate" label={t('crm.adSpend.from')} type="date" />
          <TextField name="toDate" label={t('crm.adSpend.to')} type="date" />
          <SubmitButton>{t('crm.adSpend.show')}</SubmitButton>
        </div>
      </Form>
      {cost.error !== null ? <p role="alert" className="kit-form-alert">{t('error.title')}</p> : cost.data === undefined ? <p>{t('loading')}</p> : (
        <>
          <CostTable caption={t('crm.adSpend.campaigns')} rows={cost.data.campaigns} />
          <CostTable caption={t('crm.adSpend.sources')} rows={cost.data.sources} />
        </>
      )}
      <h2>{t('crm.adSpend.entries')}</h2>
      {mayWrite ? <div className="admin-toolbar"><button type="button" className="kit-button kit-button-primary" onClick={() => setRecording(true)}>{t('crm.adSpend.record')}</button></div> : null}
      <DataTable caption={t('crm.adSpend.entries')} columns={columns} rowKey={(s) => s.id} list={entries} empty={t('crm.adSpend.entries.empty')} />
      <Dialog open={recording} onOpenChange={setRecording} title={t('crm.adSpend.record')} description={t('crm.adSpend.intro')}>
        {recording ? (
          <Form schema={recordSchema} saved={false} messages={CRM_MESSAGES}
            defaultValues={{ on: 'campaign', campaignId: '', sourceId: '', fromDate: monthStart(), toDate: today(), amount: '', note: '' }}
            onSubmit={async (v) => { await record.submit(v); setRecording(false); setTimeout(() => announce(t('crm.adSpend.recorded')), 0); }}>
            <RadioField name="on" label={t('crm.adSpend.on')} options={[
              { value: 'campaign', label: t('crm.adSpend.on.campaign') }, { value: 'source', label: t('crm.adSpend.on.source') },
            ]} />
            <Target campaigns={campaigns.map((c) => ({ value: c.id, label: c.name }))} sources={sources.map((s) => ({ value: s.id, label: s.name }))} />
            <TextField name="fromDate" label={t('crm.adSpend.from')} type="date" />
            <TextField name="toDate" label={t('crm.adSpend.to')} type="date" />
            <TextField name="amount" label={t('crm.adSpend.amount')} inputMode="decimal" autoComplete="off" />
            <TextField name="note" label={t('crm.adSpend.note')} autoComplete="off" />
            <div className="kit-actions"><CloseButton>{t('crm.cancel')}</CloseButton><SubmitButton>{t('crm.adSpend.record')}</SubmitButton></div>
          </Form>
        ) : null}
      </Dialog>
    </>
  );
}
