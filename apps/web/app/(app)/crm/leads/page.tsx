'use client';
// Leads (RAD-122 on RAD-109's contracts): latest enquiry first, a page at a time, filtered by whose they are, stage and
// follow-ups due. Someone who works only their own leads sees theirs, and the unowned ones too with leads:unassigned;
// the server decides. Every phone here is the mask with its last 4 kept, whoever looks (RC-041): the lead's own page
// shows the number to those who may see it.
import { formatDate, formatMoment, formatMoney, indiaDate } from '@radcore/lib-common';
import { LEAD_STAGES, listLeads } from '@radcore/lib-crm/contract';
import Link from 'next/link';
import { useState } from 'react';
import type { z } from 'zod';
import { useMe } from '../../../../components/shell/session-provider.tsx';
import { Pii } from '../../../../components/ui/masked.tsx';
import { DataTable, type Column } from '../../../../components/ui/table/data-table.tsx';
import { useApiList } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { ChoiceButtons } from '../../admin/shared.tsx';
import { leadName, ownerText, stageName, type Stage } from '../shared.ts';

type Row = z.output<typeof listLeads.output>['items'][number];
type Whose = 'all' | 'me' | 'none';

export default function LeadsPage() {
  const me = useMe();
  const mayWrite = me.permissions.includes('leads:write');
  const [whose, setWhose] = useState<Whose>('all');
  const [stage, setStage] = useState<Stage | 'all'>('all');
  const [due, setDue] = useState<'any' | 'due'>('any');
  const list = useApiList(listLeads, { filter: {
    ...(whose === 'all' ? {} : { owner: whose }),
    ...(stage === 'all' ? {} : { stage }),
    ...(due === 'due' ? { followUpBy: indiaDate(new Date()) } : {}),
  } });
  const columns: Column<Row>[] = [
    { id: 'lead', header: t('crm.col.lead'), cell: (l) => <Link href={`/crm/leads/${l.id}`}>{leadName(l.name, l.phone)}</Link> },
    { id: 'phone', header: t('crm.col.phone'), cell: (l) => <Pii value={l.phone} /> },
    { id: 'stage', header: t('crm.col.stage'), cell: (l) => stageName(l.stage) },
    { id: 'owner', header: t('crm.col.owner'), cell: (l) => ownerText(l.owner, me.user.id) },
    { id: 'followUp', header: t('crm.col.followUp'), cell: (l) => (l.followUpOn === null ? '' : formatDate(l.followUpOn)) },
    { id: 'value', header: t('crm.col.value'), numeric: true, cell: (l) => (l.value === null ? '' : formatMoney(l.value)) },
    { id: 'last', header: t('crm.col.lastEnquiry'), cell: (l) => formatMoment(l.lastEnquiryAt) },
  ];
  return (
    <>
      <h1>{t('crm.leads.title')}</h1>
      <p>{t('crm.leads.intro')}</p>
      <div className="admin-toolbar">
        <ChoiceButtons<Whose> label={t('crm.leads.whose')} value={whose} onChange={setWhose} options={[
          { value: 'all', label: t('crm.leads.whose.all') }, { value: 'me', label: t('crm.leads.whose.mine') },
          { value: 'none', label: t('crm.leads.whose.none') },
        ]} />
        {mayWrite ? <Link className="kit-button kit-button-primary" href="/crm/leads/new">{t('crm.leads.new')}</Link> : null}
      </div>
      <div className="admin-toolbar">
        <ChoiceButtons<Stage | 'all'> label={t('crm.stage')} value={stage} onChange={setStage} options={[
          { value: 'all', label: t('crm.leads.stage.all') }, ...LEAD_STAGES.map((s) => ({ value: s, label: stageName(s) })),
        ]} />
      </div>
      <div className="admin-toolbar">
        <ChoiceButtons<'any' | 'due'> label={t('crm.leads.due')} value={due} onChange={setDue} options={[
          { value: 'any', label: t('crm.leads.due.any') }, { value: 'due', label: t('crm.leads.due.only') },
        ]} />
      </div>
      <DataTable caption={t('crm.leads.title')} columns={columns} rowKey={(l) => l.id} list={list} empty={t('crm.leads.empty')} />
    </>
  );
}
