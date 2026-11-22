'use client';
// Lead sources (RAD-122 on RAD-110's contracts): where enquiries come from. Each outside door (the website form, a
// campaign's QR, Google, Meta, WhatsApp) has its own, seeded; leads:setup adds more for leads taken by hand. A door's
// source can be ignored: its new enquiries are kept and set aside, never made leads, and stopping brings none back
// (RC-212). The server refuses ignoring one a person typed (source_not_ignorable); the screen offers it only on a door.
import { createLeadSource, listLeadSources, updateLeadSource } from '@radcore/lib-crm/contract';
import { useState } from 'react';
import type { z } from 'zod';
import { CloseButton, Dialog } from '../../../../components/ui/dialog/dialog.tsx';
import { Menu } from '../../../../components/ui/dialog/menu.tsx';
import { CheckboxField, RadioField, TextField } from '../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../components/ui/form/form.tsx';
import { announce } from '../../../../components/ui/live-region.tsx';
import { DataTable, type Column } from '../../../../components/ui/table/data-table.tsx';
import { useApiMutation, useApiQuery } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { inUse } from '../lists/whole-list.ts';
import { CRM_MESSAGES } from '../shared.ts';

type Source = z.output<typeof listLeadSources.output>['sources'][number];
const later = (text: string) => setTimeout(() => announce(text), 0);
const channelName = (c: Source['channel']) => t(`crm.enquiry.source.${c}`);

export default function LeadSourcesPage() {
  const q = useApiQuery(listLeadSources, {});
  const [editing, setEditing] = useState<Source | 'new' | null>(null);
  const close = (open: boolean) => { if (!open) setEditing(null); };
  const refresh = { invalidates: [listLeadSources] };
  const create = useApiMutation(createLeadSource, refresh);
  const update = useApiMutation(updateLeadSource, refresh);
  const columns: Column<Source>[] = [
    { id: 'name', header: t('crm.col.name'), cell: (s) => s.name },
    { id: 'channel', header: t('crm.sources.channel'), cell: (s) => `${channelName(s.channel)} (${t(s.door ? 'crm.sources.door' : 'crm.sources.byHand')})` },
    { id: 'status', header: t('crm.col.status'), cell: (s) => (s.ignored ? t('crm.sources.ignored.yes') : inUse(s.active)) },
    { id: 'actions', header: t('admin.users.col.actions'), cell: (s) => (
      <Menu label={t('crm.actionsFor', { name: s.name })} items={[{ label: t('crm.edit'), onSelect: () => setEditing(s) }]} />
    ) },
  ];
  return (
    <>
      <h1>{t('crm.sources.title')}</h1>
      <p>{t('crm.sources.intro')}</p>
      <div className="admin-toolbar">
        <button type="button" className="kit-button kit-button-primary" onClick={() => setEditing('new')}>{t('crm.sources.add')}</button>
      </div>
      <DataTable caption={t('crm.sources.title')} columns={columns} rowKey={(s) => s.id} empty={t('crm.sources.empty')} list={{
        items: q.data?.sources ?? [], hasNextPage: false, fetchNextPage: () => undefined, isFetchingNextPage: false,
        isPending: q.isPending, error: q.error, refetch: () => void q.refetch(),
      }} />
      <Dialog open={editing !== null} onOpenChange={close} title={t(editing === 'new' ? 'crm.sources.add' : 'crm.sources.edit')}>
        {editing === null ? null : editing === 'new' ? (
          <Form schema={createLeadSource.input} saved={false} messages={CRM_MESSAGES} defaultValues={{ name: '', channel: 'manual' }}
            onSubmit={async (v) => { await create.submit(v); setEditing(null); later(t('crm.sources.added')); }}>
            <TextField name="name" label={t('crm.col.name')} autoComplete="off" />
            <RadioField name="channel" label={t('crm.sources.channel')} options={[
              { value: 'manual', label: t('crm.capture.source.manual') }, { value: 'walk_in', label: t('crm.capture.source.walk_in') },
            ]} />
            <div className="kit-actions"><CloseButton>{t('crm.cancel')}</CloseButton><SubmitButton>{t('crm.add')}</SubmitButton></div>
          </Form>
        ) : (
          <Form schema={updateLeadSource.input.omit({ id: true })} saved={false} messages={CRM_MESSAGES}
            defaultValues={{ name: editing.name, active: editing.active, ignored: editing.ignored }}
            onSubmit={async (v) => { await update.submit({ id: editing.id, ...v }); setEditing(null); later(t('crm.sources.saved')); }}>
            <TextField name="name" label={t('crm.col.name')} autoComplete="off" />
            <CheckboxField name="active" label={t('crm.inUse')} hint={t('crm.inUse.hint')} />
            {editing.door ? <CheckboxField name="ignored" label={t('crm.sources.ignore')} hint={t('crm.sources.ignore.hint')} />
              : <p className="kit-field-hint">{t('crm.sources.ignore.notDoor')}</p>}
            <div className="kit-actions"><CloseButton>{t('crm.cancel')}</CloseButton><SubmitButton>{t('crm.save')}</SubmitButton></div>
          </Form>
        )}
      </Dialog>
    </>
  );
}
