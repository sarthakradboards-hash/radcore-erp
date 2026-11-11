'use client';
// Roles (RAD-57, M1-17): the eleven roles, who holds them, and which need the second factor (D-19). Read-only: a
// person's role is changed on People, and what a role may do on Permissions.
import { listRoles } from '@radcore/lib-platform/contract';
import type { Role } from '../types.ts';
import { DataTable, type Column } from '../../../../components/ui/table/data-table.tsx';
import { useApiQuery } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';

const columns: Column<Role>[] = [
  { id: 'name', header: t('admin.roles.col.name'), cell: (r) => r.name },
  { id: 'description', header: t('admin.roles.col.description'), cell: (r) => r.description },
  { id: 'people', header: t('admin.roles.col.people'), cell: (r) => r.userCount, numeric: true },
  { id: 'factor', header: t('admin.roles.col.factor'),
    cell: (r) => t(r.secondFactorRequired ? 'admin.roles.factor.required' : 'admin.roles.factor.optional') },
];

export default function RolesPage() {
  const q = useApiQuery(listRoles, {});
  return (
    <>
      <h1>{t('admin.roles.title')}</h1>
      <p>{t('admin.roles.intro')}</p>
      <DataTable caption={t('admin.roles.title')} columns={columns} rowKey={(r) => r.key} list={{
        items: q.data?.roles ?? [], hasNextPage: false, fetchNextPage: () => undefined, isFetchingNextPage: false,
        isPending: q.isPending, error: q.error, refetch: () => void q.refetch(),
      }} />
    </>
  );
}
