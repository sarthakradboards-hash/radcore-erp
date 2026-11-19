// lib-stock's sheets of the masters workbook (RAD-92, RC-164): locations and items, read as their screens' lists read
// them, a page at a time. The worker's job file joins them with the other modules' sheets (ADR-001 §8b). A sheet goes
// in only for a starter holding its key when the job runs. Items carry no cost field yet: RAD-89 part 3 adds cost()
// and its column here, masked without cost:read.
import type { ExportRow, ExportSheet } from '@radcore/lib-platform';
import { KIND_LABELS } from './location-kinds.ts';
import { listCategories, listItemRows } from './services/items.ts';
import { listPlaces } from './services/locations.ts';

const yesNo = (b: boolean) => (b ? 'Yes' : 'No');

const locations: ExportSheet = {
  name: 'Locations', perm: 'locations:read', columns: ['code', 'name', 'kind', 'active'],
  rows: async (ctx, _filter, page) => {
    const { items, next } = await listPlaces(ctx, { filter: {}, ...page });
    // The kind as its screens name it: its label, as an admin may have renamed it (#181).
    return { items: items.map((l): ExportRow => ({ code: l.code, name: l.name, kind: ctx.settings.get(KIND_LABELS[l.kind]),
      active: yesNo(l.active) })), next };
  },
};

const items: ExportSheet = {
  name: 'Items', perm: 'items:read',
  columns: ['sku', 'name', 'category', 'hsn', 'unit', 'barcode', 'serialised', 'hasChassis', 'active'],
  rows: async (ctx, _filter, page) => {
    const [{ items: rows, next }, { categories }] = await Promise.all([listItemRows(ctx, { filter: {}, ...page }), listCategories(ctx)]);
    const category = new Map(categories.map((c) => [c.id, c.name]));
    return {
      items: rows.map((i): ExportRow => ({ sku: i.sku, name: i.name, category: category.get(i.categoryId) ?? null, hsn: i.hsn,
        unit: i.unit, barcode: i.barcode, serialised: yesNo(i.serialised), hasChassis: yesNo(i.hasChassis), active: yesNo(i.active) })),
      next,
    };
  },
};

/** lib-stock's sheets, in the workbook's order. */
export const stockSheets: readonly ExportSheet[] = Object.freeze([locations, items]);
