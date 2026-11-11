'use client';
// People (RAD-57, M1-14, M1-16, M1-18): invite, change a role, deactivate and reactivate, sign out everywhere.
// The server says what may be done (`self`, a role's `grantable`) and refuses the rest with a named code.
import { deactivateUser, endUserSessions, inviteUser, listRoles, listSessions, listUsers, reactivateUser, resendInvite, setUserRole } from '@radcore/lib-platform/contract';
import { useState } from 'react';
import { z } from 'zod';
import { Dialog, CloseButton } from '../../../../components/ui/dialog/dialog.tsx';
import { Menu, type MenuItem } from '../../../../components/ui/dialog/menu.tsx';
import { ReasonDialog } from '../../../../components/ui/dialog/reason-dialog.tsx';
import { RadioField, TextAreaField, TextField } from '../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../components/ui/form/form.tsx';
import { announce } from '../../../../components/ui/live-region.tsx';
import { DataTable, type Column } from '../../../../components/ui/table/data-table.tsx';
import { useApiList, useApiMutation, useApiQuery } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { ChoiceButtons, ConfirmDialog, MESSAGES } from '../shared.tsx';
import type { AdminUser, Role, UserStatus } from '../types.ts';

type Show = 'all' | UserStatus;
type Acting = { kind: 'role' | 'deactivate' | 'reactivate' | 'resend' | 'sessions'; user: AdminUser };

const roleOptions = (roles: readonly Role[]) =>
  roles.map((r) => ({ value: r.key, label: r.name, detail: r.description, disabled: !r.grantable }));

// After the dialog has closed, so the page's live region, no longer inert, is the one that speaks.
const later = (text: string) => setTimeout(() => announce(text), 0);

