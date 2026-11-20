'use client';
// Discount limits (RAD-99 on RAD-98's contracts): the most each role may take off a list price without a discount
// approval (M3), and the default for roles without their own. prices:read sees them. Raising one lets a role discount
// without approval, so only prices:approve (which the server grants only with the second factor) sets one, with a reason.
import { listRoles } from '@radcore/lib-platform/contract';
import { listDiscountLimits, setDiscountLimit } from '@radcore/lib-sales/contract';
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
import { asWritten } from '../decimal.ts';
import { MESSAGES } from '../shared.tsx';

const percent = (p: string) => `${asWritten(p)}%`; // "10.000000" reads 10%
const later = (text: string) => setTimeout(() => announce(text), 0);
const limit = setDiscountLimit.input.shape;
// A role's empty box clears its own limit, so it follows the default again; the default always has one.
const roleSchema = z.object({ maxPercent: z.string().trim().transform((s) => (s === '' ? null : s)).pipe(limit.maxPercent), reason: limit.reason });
const defaultSchema = z.object({ maxPercent: limit.maxPercent.unwrap(), reason: limit.reason });
const addSchema = z.object({ role: limit.role.unwrap(), maxPercent: limit.maxPercent.unwrap(), reason: limit.reason });
const LIMIT_MESSAGES = { ...MESSAGES, unknown_role: t('admin.discounts.err.unknown_role') };

type Editing = { role: string | null; name: string; current: string };

export default function DiscountLimitsPage() {
  const captionId = useId();
  const { permissions } = useMe();
  const mayApprove = permissions.includes('prices:approve');
  const q = useApiQuery(listDiscountLimits, {});
  // Role names need roles:read; without it a role shows by its key, and only roles that have a limit can change.
  const roles = useApiQuery(listRoles, {}, { enabled: permissions.includes('roles:read') }).data?.roles ?? [];
  const set = useApiMutation(setDiscountLimit, { invalidates: [listDiscountLimits] });
  const [editing, setEditing] = useState<Editing | null>(null);
  const [adding, setAdding] = useState(false);
  const nameOf = (key: string) => roles.find((r) => r.key === key)?.name ?? key;
  const l = q.data;

  if (q.error !== null) return <p role="alert" className="kit-form-alert">{t('error.title')}</p>;
  if (l === undefined) return <p>{t('loading')}</p>;
  const unset = roles.filter((r) => !l.roles.some((x) => x.role === r.key));
  const rows: Editing[] = [
    { role: null, name: t('admin.discounts.default'), current: l.default },
    ...l.roles.map((r) => ({ role: r.role, name: nameOf(r.role), current: r.maxPercent })),
  ];
  const close = (open: boolean) => { if (!open) { setEditing(null); setAdding(false); } };

  return (
    <>
      <h1>{t('admin.discounts.title')}</h1>
      <p>{t('admin.discounts.intro')}</p>
      {mayApprove && unset.length > 0 ? (
        <div className="admin-toolbar">
          <button type="button" className="kit-button kit-button-primary" onClick={() => setAdding(true)}>{t('admin.discounts.add')}</button>
        </div>
      ) : null}
      <div className="kit-table">
        <div className="kit-table-scroll" role="region" aria-labelledby={captionId} tabIndex={0}>
          <table>
            <caption id={captionId}>{t('admin.discounts.title')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('admin.discounts.role')}</th>
                <th scope="col" className="kit-numeric">{t('admin.discounts.max')}</th>
                {mayApprove ? <th scope="col">{t('admin.users.col.actions')}</th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.role ?? ''}>
                  <td>{r.name}</td>
                  <td className="kit-numeric">{percent(r.current)}</td>
                  {mayApprove ? (
                    <td>
                      <button type="button" className="kit-button" onClick={() => setEditing(r)}
                        aria-label={t('admin.discounts.changeFor', { name: r.name })}>{t('admin.discounts.change')}</button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={editing !== null} onOpenChange={close} title={t('admin.discounts.change.title', { name: editing?.name ?? '' })}
        description={t(editing?.role === null ? 'admin.discounts.change.default' : 'admin.discounts.change.role')}>
        {editing === null ? null : (
          <Form schema={editing.role === null ? defaultSchema : roleSchema} saved={false} messages={LIMIT_MESSAGES}
            defaultValues={{ maxPercent: asWritten(editing.current), reason: '' }}
            onSubmit={async ({ maxPercent, reason }) => {
              await set.submit({ role: editing.role, maxPercent, reason });
              setEditing(null);
              later(maxPercent === null ? t('admin.discounts.cleared', { name: editing.name })
                : t('admin.discounts.set', { name: editing.name, max: percent(maxPercent) }));
            }}>
            <TextField name="maxPercent" label={t('admin.discounts.max')} autoComplete="off" inputMode="decimal"
              hint={t(editing.role === null ? 'admin.discounts.max.hint' : 'admin.discounts.max.roleHint')} />
            <TextAreaField name="reason" label={t('admin.reason')} />
            <div className="kit-actions">
              <CloseButton>{t('admin.cancel')}</CloseButton>
              <SubmitButton>{t('admin.discounts.save')}</SubmitButton>
            </div>
          </Form>
        )}
      </Dialog>

      <Dialog open={adding} onOpenChange={close} title={t('admin.discounts.add')} description={t('admin.discounts.change.role')}>
        <Form schema={addSchema} saved={false} messages={LIMIT_MESSAGES} defaultValues={{ role: '', maxPercent: '', reason: '' }}
          onSubmit={async (v) => {
            await set.submit(v);
            setAdding(false);
            later(t('admin.discounts.set', { name: nameOf(v.role), max: percent(v.maxPercent) }));
          }}>
          <SelectField name="role" label={t('admin.discounts.role')} placeholder={t('admin.discounts.pick')}
            options={unset.map((r) => ({ value: r.key, label: r.name }))} />
          <TextField name="maxPercent" label={t('admin.discounts.max')} hint={t('admin.discounts.max.hint')} inputMode="decimal" autoComplete="off" />
          <TextAreaField name="reason" label={t('admin.reason')} />
          <div className="kit-actions">
            <CloseButton>{t('admin.cancel')}</CloseButton>
            <SubmitButton>{t('admin.discounts.save')}</SubmitButton>
          </div>
        </Form>
      </Dialog>
    </>
  );
}
