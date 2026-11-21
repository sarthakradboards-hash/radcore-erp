'use client';
// Settings (RAD-133 on RAD-132's contract, ADR-001 §8c): each one with what it does, its value now, its default, and who
// last changed it. settings:read sees them; settings:write (which the server grants only with the second factor) changes
// one with a reason, or puts it back to its default. No setting is dated: a change applies from the next request and
// never rewrites what's already posted, which the page says once, above the list.
import { formatMoment } from '@radcore/lib-common';
import { listSettings } from '@radcore/lib-platform/contract';
import { useId, useState } from 'react';
import { useMe } from '../../../../components/shell/session-provider.tsx';
import { Menu } from '../../../../components/ui/dialog/menu.tsx';
import { useApiQuery } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import '../../../../components/ui/table/table.css';
import type { Setting } from './types.ts';
import { EditSetting, ResetSetting } from './edit.tsx';
import { SettingValue } from './value.tsx';

const who = (p: Setting['changedBy']) => (p === null ? '' : p.displayName ?? t('admin.audit.unknown'));

export default function SettingsPage() {
  const captionId = useId();
  const mayWrite = useMe().permissions.includes('settings:write');
  const q = useApiQuery(listSettings, {});
  const [editing, setEditing] = useState<Setting | null>(null);
  const [resetting, setResetting] = useState<Setting | null>(null);
  const rows = q.data?.settings;

  if (q.error !== null) return <p role="alert" className="kit-form-alert">{t('error.title')}</p>;
  if (rows === undefined) return <p>{t('loading')}</p>;

  return (
    <>
      <h1>{t('admin.settings.title')}</h1>
      <p>{t('admin.settings.intro')}</p>
      <div className="kit-table">
        <div className="kit-table-scroll" role="region" aria-labelledby={captionId} tabIndex={0}>
          <table>
            <caption id={captionId}>{t('admin.settings.title')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('admin.settings.col.setting')}</th>
                <th scope="col">{t('admin.settings.col.value')}</th>
                <th scope="col">{t('admin.settings.col.default')}</th>
                <th scope="col">{t('admin.settings.col.changed')}</th>
                {mayWrite ? <th scope="col">{t('admin.users.col.actions')}</th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.key}>
                  <td><strong>{s.label}</strong><br />{s.description}</td>
                  <td><SettingValue input={s.input} value={s.value} /></td>
                  <td><SettingValue input={s.input} value={s.default} /></td>
                  <td>{s.changed && s.changedAt !== null ? t('admin.settings.changedBy', { who: who(s.changedBy), when: formatMoment(s.changedAt) }) : t('admin.settings.neverChanged')}</td>
                  {mayWrite ? (
                    <td>
                      <Menu label={t('admin.settings.actionsFor', { name: s.label })} items={[
                        { label: t('admin.settings.change'), onSelect: () => setEditing(s) },
                        { label: t('admin.settings.reset'), onSelect: () => setResetting(s), disabled: !s.changed },
                      ]} />
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <EditSetting setting={editing} onClose={() => setEditing(null)} />
      <ResetSetting setting={resetting} onClose={() => setResetting(null)} />
    </>
  );
}
