'use client';
// Purchase order limits (RAD-143 on RAD-136's contracts, ADR-008 §5): the largest PO total, with GST, each role may place
// without someone else's approval, and the default for roles without their own (0 until set, so every PO is approved:
// Sarthak, 22 Nov). Kept beside the discount limits, as Sarthak wants per-role limits there. purchasing:read sees them;
// purchasing:approve sets one, with a reason. A role's empty box removes its own, so it follows the default again.
import { formatMoney } from '@radcore/lib-common';
import { listRoles } from '@radcore/lib-platform/contract';
import { listPurchaseOrderLimits, setPurchaseOrderLimit } from '@radcore/lib-purchasing/contract';
import { useId, useState } from 'react';
import { z } from 'zod';
import { useMe } from '../../../../components/shell/session-provider.tsx';
import { CloseButton, Dialog } from '../../../../components/ui/dialog/dialog.tsx';
import { SelectField, TextAreaField, TextField } from '../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../components/ui/form/form.tsx';
import { announce } from '../../../../components/ui/live-region.tsx';
import { useApiMutation, useApiQuery } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import '../../../../components/ui/table/table.css';
import { MESSAGES } from '../shared.tsx';

const later = (text: string) => setTimeout(() => announce(text), 0);
const limit = setPurchaseOrderLimit.input.shape;
const roleSchema = z.object({ maxTotal: z.string().trim().transform((s) => (s === '' ? null : s)).pipe(limit.maxTotal), reason: limit.reason });
const defaultSchema = z.object({ maxTotal: limit.maxTotal.unwrap(), reason: limit.reason });
const addSchema = z.object({ role: z.string().min(1, t('purchases.limits.pick')).pipe(limit.role.unwrap()), maxTotal: limit.maxTotal.unwrap(), reason: limit.reason });
const LIMIT_MESSAGES = { ...MESSAGES, unknown_role: t('purchases.limits.err.unknown_role') };

type Editing = { role: string | null; name: string; current: string };

export default function PurchaseOrderLimitsPage() {
  const captionId = useId();
  const { permissions } = useMe();
  const mayApprove = permissions.includes('purchasing:approve');
  const q = useApiQuery(listPurchaseOrderLimits, {});
  // Role names need roles:read; without it a role shows by its key, and only roles that have a limit can change.
  const roles = useApiQuery(listRoles, {}, { enabled: permissions.includes('roles:read') }).data?.roles ?? [];
  const set = useApiMutation(setPurchaseOrderLimit, { invalidates: [listPurchaseOrderLimits] });
  const [editing, setEditing] = useState<Editing | null>(null);
  const [adding, setAdding] = useState(false);
  const nameOf = (key: string) => roles.find((r) => r.key === key)?.name ?? key;
  const l = q.data;

  if (q.error !== null) return <p role="alert" className="kit-form-alert">{t('error.title')}</p>;
  if (l === undefined) return <p>{t('loading')}</p>;
  const unset = roles.filter((r) => !l.roles.some((x) => x.role === r.key));
  const rows: Editing[] = [
    { role: null, name: t('purchases.limits.default'), current: l.defaultMaxTotal },
    ...l.roles.map((r) => ({ role: r.role, name: nameOf(r.role), current: r.maxTotal })),
  ];
  const close = (open: boolean) => { if (!open) { setEditing(null); setAdding(false); } };

  return (
    <>
      <h1>{t('purchases.limits.title')}</h1>
      <p>{t('purchases.limits.intro')}</p>
      {mayApprove && unset.length > 0 ? (
        <div className="admin-toolbar">
          <button type="button" className="kit-button kit-button-primary" onClick={() => setAdding(true)}>{t('purchases.limits.add')}</button>
        </div>
      ) : null}
      <div className="kit-table">
        <div className="kit-table-scroll" role="region" aria-labelledby={captionId} tabIndex={0}>
          <table>
            <caption id={captionId}>{t('purchases.limits.title')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('purchases.limits.role')}</th>
                <th scope="col" className="kit-numeric">{t('purchases.limits.max')}</th>
                {mayApprove ? <th scope="col">{t('admin.users.col.actions')}</th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.role ?? ''}>
                  <td>{r.name}</td>
                  <td className="kit-numeric">{formatMoney(r.current)}</td>
                  {mayApprove ? (
                    <td>
                      <button type="button" className="kit-button" onClick={() => setEditing(r)}
                        aria-label={t('purchases.limits.changeFor', { name: r.name })}>{t('purchases.limits.change')}</button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={editing !== null} onOpenChange={close} title={t('purchases.limits.change.title', { name: editing?.name ?? '' })}
        description={t(editing?.role === null ? 'purchases.limits.change.default' : 'purchases.limits.change.role')}>
        {editing === null ? null : (
          <Form schema={editing.role === null ? defaultSchema : roleSchema} saved={false} messages={LIMIT_MESSAGES}
            defaultValues={{ maxTotal: editing.current, reason: '' }}
            onSubmit={async ({ maxTotal, reason }) => {
              await set.submit({ role: editing.role, maxTotal, reason });
              setEditing(null);
              later(maxTotal === null ? t('purchases.limits.cleared', { name: editing.name })
                : t('purchases.limits.set', { name: editing.name, max: formatMoney(maxTotal) }));
            }}>
            <TextField name="maxTotal" label={t('purchases.limits.max')} autoComplete="off" inputMode="decimal"
              hint={t(editing.role === null ? 'purchases.limits.max.hint' : 'purchases.limits.max.roleHint')} />
            <TextAreaField name="reason" label={t('admin.reason')} />
            <div className="kit-actions">
              <CloseButton>{t('admin.cancel')}</CloseButton>
              <SubmitButton>{t('purchases.limits.save')}</SubmitButton>
            </div>
          </Form>
        )}
      </Dialog>

      <Dialog open={adding} onOpenChange={close} title={t('purchases.limits.add')} description={t('purchases.limits.change.role')}>
        <Form schema={addSchema} saved={false} messages={LIMIT_MESSAGES} defaultValues={{ role: '', maxTotal: '', reason: '' }}
          onSubmit={async (v) => {
            await set.submit(v);
            setAdding(false);
            later(t('purchases.limits.set', { name: nameOf(v.role), max: formatMoney(v.maxTotal) }));
          }}>
          <SelectField name="role" label={t('purchases.limits.role')} placeholder={t('purchases.limits.pick')}
            options={unset.map((r) => ({ value: r.key, label: r.name }))} />
          <TextField name="maxTotal" label={t('purchases.limits.max')} autoComplete="off" inputMode="decimal" hint={t('purchases.limits.max.roleHint')} />
          <TextAreaField name="reason" label={t('admin.reason')} />
          <div className="kit-actions">
            <CloseButton>{t('admin.cancel')}</CloseButton>
            <SubmitButton>{t('purchases.limits.save')}</SubmitButton>
          </div>
        </Form>
      </Dialog>
    </>
  );
}