export default function UsersPage() {
  const [typed, setTyped] = useState('');
  const [search, setSearch] = useState('');
  const [show, setShow] = useState<Show>('all');
  const list = useApiList(listUsers, {
    filter: { ...(search === '' ? {} : { search }), ...(show === 'all' ? {} : { status: show }) },
  });
  const roles = useApiQuery(listRoles, {}).data?.roles ?? [];
  const roleName = (key: string) => roles.find((r) => r.key === key)?.name ?? key;

  const [inviting, setInviting] = useState(false);
  const [acting, setActing] = useState<Acting | null>(null);
  const close = (open: boolean) => { if (!open) setActing(null); };
  const refresh = { invalidates: [listUsers, listRoles, listSessions] };
  const invite = useApiMutation(inviteUser, refresh);
  const changeRole = useApiMutation(setUserRole, refresh);
  const deactivate = useApiMutation(deactivateUser, refresh);
  const reactivate = useApiMutation(reactivateUser, refresh);
  const resend = useApiMutation(resendInvite, refresh);
  const signOut = useApiMutation(endUserSessions, refresh);

  const actions = (u: AdminUser): MenuItem[] => {
    const act = (kind: Acting['kind']) => () => setActing({ kind, user: u });
    return [
      ...(u.status === 'disabled' ? [] : [{ label: t('users.role.change'), onSelect: act('role') }]),
      ...(u.status === 'invited' ? [{ label: t('users.resend'), onSelect: act('resend') }] : []),
      ...(u.status === 'active' ? [{ label: t('users.endSessions'), onSelect: act('sessions') }] : []),
      u.status === 'disabled'
        ? { label: t('users.reactivate'), onSelect: act('reactivate') }
        : { label: t('users.deactivate'), onSelect: act('deactivate') },
    ];
  };

  const columns: Column<AdminUser>[] = [
    { id: 'name', header: t('users.col.name'), cell: (u) => (u.self ? t('users.you', { name: u.displayName }) : u.displayName) },
    { id: 'email', header: t('users.col.email'), cell: (u) => u.email },
    { id: 'role', header: t('users.col.role'), cell: (u) => roleName(u.role) },
    { id: 'status', header: t('users.col.status'), cell: (u) => t(`users.status.${u.status}`) },
    { id: 'factor', header: t('users.col.factor'), cell: (u) => t(`users.factor.${u.secondFactor}`) },
    // Your own row has no actions: nobody changes their own role or account here (M1-18).
    { id: 'actions', header: t('users.col.actions'), cell: (u) => (u.self ? null
      : <Menu label={t('users.actionsFor', { name: u.displayName })} items={actions(u)} />) },
  ];

  const user = acting?.user;
  const name = user?.displayName ?? '';
  return (
    <>
      <h1>{t('users.title')}</h1>
      <div className="admin-toolbar">
        <form role="search" className="admin-toolbar" onSubmit={(e) => { e.preventDefault(); setSearch(typed.trim()); }}>
          <div className="kit-field">
            <label htmlFor="users-search">{t('users.search')}</label>
            <input id="users-search" type="search" value={typed} maxLength={100} onChange={(e) => setTyped(e.target.value)} />
          </div>
          <button type="submit" className="kit-button">{t('audit.apply')}</button>
        </form>
        <button type="button" className="kit-button kit-button-primary" onClick={() => setInviting(true)}>
          {t('users.invite')}
        </button>
      </div>
      <ChoiceButtons<Show> label={t('users.status')} value={show} onChange={setShow} options={[
        { value: 'all', label: t('users.status.all') }, { value: 'active', label: t('users.status.active') },
        { value: 'invited', label: t('users.status.invited') }, { value: 'disabled', label: t('users.status.disabled') },
      ]} />
      <DataTable caption={t('users.title')} columns={columns} rowKey={(u) => u.id} list={list} empty={t('users.empty')} />

      <Dialog open={inviting} onOpenChange={setInviting} title={t('users.invite.title')} description={t('users.invite.hint')}>
        <Form schema={inviteUser.input.extend({ role: z.string().min(1, t('users.invite.pickRole')) })}
          defaultValues={{ email: '', displayName: '', role: '' }} saved={false} messages={MESSAGES}
          onSubmit={async (v) => {
            await invite.submit(v);
            setInviting(false);
            later(t('users.invite.sent', { email: v.email }));
          }}>
          <TextField name="email" label={t('users.invite.email')} type="email" autoComplete="off" />
          <TextField name="displayName" label={t('users.invite.name')} autoComplete="off" />
          <RadioField name="role" label={t('users.invite.role')} options={roleOptions(roles)} />
          <div className="kit-actions">
            <CloseButton>{t('admin.cancel')}</CloseButton>
            <SubmitButton>{t('users.invite.send')}</SubmitButton>
          </div>
        </Form>
      </Dialog>

      <Dialog open={acting?.kind === 'role'} onOpenChange={close} title={t('users.role.title', { name })}
        description={t('users.role.hint')}>
        {user === undefined ? null : (
          <Form schema={setUserRole.input.pick({ role: true, reason: true })} saved={false} messages={MESSAGES}
            defaultValues={{ role: user.role, reason: '' }}
            onSubmit={async (v) => {
              await changeRole.submit({ id: user.id, ...v });
              setActing(null);
              later(t('users.role.done', { name, role: roleName(v.role) }));
            }}>
            <RadioField name="role" label={t('users.invite.role')} options={roleOptions(roles)} />
            <TextAreaField name="reason" label={t('admin.reason')} />
            <div className="kit-actions">
              <CloseButton>{t('admin.cancel')}</CloseButton>
              <SubmitButton>{t('users.role.save')}</SubmitButton>
            </div>
          </Form>
        )}
      </Dialog>

      <ReasonDialog open={acting?.kind === 'deactivate'} onOpenChange={close} messages={MESSAGES}
        title={t('users.deactivate.title', { name })} action={t('users.deactivate')}
        done={t('users.deactivate.done', { name })}
        onConfirm={(reason) => deactivate.submit({ id: user?.id ?? '', reason })} />
      <ReasonDialog open={acting?.kind === 'reactivate'} onOpenChange={close} messages={MESSAGES}
        title={t('users.reactivate.title', { name })} action={t('users.reactivate')}
        done={t('users.reactivate.done', { name })}
        onConfirm={(reason) => reactivate.submit({ id: user?.id ?? '', reason })} />
      <ConfirmDialog open={acting?.kind === 'resend'} onOpenChange={close}
        title={t('users.resend.title', { name })} body={t('users.resend.body')} action={t('users.resend')}
        done={t('users.resent', { name })} onConfirm={async () => { await resend.submit({ id: user?.id ?? '' }); }} />
      <ConfirmDialog open={acting?.kind === 'sessions'} onOpenChange={close}
        title={t('users.endSessions.title', { name })} body={t('users.endSessions.body')}
        action={t('users.endSessions.confirm')} done=""
        onConfirm={async () => {
          const { ended } = await signOut.submit({ id: user?.id ?? '' });
          return t('users.endSessions.done', { name, count: String(ended) });
        }} />
    </>
  );
}
