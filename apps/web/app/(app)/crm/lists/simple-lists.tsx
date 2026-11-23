'use client';
// Two of the CRM's lists (RAD-122 on RAD-109's contracts): lost reasons and quick replies. Each is named, edited and
// switched off or on, never deleted: a lead that has one keeps it. leads:setup keeps them; the server refuses a name
// already taken.
import { createLostReason, createQuickReply, getLeadLists, updateLostReason, updateQuickReply } from '@radcore/lib-crm/contract';
import { useId, useState } from 'react';
import type { z } from 'zod';
import { CloseButton, Dialog } from '../../../../components/ui/dialog/dialog.tsx';
import { Menu } from '../../../../components/ui/dialog/menu.tsx';
import { CheckboxField, TextAreaField, TextField } from '../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../components/ui/form/form.tsx';
import { announce } from '../../../../components/ui/live-region.tsx';
import { DataTable, type Column } from '../../../../components/ui/table/data-table.tsx';
import { useApiMutation } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { CRM_MESSAGES } from '../shared.ts';
import { inUse, wholeList, type ListsQuery } from './whole-list.ts';

type Lists = z.output<typeof getLeadLists.output>;
type Reason = Lists['lostReasons'][number];
type Reply = Lists['quickReplies'][number];
const later = (text: string) => setTimeout(() => announce(text), 0);
const refresh = { invalidates: [getLeadLists] };

function Actions({ save }: { save: string }) {
  return <div className="kit-actions"><CloseButton>{t('crm.cancel')}</CloseButton><SubmitButton>{save}</SubmitButton></div>;
}

export function LostReasons({ q, mayWrite }: { q: ListsQuery; mayWrite: boolean }) {
  const headingId = useId();
  const [editing, setEditing] = useState<Reason | 'new' | null>(null);
  const close = (open: boolean) => { if (!open) setEditing(null); };
  const create = useApiMutation(createLostReason, refresh);
  const update = useApiMutation(updateLostReason, refresh);
  const columns: Column<Reason>[] = [
    { id: 'label', header: t('crm.reasons.label'), cell: (r) => r.label },
    { id: 'status', header: t('crm.col.status'), cell: (r) => inUse(r.active) },
    ...(mayWrite ? [{ id: 'actions', header: t('admin.users.col.actions'), cell: (r: Reason) => (
      <Menu label={t('crm.actionsFor', { name: r.label })} items={[{ label: t('crm.edit'), onSelect: () => setEditing(r) }]} />
    ) }] : []),
  ];
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId}>{t('crm.reasons.title')}</h2>
      {mayWrite ? <button type="button" className="kit-button" onClick={() => setEditing('new')}>{t('crm.reasons.add')}</button> : null}
      <DataTable caption={t('crm.reasons.title')} columns={columns} rowKey={(r) => r.id} list={wholeList(q, (l) => l.lostReasons)}
        empty={t('crm.reasons.empty')} />
      <Dialog open={editing !== null} onOpenChange={close} title={t(editing === 'new' ? 'crm.reasons.add' : 'crm.reasons.edit')}>
        {editing === null ? null : editing === 'new' ? (
          <Form schema={createLostReason.input} saved={false} messages={CRM_MESSAGES} defaultValues={{ label: '' }}
            onSubmit={async (v) => { await create.submit(v); setEditing(null); later(t('crm.reasons.added')); }}>
            <TextField name="label" label={t('crm.reasons.label')} autoComplete="off" />
            <Actions save={t('crm.add')} />
          </Form>
        ) : (
          <Form schema={updateLostReason.input.omit({ id: true })} saved={false} messages={CRM_MESSAGES}
            defaultValues={{ label: editing.label, active: editing.active }}
            onSubmit={async (v) => { await update.submit({ id: editing.id, ...v }); setEditing(null); later(t('crm.reasons.saved')); }}>
            <TextField name="label" label={t('crm.reasons.label')} autoComplete="off" />
            <CheckboxField name="active" label={t('crm.inUse')} hint={t('crm.inUse.hint')} />
            <Actions save={t('crm.save')} />
          </Form>
        )}
      </Dialog>
    </section>
  );
}

export function QuickReplies({ q, mayWrite }: { q: ListsQuery; mayWrite: boolean }) {
  const headingId = useId();
  const [editing, setEditing] = useState<Reply | 'new' | null>(null);
  const close = (open: boolean) => { if (!open) setEditing(null); };
  const create = useApiMutation(createQuickReply, refresh);
  const update = useApiMutation(updateQuickReply, refresh);
  const columns: Column<Reply>[] = [
    { id: 'title', header: t('crm.replies.titleField'), cell: (r) => r.title },
    // The text as typed, never markup.
    { id: 'body', header: t('crm.replies.body'), cell: (r) => <span className="crm-message">{r.body}</span> },
    { id: 'status', header: t('crm.col.status'), cell: (r) => inUse(r.active) },
    ...(mayWrite ? [{ id: 'actions', header: t('admin.users.col.actions'), cell: (r: Reply) => (
      <Menu label={t('crm.actionsFor', { name: r.title })} items={[{ label: t('crm.edit'), onSelect: () => setEditing(r) }]} />
    ) }] : []),
  ];
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId}>{t('crm.replies.title')}</h2>
      <p>{t('crm.replies.intro')}</p>
      {mayWrite ? <button type="button" className="kit-button" onClick={() => setEditing('new')}>{t('crm.replies.add')}</button> : null}
      <DataTable caption={t('crm.replies.title')} columns={columns} rowKey={(r) => r.id} list={wholeList(q, (l) => l.quickReplies)}
        empty={t('crm.replies.empty')} />
      <Dialog open={editing !== null} onOpenChange={close} title={t(editing === 'new' ? 'crm.replies.add' : 'crm.replies.edit')}>
        {editing === null ? null : editing === 'new' ? (
          <Form schema={createQuickReply.input} saved={false} messages={CRM_MESSAGES} defaultValues={{ title: '', body: '' }}
            onSubmit={async (v) => { await create.submit(v); setEditing(null); later(t('crm.replies.added')); }}>
            <TextField name="title" label={t('crm.replies.titleField')} autoComplete="off" />
            <TextAreaField name="body" label={t('crm.replies.body')} hint={t('crm.replies.intro')} />
            <Actions save={t('crm.add')} />
          </Form>
        ) : (
          <Form schema={updateQuickReply.input.omit({ id: true })} saved={false} messages={CRM_MESSAGES}
            defaultValues={{ title: editing.title, body: editing.body, active: editing.active }}
            onSubmit={async (v) => { await update.submit({ id: editing.id, ...v }); setEditing(null); later(t('crm.replies.saved')); }}>
            <TextField name="title" label={t('crm.replies.titleField')} autoComplete="off" />
            <TextAreaField name="body" label={t('crm.replies.body')} hint={t('crm.replies.intro')} />
            <CheckboxField name="active" label={t('crm.inUse')} hint={t('crm.inUse.hint')} />
            <Actions save={t('crm.save')} />
          </Form>
        )}
      </Dialog>
    </section>
  );
}
