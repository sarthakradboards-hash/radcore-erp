'use client';
// Roles (RAD-57, M1-17; custom roles RAD-83): every role, built-in or made here, who holds it, and whether it needs
// the second factor (D-19). A new role starts blank or as a copy of another; each role's own page renames, resets or
// deletes it and sets what it may do. The server decides what may be given (only what you hold) and refuses the rest.
import { createRole, getPermissionMatrix, listRoles } from '@radcore/lib-platform/contract';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { z } from 'zod';
import { useMe } from '../../../../components/shell/session-provider.tsx';
import { CloseButton, Dialog } from '../../../../components/ui/dialog/dialog.tsx';
import { RadioField, TextAreaField, TextField } from '../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../components/ui/form/form.tsx';
import { announce } from '../../../../components/ui/live-region.tsx';
import { DataTable, type Column } from '../../../../components/ui/table/data-table.tsx';
import { useApiMutation, useApiQuery } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { MESSAGES } from '../shared.tsx';
import type { Role } from '../types.ts';

const columns: Column<Role>[] = [
  { id: 'name', header: t('admin.roles.col.name'), cell: (r) => <Link href={`/admin/roles/${r.key}`}>{r.name}</Link> },
  { id: 'kind', header: t('admin.roles.col.kind'), cell: (r) => t(r.builtIn ? 'admin.roles.kind.builtIn' : 'admin.roles.kind.custom') },
  { id: 'description', header: t('admin.roles.col.description'), cell: (r) => r.description },
  { id: 'people', header: t('admin.roles.col.people'), cell: (r) => r.userCount, numeric: true },
  { id: 'factor', header: t('admin.roles.col.factor'),
    cell: (r) => t(r.secondFactorRequired ? 'admin.roles.factor.required' : 'admin.roles.factor.optional') },
];

// "Blank" is the empty choice; the contract takes no copyFrom for it.
const schema = createRole.input.extend({ copyFrom: z.string() });

export default function RolesPage() {
  const q = useApiQuery(listRoles, {});
  const roles = q.data?.roles ?? [];
  const mayCreate = useMe().permissions.includes('roles:write');
  const [creating, setCreating] = useState(false);
  const create = useApiMutation(createRole, { invalidates: [listRoles, getPermissionMatrix] });
  const router = useRouter();

  return (
    <>
      <h1>{t('admin.roles.title')}</h1>
      <p>{t('admin.roles.intro')}</p>
      {mayCreate ? (
        <div className="admin-toolbar">
          <button type="button" className="kit-button kit-button-primary" onClick={() => setCreating(true)}>{t('admin.roles.new')}</button>
        </div>
      ) : null}
      <DataTable caption={t('admin.roles.title')} columns={columns} rowKey={(r) => r.key} list={{
        items: roles, hasNextPage: false, fetchNextPage: () => undefined, isFetchingNextPage: false,
        isPending: q.isPending, error: q.error, refetch: () => void q.refetch(),
      }} />

      <Dialog open={creating} onOpenChange={setCreating} title={t('admin.roles.new.title')} description={t('admin.roles.new.hint')}>
        <Form schema={schema} defaultValues={{ name: '', description: '', copyFrom: '', reason: '' }} saved={false} messages={MESSAGES}
          onSubmit={async ({ copyFrom, ...v }) => {
            const { key, droppedKeys } = await create.submit({ ...v, ...(copyFrom === '' ? {} : { copyFrom }) });
            setCreating(false);
            setTimeout(() => announce(t(droppedKeys.length === 0 ? 'admin.roles.created' : 'admin.roles.created.dropped', { role: v.name })), 0);
            // A copy leaves out keys kept for named roles (pay); the role's page names them (the architect on RAD-83).
            const dropped = droppedKeys.join(',');
            router.push(`/admin/roles/${key}${dropped === '' ? '' : `?dropped=${encodeURIComponent(dropped)}`}`);
          }}>
          <TextField name="name" label={t('admin.roles.name')} autoComplete="off" />
          <TextAreaField name="description" label={t('admin.roles.description')} />
          <RadioField name="copyFrom" label={t('admin.roles.from')} options={[
            { value: '', label: t('admin.roles.from.blank'), detail: t('admin.roles.from.blank.detail') },
            ...roles.map((r) => ({ value: r.key, label: t('admin.roles.from.copy', { role: r.name }), detail: r.description })),
          ]} />
          <TextAreaField name="reason" label={t('admin.reason')} />
          <div className="kit-actions">
            <CloseButton>{t('admin.cancel')}</CloseButton>
            <SubmitButton>{t('admin.roles.create')}</SubmitButton>
          </div>
        </Form>
      </Dialog>
    </>
  );
}
