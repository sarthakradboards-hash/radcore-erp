'use client';
// The permission matrix (RAD-57, M1-18): permissions down the side, roles across. One role is changed at a time and
// saved with a reason, so each audit row is one role's change. The server marks which roles may be changed
// (`editable`: never admin, never your own role) and refuses the rest; a stale version is refused, not overwritten.
import { getPermissionMatrix, setRolePermissions } from '@radcore/lib-platform/contract';
import { useId, useState } from 'react';
import { ReasonDialog } from '../../../../components/ui/dialog/reason-dialog.tsx';
import { ApiError } from '../../../../lib/api-client.ts';
import { useApiMutation, useApiQuery } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { MESSAGES } from '../shared.tsx';
import type { Matrix } from '../types.ts';
import '../../../../components/ui/table/table.css';

type Editing = { key: string; name: string; grants: ReadonlySet<string> };

/** Permissions in the server's order, grouped by module. */
function byModule(permissions: Matrix['permissions']) {
  const groups: { module: string; permissions: Matrix['permissions'] }[] = [];
  for (const p of permissions) {
    const last = groups.at(-1);
    if (last?.module === p.module) last.permissions.push(p);
    else groups.push({ module: p.module, permissions: [p] });
  }
  return groups;
}

export default function PermissionsPage() {
  const captionId = useId();
  const q = useApiQuery(getPermissionMatrix, {});
  const save = useApiMutation(setRolePermissions, { invalidates: [getPermissionMatrix] });
  const [editing, setEditing] = useState<Editing | null>(null);
  const [asking, setAsking] = useState(false);
  const m = q.data;

  const toggle = (key: string) => setEditing((e) => {
    if (e === null) return e;
    const grants = new Set(e.grants);
    if (!grants.delete(key)) grants.add(key);
    return { ...e, grants };
  });

  const confirm = async (reason: string) => {
    if (m === undefined || editing === null) return;
    try {
      await save.submit({ key: editing.key, grants: [...editing.grants].sort(), version: m.version, reason });
      setEditing(null);
    } catch (e) {
      // Someone saved first: load their version, keep these ticks, and let the admin look again before saving.
      if (e instanceof ApiError && e.code === 'matrix_changed') await q.refetch();
      throw e;
    }
  };

  return (
    <>
      <h1>{t('admin.perms.title')}</h1>
      <p>{t('admin.perms.intro')}</p>
      {q.error === null ? null : (
        <div role="alert" className="kit-form-alert">
          {t('error.title')}{' '}
          <button type="button" className="kit-button" onClick={() => void q.refetch()}>{t('error.retry')}</button>
        </div>
      )}
      {m === undefined ? <p>{t('loading')}</p> : (
        <>
          <p role="status">{editing === null ? '' : t('admin.perms.editing', { role: editing.name })}</p>
          {editing === null ? null : (
            <div className="kit-actions admin-choices">
              <button type="button" className="kit-button kit-button-primary" onClick={() => setAsking(true)}>
                {t('admin.perms.save', { role: editing.name })}
              </button>
              <button type="button" className="kit-button" onClick={() => setEditing(null)}>{t('admin.perms.discard')}</button>
            </div>
          )}
          <div className="kit-table">
            <div className="kit-table-scroll" role="region" aria-labelledby={captionId} tabIndex={0}>
              <table className="admin-matrix">
                <caption id={captionId}>{t('admin.perms.caption')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t('admin.perms.col.permission')}</th>
                    {m.roles.map((r) => (
                      <th key={r.key} scope="col">
                        <span className="admin-matrix-head">
                          {r.name}
                          {!r.editable ? <span className="kit-field-hint">{t('admin.perms.locked')}</span>
                            : editing === null ? (
                              <button type="button" className="kit-button" aria-label={t('admin.perms.edit', { role: r.name })}
                                onClick={() => setEditing({ key: r.key, name: r.name, grants: new Set(r.grants) })}>
                                {t('admin.perms.edit.short')}
                              </button>
                            ) : null}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                {byModule(m.permissions).map((g) => (
                  <tbody key={g.module}>
                    <tr><th scope="rowgroup" colSpan={m.roles.length + 1}>{g.module}</th></tr>
                    {g.permissions.map((p) => (
                      <tr key={p.key}>
                        <th scope="row">{p.label}</th>
                        {m.roles.map((r) => {
                          const mine = editing?.key === r.key;
                          const held = r.grants.includes(p.key);
                          const checked = mine ? editing.grants.has(p.key) : held;
                          return (
                            <td key={r.key} className={mine && checked !== held ? 'admin-changed' : undefined}>
                              <input type="checkbox" checked={checked} disabled={!mine} onChange={() => toggle(p.key)}
                                aria-label={t('admin.perms.grant', { role: r.name, permission: p.label })} />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                ))}
              </table>
            </div>
          </div>
        </>
      )}
      <ReasonDialog open={asking} onOpenChange={setAsking} messages={MESSAGES} onConfirm={confirm}
        title={t('admin.perms.reason.title', { role: editing?.name ?? '' })} action={t('admin.perms.save', { role: editing?.name ?? '' })}
        done={t('admin.perms.saved', { role: editing?.name ?? '' })} />
    </>
  );
}
