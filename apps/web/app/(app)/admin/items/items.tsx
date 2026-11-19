'use client';
// Items (RAD-99 on RAD-89's contracts): every item a page at a time, as a list or as cards with the first picture
// (the choice is saved per device, RC-218), searched by name, SKU or barcode, and filtered by in use or switched off.
// items:write adds an item and keeps the categories. Each item's own page shows and edits the rest.
import {
  createItem, createItemCategory, listItemCategories, listItems, listUnitsOfMeasure, renameItemCategory,
} from '@radcore/lib-stock/contract';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useMe } from '../../../../components/shell/session-provider.tsx';
import { CloseButton, Dialog } from '../../../../components/ui/dialog/dialog.tsx';
import { TextField } from '../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../components/ui/form/form.tsx';
import { SearchBox } from '../../../../components/ui/form/search-box.tsx';
import { announce } from '../../../../components/ui/live-region.tsx';
import { DataTable, type Column } from '../../../../components/ui/table/data-table.tsx';
import { useSavedView } from '../../../../components/ui/table/saved-view.ts';
import { useApiList, useApiMutation, useApiQuery } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { ChoiceButtons, MESSAGES } from '../shared.tsx';
import type { ItemCategory, StockItem } from '../types.ts';
import { ItemFields, newItemSchema } from './item-fields.tsx';
import { ITEM_VIEWS, type ItemView } from './views.ts';

type Show = 'active' | 'inactive' | 'all';
type Acting = { kind: 'add' } | { kind: 'category'; category: ItemCategory | null };
const later = (text: string) => setTimeout(() => announce(text), 0);
const categorySchema = createItemCategory.input;
// name_taken here is a category's, not the role screen's wording that MESSAGES carries.
const CATEGORY_MESSAGES = { ...MESSAGES, name_taken: t('admin.items.category.taken') };

