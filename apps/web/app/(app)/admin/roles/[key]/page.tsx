'use client';
// One role (RAD-83): rename it, reset a built-in role to its template, delete one made here, and set what it may do,
// grouped by screen (Sarthak, 14 Nov: a role gets a screen by holding the key that opens it). Every change takes a
// typed reason. The server decides: `editable` (never admin, never your own role), only what you hold yourself, the
// signed-in basics kept, pay for admin and owner only; the screen greys out what it can tell and words every refusal.
import {
  deleteRole, getPermissionMatrix, listRoles, resetRole, setRolePermissions, updateRole,
} from '@radcore/lib-platform/contract';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useMe } from '../../../../../components/shell/session-provider.tsx';
import { CloseButton, Dialog } from '../../../../../components/ui/dialog/dialog.tsx';
import { ReasonDialog } from '../../../../../components/ui/dialog/reason-dialog.tsx';
import { TextAreaField, TextField } from '../../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../../components/ui/form/form.tsx';
import { announce } from '../../../../../components/ui/live-region.tsx';
import { ApiError } from '../../../../../lib/api-client.ts';
import { useApiMutation, useApiQuery } from '../../../../../lib/api/query.ts';
import { t } from '../../../../../lib/i18n/index.ts';
import { MESSAGES } from '../../shared.tsx';
import { byScreen } from '../by-screen.ts';
import { flip, withEdits, type GrantEdits } from '../grant-edits.ts';

type Acting = 'rename' | 'reset' | 'delete' | 'save';
// Rename and delete are refused when the role holds a key you don't (#142): not "give", so their own words.
const WHOLE_ROLE = { ...MESSAGES, permission_not_held: t('admin.roles.notHeld') };
const renameSchema = updateRole.input.pick({ name: true, description: true, reason: true }).required({ name: true, description: true });

