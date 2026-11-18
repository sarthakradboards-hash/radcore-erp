'use client';
// An item's fields, shared by "New item" (items.tsx) and the item's own page, on createItem's schema. The one change
// is the barcode: an empty box is the contract's null. The rule that only a serialised item has a chassis number is
// the contract's own refine, checked again before sending, so the screen holds no rule of its own.
import { createItem } from '@radcore/lib-stock/contract';
import { z } from 'zod';
import { CheckboxField, SelectField, TextField } from '../../../../components/ui/form/fields.tsx';
import { t } from '../../../../lib/i18n/index.ts';
import type { ItemCategory, ItemUnit } from '../types.ts';

const shape = createItem.input.shape;
const barcode = z.string().trim().transform((s) => (s === '' ? null : s)).pipe(shape.barcode);
export const newItemSchema = z.object({ ...shape, barcode });
export const editItemSchema = z.object(shape).omit({ sku: true }).extend({ barcode });

export function ItemFields({ categories, units, withSku }: {
  categories: readonly ItemCategory[]; units: readonly ItemUnit[]; withSku: boolean;
}) {
  return (
    <>
      {withSku ? <TextField name="sku" label={t('admin.items.sku')} hint={t('admin.items.sku.hint')} autoComplete="off" /> : null}
      <TextField name="name" label={t('admin.items.name')} autoComplete="off" />
      <SelectField name="categoryId" label={t('admin.items.category')} placeholder={t('admin.items.category.choose')}
        options={categories.map((c) => ({ value: c.id, label: c.name }))} />
      <TextField name="hsn" label={t('admin.items.hsn')} hint={t('admin.items.hsn.hint')} inputMode="numeric" autoComplete="off" />
      <SelectField name="unit" label={t('admin.items.unit')} placeholder={t('admin.items.unit.choose')}
        options={units.map((u) => ({ value: u.code, label: `${u.name} (${u.code})` }))} />
      <TextField name="barcode" label={t('admin.items.barcode')} hint={t('admin.items.barcode.hint')} autoComplete="off" />
      <CheckboxField name="serialised" label={t('admin.items.serialised')} hint={t('admin.items.serialised.hint')} />
      <CheckboxField name="hasChassis" label={t('admin.items.hasChassis')} hint={t('admin.items.hasChassis.hint')} />
    </>
  );
}
