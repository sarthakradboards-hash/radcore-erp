'use client';
// People (RAD-57, M1-14, M1-16, M1-18): invite, change a role, deactivate and reactivate, sign out everywhere.
// The server says what may be done (`self`, a role's `grantable`) and refuses the rest with a named code. The screen
// offers only what the person may do (RC-151, e2e on RAD-57): writes need users:write, and role names, the role
// column and the role pickers need roles:read, so a reader without it never calls listRoles for a 403.
import { deactivateUser, endUserSessions, inviteUser, listRoles, listSessions, listUsers, reactivateUser, resendInvite, setUserRole } from '@radcore/lib-platform/contract';
import { useState } from 'react';
import { z } from 'zod';
import { Dialog, CloseButton } from '../../../../components/ui/dialog/dialog.tsx';
import { Menu, type MenuItem } from '../../../../components/ui/dialog/menu.tsx';
import { ReasonDialog } from '../../../../components/ui/dialog/reason-dialog.tsx';
import { RadioField, TextAreaField, TextField } from '../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../components/ui/form/form.tsx';
import { SearchBox } from '../../../../components/ui/form/search-box.tsx';
import { useMe } from '../../../../components/shell/session-provider.tsx';
import { Pii } from '../../../../components/ui/masked.tsx';
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
  const [search, setSearch] = useState('');
  const [show, setShow] = useState<Show>('all');
  const list = useApiList(listUsers, {
    filter: { ...(search === '' ? {} : { search }), ...(show === 'all' ? {} : { status: show }) },
  });
  const { permissions } = useMe();
  const mayWrite = permissions.includes('users:write');
  const seesRoles = permissions.includes('roles:read');
  // Inviting and changing a role pick from the role list, so they need both.
  const mayPickRole = mayWrite && seesRoles;
  const roles = useApiQuery(listRoles, {}, { enabled: seesRoles }).data?.roles ?? [];
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
      ...(u.status === 'disabled' || !mayPickRole ? [] : [{ label: t('admin.users.role.change'), onSelect: act('role') }]),
      ...(u.status === 'invited' ? [{ label: t('admin.users.resend'), onSelect: act('resend') }] : []),
      ...(u.status === 'active' ? [{ label: t('admin.users.endSessions'), onSelect: act('sessions') }] : []),
      u.status === 'disabled'
        ? { label: t('admin.users.reactivate'), onSelect: act('reactivate') }
        : { label: t('admin.users.deactivate'), onSelect: act('deactivate') },
    ];
  };

  const columns: Column<AdminUser>[] = [
    { id: 'name', header: t('admin.users.col.name'), cell: (u) => (u.self ? t('admin.users.you', { name: u.displayName }) : u.displayName) },
    // Masked without pii:read (RAD-103): "Hidden" to a screen reader, never the bullets.
    { id: 'email', header: t('admin.users.col.email'), cell: (u) => <Pii value={u.email} /> },
    ...(seesRoles ? [{ id: 'role', header: t('admin.users.col.role'), cell: (u: AdminUser) => roleName(u.role) }] : []),
    { id: 'status', header: t('admin.users.col.status'), cell: (u) => t(`admin.users.status.${u.status}`) },
    { id: 'factor', header: t('admin.users.col.factor'), cell: (u) => t(`admin.users.factor.${u.secondFactor}`) },
    // Your own row has no actions: nobody changes their own role or account here (M1-18). No column at all without
    // users:write, since every action is a write.
    ...(mayWrite ? [{ id: 'actions', header: t('admin.users.col.actions'), cell: (u: AdminUser) => (u.self ? null
      : <Menu label={t('admin.users.actionsFor', { name: u.displayName })} items={actions(u)} />) }] : []),
  ];

  const user = acting?.user;
  const name = user?.displayName ?? '';
  return (
    <>
      <h1>{t('admin.users.title')}</h1>
      <div className="admin-toolbar">
        <SearchBox label={t('admin.users.search')} action={t('admin.audit.apply')} onSearch={setSearch} />
        {mayPickRole ? (
          <button type="button" className="kit-button kit-button-primary" onClick={() => setInviting(true)}>
            {t('admin.users.invite')}
          </button>
        ) : null}
      </div>
      <ChoiceButtons<Show> label={t('admin.users.status')} value={show} onChange={setShow} options={[
        { value: 'all', label: t('admin.users.status.all') }, { value: 'active', label: t('admin.users.status.active') },
        { value: 'invited', label: t('admin.users.status.invited') }, { value: 'disabled', label: t('admin.users.status.disabled') },
      ]} />
      <DataTable caption={t('admin.users.title')} columns={columns} rowKey={(u) => u.id} list={list} empty={t('admin.users.empty')} />

      <Dialog open={inviting} onOpenChange={setInviting} title={t('admin.users.invite.title')} description={t('admin.users.invite.hint')}>
        <Form schema={inviteUser.input.extend({ role: z.string().min(1, t('admin.users.invite.pickRole')) })}
          defaultValues={{ email: '', displayName: '', role: '' }} saved={false} messages={MESSAGES}
          onSubmit={async (v) => {
            await invite.submit(v);
            setInviting(false);
            later(t('admin.users.invite.sent', { email: v.email }));
          }}>
          <TextField name="email" label={t('admin.users.invite.email')} type="email" autoComplete="off" />
          <TextField name="displayName" label={t('admin.users.invite.name')} autoComplete="off" />
          <RadioField name="role" label={t('admin.users.invite.role')} options={roleOptions(roles)} />
          <div className="kit-actions">
            <CloseButton>{t('admin.cancel')}</CloseButton>
            <SubmitButton>{t('admin.users.invite.send')}</SubmitButton>
          </div>
        </Form>
      </Dialog>

      <Dialog open={acting?.kind === 'role'} onOpenChange={close} title={t('admin.users.role.title', { name })}
        description={t('admin.users.role.hint')}>
        {user === undefined ? null : (
          <Form schema={setUserRole.input.pick({ role: true, reason: true })} saved={false} messages={MESSAGES}
            defaultValues={{ role: user.role, reason: '' }}
            onSubmit={async (v) => {
              await changeRole.submit({ id: user.id, ...v });
              setActing(null);
              later(t('admin.users.role.done', { name, role: roleName(v.role) }));
            }}>
            <RadioField name="role" label={t('admin.users.invite.role')} options={roleOptions(roles)} />
            <TextAreaField name="reason" label={t('admin.reason')} />
            <div className="kit-actions">
              <CloseButton>{t('admin.cancel')}</CloseButton>
              <SubmitButton>{t('admin.users.role.save')}</SubmitButton>
            </div>
          </Form>
        )}
      </Dialog>

      <ReasonDialog open={acting?.kind === 'deactivate'} onOpenChange={close} messages={MESSAGES}
        title={t('admin.users.deactivate.title', { name })} action={t('admin.users.deactivate')}
        done={t('admin.users.deactivate.done', { name })}
        onConfirm={(reason) => deactivate.submit({ id: user?.id ?? '', reason })} />
      <ReasonDialog open={acting?.kind === 'reactivate'} onOpenChange={close} messages={MESSAGES}
        title={t('admin.users.reactivate.title', { name })} action={t('admin.users.reactivate')}
        done={t('admin.users.reactivate.done', { name })}
        onConfirm={(reason) => reactivate.submit({ id: user?.id ?? '', reason })} />
      <ConfirmDialog open={acting?.kind === 'resend'} onOpenChange={close}
        title={t('admin.users.resend.title', { name })} body={t('admin.users.resend.body')} action={t('admin.users.resend')}
        done={t('admin.users.resent', { name })} onConfirm={async () => { await resend.submit({ id: user?.id ?? '' }); }} />
      <ConfirmDialog open={acting?.kind === 'sessions'} onOpenChange={close}
        title={t('admin.users.endSessions.title', { name })} body={t('admin.users.endSessions.body')}
        action={t('admin.users.endSessions.confirm')} done=""
        onConfirm={async () => {
          const { ended } = await signOut.submit({ id: user?.id ?? '' });
          return t('admin.users.endSessions.done', { name, count: String(ended) });
        }} />
    </>
  );
}