export default function RolePage() {
  const { key } = useParams<{ key: string }>();
  // Keys a copy left out (?dropped=, set by New role); only keys the matrix lists are shown, so a made-up URL says nothing.
  const dropped = (useSearchParams().get('dropped') ?? '').split(',');
  const me = useMe();
  const roles = useApiQuery(listRoles, {});
  const matrix = useApiQuery(getPermissionMatrix, {});
  const refresh = { invalidates: [listRoles, getPermissionMatrix] };
  const rename = useApiMutation(updateRole, refresh);
  const reset = useApiMutation(resetRole, refresh);
  const remove = useApiMutation(deleteRole, refresh);
  const save = useApiMutation(setRolePermissions, refresh);
  const router = useRouter();
  const [acting, setActing] = useState<Acting | null>(null);
  const [edits, setEdits] = useState<GrantEdits>(new Map());
  const close = (open: boolean) => { if (!open) setActing(null); };

  const error = roles.error ?? matrix.error;
  if (error !== null) {
    return (
      <div role="alert" className="kit-form-alert">
        {t('error.title')}{' '}
        <button type="button" className="kit-button" onClick={() => { void roles.refetch(); void matrix.refetch(); }}>{t('error.retry')}</button>
      </div>
    );
  }
  const m = matrix.data;
  if (roles.data === undefined || m === undefined) return <p>{t('loading')}</p>;
  const role = roles.data.roles.find((r) => r.key === key);
  const grants = m.roles.find((r) => r.key === key);
  if (role === undefined || grants === undefined) {
    return (
      <>
        <h1>{t('admin.roles.title')}</h1>
        <p>{t('admin.roles.missing')}</p>
        <p><Link href="/admin/roles">{t('admin.roles.back')}</Link></p>
      </>
    );
  }

  const mayChange = grants.editable && me.permissions.includes('roles:write');
  const saved = new Set(grants.grants);
  const shown = withEdits(saved, edits);
  const changes = [...new Set([...saved, ...shown])].filter((k) => saved.has(k) !== shown.has(k)).length;
  const toggle = (permission: string) => setEdits(flip(saved, edits, permission));
  // Someone saved first: load their version; this person's ticks and unticks stay laid over it, to check and save again.
  const reloadIfStale = async (e: unknown) => {
    if (e instanceof ApiError && e.code === 'matrix_changed') await matrix.refetch();
    throw e;
  };
  const named = { role: role.name };

  return (
    <>
      <p><Link href="/admin/roles">{t('admin.roles.back')}</Link></p>
      <h1>{role.name}</h1>
      <dl className="admin-facts" aria-label={t('admin.roles.facts')}>
        <dt>{t('admin.roles.col.kind')}</dt><dd>{t(role.builtIn ? 'admin.roles.kind.builtIn' : 'admin.roles.kind.custom')}</dd>
        <dt>{t('admin.roles.col.description')}</dt><dd>{role.description}</dd>
        <dt>{t('admin.roles.col.people')}</dt><dd>{role.userCount === 1 ? t('admin.roles.people.one') : t('admin.roles.people', { count: String(role.userCount) })}</dd>
        <dt>{t('admin.roles.col.factor')}</dt>
        <dd>{t(role.secondFactorRequired ? 'admin.roles.factor.required' : 'admin.roles.factor.optional')}</dd>
      </dl>

      {mayChange ? (
        <div className="kit-actions admin-choices">
          <button type="button" className="kit-button" onClick={() => setActing('rename')}>{t('admin.roles.rename')}</button>
          {role.builtIn
            ? <button type="button" className="kit-button" onClick={() => setActing('reset')}>{t('admin.roles.reset')}</button>
            : <button type="button" className="kit-button kit-button-danger" onClick={() => setActing('delete')}>{t('admin.roles.delete')}</button>}
        </div>
      ) : <p>{t('admin.roles.locked')}</p>}
      {mayChange && !role.builtIn && role.userCount > 0 ? <p className="kit-field-hint">{t('admin.roles.delete.inUse')}</p> : null}

      {m.permissions.some((p) => dropped.includes(p.key)) ? (
        <div className="admin-notice">
          <p>{t('admin.roles.dropped.title')}</p>
          <ul>
            {m.permissions.filter((p) => dropped.includes(p.key)).map((p) => (
              <li key={p.key}>{t('admin.roles.dropped.permission_not_for_role', { permission: p.label })}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <h2>{t('admin.roles.perms')}</h2>
      <p>{t('admin.roles.perms.hint')}</p>
      {byScreen(m.permissions).map((g) => (
        <fieldset key={g.permissions[0]?.key} className="admin-group">
          <legend>{g.screens.length > 0
            ? t('admin.roles.perms.screen', { screens: g.screens.map((s) => t(s)).join(', ') })
            : t('admin.roles.perms.other', { module: g.module ?? '' })}</legend>
          {g.permissions.map((p, i) => {
            const held = me.permissions.includes(p.key);
            const opens = g.screens.length > 0 && i === 0;
            const hint = [opens ? t('admin.roles.perms.opens') : null, mayChange && !held ? t('admin.roles.perms.notHeld') : null]
              .filter((h) => h !== null).join('. ');
            const id = `grant-${p.key.replace(':', '-')}`;
            // The label is the permission alone; the hint is its description, outside the label so it's read once.
            return (
              <div key={p.key} className={`admin-grant${saved.has(p.key) !== shown.has(p.key) ? ' admin-changed' : ''}`}>
                <input id={id} type="checkbox" checked={shown.has(p.key)} disabled={!mayChange || !held} onChange={() => toggle(p.key)}
                  {...(hint === '' ? {} : { 'aria-describedby': `${id}-hint` })} />
                <span>
                  <label htmlFor={id}>{p.label}</label>
                  {hint === '' ? null : <><br /><span id={`${id}-hint`} className="kit-field-hint">{hint}</span></>}
                </span>
              </div>
            );
          })}
        </fieldset>
      ))}
      {mayChange ? (
        <>
          <p role="status">{changes === 0 ? '' : t('admin.roles.perms.changed', { count: String(changes) })}</p>
          <div className="kit-actions admin-choices">
            <button type="button" className="kit-button kit-button-primary" disabled={changes === 0} onClick={() => setActing('save')}>
              {t('admin.roles.perms.save')}
            </button>
            <button type="button" className="kit-button" disabled={changes === 0} onClick={() => setEdits(new Map())}>{t('admin.roles.perms.discard')}</button>
          </div>
        </>
      ) : null}

      <Dialog open={acting === 'rename'} onOpenChange={close} title={t('admin.roles.rename.title', named)} description={t('admin.roles.rename.hint')}>
        <Form schema={renameSchema} defaultValues={{ name: role.name, description: role.description, reason: '' }} saved={false} messages={WHOLE_ROLE}
          onSubmit={async (v) => {
            await rename.submit({ key: role.key, ...v });
            setActing(null);
            setTimeout(() => announce(t('admin.roles.renamed')), 0);
          }}>
          <TextField name="name" label={t('admin.roles.name')} autoComplete="off" />
          <TextAreaField name="description" label={t('admin.roles.description')} />
          <TextAreaField name="reason" label={t('admin.reason')} />
          <div className="kit-actions">
            <CloseButton>{t('admin.cancel')}</CloseButton>
            <SubmitButton>{t('admin.roles.rename.save')}</SubmitButton>
          </div>
        </Form>
      </Dialog>
      <ReasonDialog open={acting === 'save'} onOpenChange={close} messages={MESSAGES}
        title={t('admin.roles.perms.reason.title', named)} action={t('admin.roles.perms.save')} done={t('admin.roles.perms.saved', named)}
        onConfirm={async (reason) => {
          await save.submit({ key: role.key, grants: [...shown].sort(), version: m.version, reason }).catch(reloadIfStale);
          setEdits(new Map());
        }} />
      <ReasonDialog open={acting === 'reset'} onOpenChange={close} messages={MESSAGES}
        title={t('admin.roles.reset.title', named)} action={t('admin.roles.reset')} done={t('admin.roles.reset.done', named)}
        onConfirm={async (reason) => {
          await reset.submit({ key: role.key, version: m.version, reason }).catch(reloadIfStale);
          setEdits(new Map());
        }} />
      <ReasonDialog open={acting === 'delete'} onOpenChange={close} messages={WHOLE_ROLE}
        title={t('admin.roles.delete.title', named)} action={t('admin.roles.delete')} done={t('admin.roles.deleted', named)}
        onConfirm={async (reason) => {
          await remove.submit({ key: role.key, reason });
          router.push('/admin/roles');
        }} />
    </>
  );
}
