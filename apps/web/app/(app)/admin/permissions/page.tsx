'use client';
// The permission matrix (RAD-57, M1-18): every role side by side, permissions grouped by module. Read-only since
// RAD-83: a role's permissions are changed on its own page (roles/[key]), grouped by screen, so there is one editor.
// The server marks which roles may be changed (`editable`: never admin, never your own role).
import { getPermissionMatrix } from '@radcore/lib-platform/contract';
import Link from 'next/link';
import { useId } from 'react';
import { useMe } from '../../../../components/shell/session-provider.tsx';
import { useApiQuery } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import type { Matrix } from '../types.ts';
import '../../../../components/ui/table/table.css';

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
  const mayChange = useMe().permissions.includes('roles:write');
  const m = q.data;

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
                          : mayChange ? (
                            <Link href={`/admin/roles/${r.key}`} className="kit-button" aria-label={t('admin.perms.edit', { role: r.name })}>
                              {t('admin.perms.edit.short')}
                            </Link>
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
                      {m.roles.map((r) => (
                        <td key={r.key}>
                          <input type="checkbox" checked={r.grants.includes(p.key)} disabled readOnly
                            aria-label={t('admin.perms.grant', { role: r.name, permission: p.label })} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        </div>
      )}
    </>
  );
}