export function Items({ initialView }: { initialView: ItemView }) {
  const { permissions } = useMe();
  const mayWrite = permissions.includes('items:write');
  const [view, setView] = useSavedView<ItemView>('items', initialView);
  const [search, setSearch] = useState('');
  const [show, setShow] = useState<Show>('active');
  const list = useApiList(listItems, {
    filter: { ...(search === '' ? {} : { search }), ...(show === 'all' ? {} : { active: show === 'active' }) },
  });
  const categories = useApiQuery(listItemCategories, {}).data?.categories ?? [];
  const units = useApiQuery(listUnitsOfMeasure, {}).data?.units ?? [];
  const categoryName = (id: string) => categories.find((c) => c.id === id)?.name ?? '';

  const [acting, setActing] = useState<Acting | null>(null);
  const close = (open: boolean) => { if (!open) setActing(null); };
  const refresh = { invalidates: [listItems, listItemCategories] };
  const add = useApiMutation(createItem, refresh);
  const addCategory = useApiMutation(createItemCategory, refresh);
  const rename = useApiMutation(renameItemCategory, refresh);
  const router = useRouter();

  const columns: Column<StockItem>[] = [
    { id: 'sku', header: t('admin.items.sku'), cell: (i) => <Link href={`/admin/items/${i.id}`}>{i.sku}</Link> },
    { id: 'name', header: t('admin.items.name'), cell: (i) => i.name },
    { id: 'category', header: t('admin.items.category'), cell: (i) => categoryName(i.categoryId) },
    { id: 'unit', header: t('admin.items.unit'), cell: (i) => i.unit },
    { id: 'hsn', header: t('admin.items.hsn'), cell: (i) => i.hsn },
    { id: 'status', header: t('admin.locations.col.status'), cell: (i) => t(i.active ? 'admin.locations.active' : 'admin.locations.inactive') },
  ];
  const items = list.items;
  const editingCategory = acting?.kind === 'category' ? acting.category : undefined;

  return (
    <>
      <h1>{t('admin.items.title')}</h1>
      <p>{t('admin.items.intro')}</p>
      <div className="admin-toolbar">
        <SearchBox label={t('admin.items.search')} action={t('admin.audit.apply')} onSearch={setSearch} />
        {mayWrite ? (
          <button type="button" className="kit-button kit-button-primary" onClick={() => setActing({ kind: 'add' })}>
            {t('admin.items.add')}
          </button>
        ) : null}
      </div>
      <div className="admin-toolbar">
        <ChoiceButtons<Show> label={t('admin.locations.col.status')} value={show} onChange={setShow} options={[
          { value: 'active', label: t('admin.locations.active') }, { value: 'inactive', label: t('admin.locations.inactive') },
          { value: 'all', label: t('admin.locations.all') },
        ]} />
        <ChoiceButtons<ItemView> label={t('admin.items.view')} value={view} onChange={setView}
          options={ITEM_VIEWS.map((v) => ({ value: v, label: t(`admin.items.view.${v}`) }))} />
      </div>
      {view === 'list' ? (
        <DataTable caption={t('admin.items.title')} columns={columns} rowKey={(i) => i.id} list={list} empty={t('admin.items.empty')} />
      ) : (
        <>
          <ul aria-label={t('admin.items.title')} className="admin-cards">
            {items.map((i) => {
              const picture = i.pictures[0]?.url ?? null;
              return (
                <li key={i.id}>
                  {/* Decorative here: the card's link names the item. */}
                  {picture === null ? <span className="admin-card-blank" aria-hidden="true" />
                    : <Image src={picture} alt="" width={240} height={160} unoptimized />}
                  <Link href={`/admin/items/${i.id}`}>{i.name}</Link>
                  <span className="kit-field-hint">{i.sku} · {categoryName(i.categoryId)}</span>
                  {i.active ? null : <span className="kit-field-hint">{t('admin.locations.inactive')}</span>}
                </li>
              );
            })}
          </ul>
          {list.isPending ? <p>{t('loading')}</p> : items.length === 0 ? <p>{t('admin.items.empty')}</p> : null}
          {list.hasNextPage ? (
            <button type="button" className="kit-button" disabled={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>
              {t('admin.items.more')}
            </button>
          ) : null}
        </>
      )}

      <h2 id="categories-title">{t('admin.items.categories')}</h2>
      {mayWrite ? (
        <div className="admin-toolbar">
          <button type="button" className="kit-button" onClick={() => setActing({ kind: 'category', category: null })}>
            {t('admin.items.category.add')}
          </button>
        </div>
      ) : null}
      <ul aria-labelledby="categories-title" className="admin-kinds">
        {categories.map((c) => (
          <li key={c.id}>
            <span>{c.name}</span>
            {mayWrite ? (
              <button type="button" className="kit-button" aria-label={t('admin.items.category.rename', { name: c.name })}
                onClick={() => setActing({ kind: 'category', category: c })}>{t('admin.locations.rename')}</button>
            ) : null}
          </li>
        ))}
      </ul>

      <Dialog open={acting?.kind === 'add'} onOpenChange={close} title={t('admin.items.add')}>
        <Form schema={newItemSchema} saved={false} messages={MESSAGES}
          defaultValues={{ sku: '', name: '', categoryId: '', hsn: '', unit: '', barcode: '', serialised: false, hasChassis: false, purchasePrice: '' }}
          onSubmit={async (v) => {
            const { id } = await add.submit(v);
            setActing(null);
            later(t('admin.items.added', { sku: v.sku }));
            router.push(`/admin/items/${id}`);
          }}>
          <ItemFields categories={categories} units={units} withSku cost={permissions.includes('cost:read') ? 'edit' : 'none'} />
          <div className="kit-actions">
            <CloseButton>{t('admin.cancel')}</CloseButton>
            <SubmitButton>{t('admin.items.add')}</SubmitButton>
          </div>
        </Form>
      </Dialog>

      <Dialog open={acting?.kind === 'category'} onOpenChange={close}
        title={editingCategory ? t('admin.items.category.rename', { name: editingCategory.name }) : t('admin.items.category.add')}>
        {editingCategory === undefined ? null : (
          <Form schema={categorySchema} saved={false} messages={CATEGORY_MESSAGES} defaultValues={{ name: editingCategory?.name ?? '' }}
            onSubmit={async ({ name }) => {
              if (editingCategory === null) await addCategory.submit({ name });
              else await rename.submit({ id: editingCategory.id, name });
              setActing(null);
              later(t('admin.items.category.saved', { name }));
            }}>
            <TextField name="name" label={t('admin.items.category.name')} autoComplete="off" />
            <div className="kit-actions">
              <CloseButton>{t('admin.cancel')}</CloseButton>
              <SubmitButton>{t(editingCategory === null ? 'admin.items.category.add' : 'admin.locations.rename')}</SubmitButton>
            </div>
          </Form>
        )}
      </Dialog>
    </>
  );
}
