'use client';
// One item (RAD-99 on RAD-89's contracts): its details and pictures, and for items:write its edit form and switching
// it off or back on (never deleted: ADR-005 §3). The SKU never changes: documents print and search by it. Pictures are
// short-lived links the item's own answer carries, shown inline; one still being checked has no link yet.
import { getItem, listItemCategories, listItems, listUnitsOfMeasure, updateItem } from '@radcore/lib-stock/contract';
import Image from 'next/image';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMe } from '../../../../../components/shell/session-provider.tsx';
import { Form, SubmitButton } from '../../../../../components/ui/form/form.tsx';
import { useApiMutation, useApiQuery } from '../../../../../lib/api/query.ts';
import { t } from '../../../../../lib/i18n/index.ts';
import { ConfirmDialog, MESSAGES } from '../../shared.tsx';
import { editItemSchema, ItemFields } from '../item-fields.tsx';
import { useState } from 'react';

export default function ItemPage() {
  const { id } = useParams<{ id: string }>();
  const mayWrite = useMe().permissions.includes('items:write');
  const q = useApiQuery(getItem, { id });
  const categories = useApiQuery(listItemCategories, {}).data?.categories ?? [];
  const units = useApiQuery(listUnitsOfMeasure, {}).data?.units ?? [];
  const save = useApiMutation(updateItem, { invalidates: [getItem, listItems] });
  const [toggling, setToggling] = useState(false);
  const item = q.data;

  if (q.error !== null) {
    return (
      <>
        <p><Link href="/admin/items">{t('admin.items.back')}</Link></p>
        <div role="alert" className="kit-form-alert">
          {t('admin.items.missing')}{' '}
          <button type="button" className="kit-button" onClick={() => void q.refetch()}>{t('error.retry')}</button>
        </div>
      </>
    );
  }
  if (item === undefined) return <p>{t('loading')}</p>;
  const unit = units.find((u) => u.code === item.unit);

  return (
    <>
      <p><Link href="/admin/items">{t('admin.items.back')}</Link></p>
      <h1>{item.name}</h1>
      <dl className="admin-facts" aria-label={t('admin.items.facts')}>
        <dt>{t('admin.items.sku')}</dt><dd>{item.sku}</dd>
        <dt>{t('admin.items.category')}</dt><dd>{categories.find((c) => c.id === item.categoryId)?.name ?? ''}</dd>
        <dt>{t('admin.items.unit')}</dt><dd>{unit === undefined ? item.unit : `${unit.name} (${unit.code})`}</dd>
        <dt>{t('admin.items.hsn')}</dt><dd>{item.hsn}</dd>
        <dt>{t('admin.items.barcode')}</dt><dd>{item.barcode ?? t('admin.items.none')}</dd>
        <dt>{t('admin.items.tracking')}</dt>
        <dd>{t(item.hasChassis ? 'admin.items.tracking.chassis' : item.serialised ? 'admin.items.tracking.serial' : 'admin.items.tracking.none')}</dd>
        <dt>{t('admin.locations.col.status')}</dt><dd>{t(item.active ? 'admin.locations.active' : 'admin.locations.inactive')}</dd>
      </dl>

      <h2 id="pictures-title">{t('admin.items.pictures')}</h2>
      {item.pictures.length === 0 ? <p>{t('admin.items.pictures.none')}</p> : (
        <ul aria-labelledby="pictures-title" className="admin-cards">
          {item.pictures.map((p, n) => (
            <li key={p.fileId}>
              {p.url === null ? <span className="admin-card-blank">{t('admin.items.pictures.checking')}</span>
                : <Image src={p.url} alt={t('admin.items.pictures.alt', { name: item.name, n: String(n + 1) })} width={240} height={160} unoptimized />}
            </li>
          ))}
        </ul>
      )}

      {mayWrite ? (
        <>
          <div className="kit-actions admin-choices">
            <button type="button" className="kit-button" onClick={() => setToggling(true)}>
              {t(item.active ? 'admin.locations.switchOff' : 'admin.locations.switchOn')}
            </button>
          </div>
          <h2 id="item-form">{t('admin.items.edit')}</h2>
          {/* Keyed on the saved item, so after a save the form starts from what's saved. */}
          <Form key={JSON.stringify(item)} aria-labelledby="item-form" schema={editItemSchema} messages={MESSAGES}
            saved={t('admin.items.saved')}
            defaultValues={{
              name: item.name, categoryId: item.categoryId, hsn: item.hsn, unit: item.unit, barcode: item.barcode ?? '',
              serialised: item.serialised, hasChassis: item.hasChassis,
            }}
            onSubmit={(v) => save.submit({ id: item.id, ...v })}>
            <ItemFields categories={categories} units={units} withSku={false} />
            <SubmitButton>{t('admin.items.save')}</SubmitButton>
          </Form>
          <ConfirmDialog open={toggling} onOpenChange={setToggling}
            title={t(item.active ? 'admin.items.switchOff.title' : 'admin.items.switchOn.title', { sku: item.sku })}
            body={t(item.active ? 'admin.items.switchOff.body' : 'admin.items.switchOn.body')}
            action={t(item.active ? 'admin.locations.switchOff' : 'admin.locations.switchOn')}
            done={t(item.active ? 'admin.items.switchedOff' : 'admin.items.switchedOn', { sku: item.sku })}
            onConfirm={async () => { await save.submit({ id: item.id, active: !item.active }); }} />
        </>
      ) : null}
    </>
  );
}
