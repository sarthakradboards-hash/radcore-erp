'use client';
// Price lists (RAD-99 on RAD-98's contracts): every list a page at a time, with the version in force (approved by
// someone other than its maker, RAD-38) and whether a draft is waiting. prices:write adds a list (it starts as an empty
// draft), renames one, and switches one off or back on; none of these changes a price, so none needs approval.
// The rates, the draft and the approval queue live on their own pages.
import { formatMoment } from '@radcore/lib-common';
import { createPriceList, listPriceLists, updatePriceList } from '@radcore/lib-sales/contract';
import { useState } from 'react';
import { z } from 'zod';
import { useMe } from '../../../../components/shell/session-provider.tsx';
import { CloseButton, Dialog } from '../../../../components/ui/dialog/dialog.tsx';
import { Menu, type MenuItem } from '../../../../components/ui/dialog/menu.tsx';
import { CheckboxField, TextField } from '../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../components/ui/form/form.tsx';
import { SearchBox } from '../../../../components/ui/form/search-box.tsx';
import { announce } from '../../../../components/ui/live-region.tsx';
import { DataTable, type Column } from '../../../../components/ui/table/data-table.tsx';
import { useApiList, useApiMutation } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { ChoiceButtons, ConfirmDialog, MESSAGES } from '../shared.tsx';
import type { PriceList } from '../types.ts';

type Show = 'active' | 'inactive' | 'all';
type Acting = { kind: 'add' } | { kind: 'rename' | 'toggle'; list: PriceList };
const later = (text: string) => setTimeout(() => announce(text), 0);
const renameSchema = z.object({ name: createPriceList.input.shape.name });
// name_taken here is a price list's, not the role screen's wording that MESSAGES carries.
const LIST_MESSAGES = { ...MESSAGES, name_taken: t('admin.prices.err.name_taken') };

export default function PriceListsPage() {
  const mayWrite = useMe().permissions.includes('prices:write');
  const [search, setSearch] = useState('');
  const [show, setShow] = useState<Show>('active');
  const list = useApiList(listPriceLists, {
    filter: { ...(search === '' ? {} : { search }), ...(show === 'all' ? {} : { status: show }) },
  });
  const [acting, setActing] = useState<Acting | null>(null);
  const close = (open: boolean) => { if (!open) setActing(null); };
  const refresh = { invalidates: [listPriceLists] };
  const add = useApiMutation(createPriceList, refresh);
  const update = useApiMutation(updatePriceList, refresh);

  const actions = (l: PriceList): MenuItem[] => [
    { label: t('admin.prices.rename'), onSelect: () => setActing({ kind: 'rename', list: l }) },
    { label: t(l.active ? 'admin.locations.switchOff' : 'admin.locations.switchOn'), onSelect: () => setActing({ kind: 'toggle', list: l }) },
  ];
  const columns: Column<PriceList>[] = [
    { id: 'name', header: t('admin.prices.name'), cell: (l) => l.name },
    { id: 'inForce', header: t('admin.prices.inForce'),
      cell: (l) => (l.inForce === null ? t('admin.prices.notApproved') : t('admin.prices.since', { when: formatMoment(l.inForce.approvedAt) })) },
    { id: 'tax', header: t('admin.prices.tax'),
      cell: (l) => (l.inForce === null ? '' : t(l.inForce.taxInclusive ? 'admin.prices.tax.inclusive' : 'admin.prices.tax.exclusive')) },
    { id: 'draft', header: t('admin.prices.draft'), cell: (l) => t(l.draftId === null ? 'admin.prices.draft.none' : 'admin.prices.draft.open') },
    { id: 'status', header: t('admin.locations.col.status'), cell: (l) => t(l.active ? 'admin.locations.active' : 'admin.locations.inactive') },
    ...(mayWrite ? [{ id: 'actions', header: t('admin.users.col.actions'),
      cell: (l: PriceList) => <Menu label={t('admin.prices.actionsFor', { name: l.name })} items={actions(l)} /> }] : []),
  ];
  const target = acting?.kind === 'rename' || acting?.kind === 'toggle' ? acting.list : undefined;

  return (
    <>
      <h1>{t('admin.prices.title')}</h1>
      <p>{t('admin.prices.intro')}</p>
      <div className="admin-toolbar">
        <SearchBox label={t('admin.prices.search')} action={t('admin.audit.apply')} onSearch={setSearch} />
        {mayWrite ? (
          <button type="button" className="kit-button kit-button-primary" onClick={() => setActing({ kind: 'add' })}>{t('admin.prices.add')}</button>
        ) : null}
      </div>
      <ChoiceButtons<Show> label={t('admin.locations.col.status')} value={show} onChange={setShow} options={[
        { value: 'active', label: t('admin.locations.active') }, { value: 'inactive', label: t('admin.locations.inactive') },
        { value: 'all', label: t('admin.locations.all') },
      ]} />
      <DataTable caption={t('admin.prices.title')} columns={columns} rowKey={(l) => l.id} list={list} empty={t('admin.prices.empty')} />

      <Dialog open={acting?.kind === 'add'} onOpenChange={close} title={t('admin.prices.add')} description={t('admin.prices.add.hint')}>
        <Form schema={createPriceList.input} saved={false} messages={LIST_MESSAGES} defaultValues={{ name: '', taxInclusive: true }}
          onSubmit={async (v) => {
            await add.submit(v);
            setActing(null);
            later(t('admin.prices.added', { name: v.name }));
          }}>
          <TextField name="name" label={t('admin.prices.name')} autoComplete="off" />
          <CheckboxField name="taxInclusive" label={t('admin.prices.taxInclusive')} hint={t('admin.prices.taxInclusive.hint')} />
          <div className="kit-actions">
            <CloseButton>{t('admin.cancel')}</CloseButton>
            <SubmitButton>{t('admin.prices.add')}</SubmitButton>
          </div>
        </Form>
      </Dialog>

      <Dialog open={acting?.kind === 'rename'} onOpenChange={close} title={t('admin.prices.rename.title', { name: target?.name ?? '' })}>
        {target === undefined ? null : (
          <Form schema={renameSchema} saved={false} messages={LIST_MESSAGES} defaultValues={{ name: target.name }}
            onSubmit={async ({ name }) => {
              await update.submit({ id: target.id, name });
              setActing(null);
              later(t('admin.prices.renamed', { name }));
            }}>
            <TextField name="name" label={t('admin.prices.name')} autoComplete="off" />
            <div className="kit-actions">
              <CloseButton>{t('admin.cancel')}</CloseButton>
              <SubmitButton>{t('admin.prices.rename')}</SubmitButton>
            </div>
          </Form>
        )}
      </Dialog>

      <ConfirmDialog open={acting?.kind === 'toggle'} onOpenChange={close}
        title={t(target?.active === true ? 'admin.prices.switchOff.title' : 'admin.prices.switchOn.title', { name: target?.name ?? '' })}
        body={t(target?.active === true ? 'admin.prices.switchOff.body' : 'admin.prices.switchOn.body')}
        action={t(target?.active === true ? 'admin.locations.switchOff' : 'admin.locations.switchOn')}
        done={t(target?.active === true ? 'admin.prices.switchedOff' : 'admin.prices.switchedOn', { name: target?.name ?? '' })}
        onConfirm={async () => { if (target !== undefined) await update.submit({ id: target.id, active: !target.active }); }} />
    </>
  );
}
