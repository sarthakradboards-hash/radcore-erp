// RAD-89's contracts: items and categories read with items:read and changed with items:write; an item's HSN is 4, 6
// or 8 digits, and only a serialised item can have a chassis number (D-15).
import { describe, expect, it } from 'vitest';
import * as contracts from './contract.ts';
import { createItem, updateItem } from './contract.ts';

const item = {
  sku: 'SCOOT-01', name: 'Electric scooter', categoryId: '3f2b8c9e-1d4a-4f6b-9c2e-7a1b5d3e9f01', hsn: '87116020', unit: 'NOS',
  barcode: null, serialised: true, hasChassis: true,
};
const ok = (c: { input: { safeParse(v: unknown): { success: boolean } } }, v: unknown) => c.input.safeParse(v).success;

describe('the item contracts', () => {
  it('read with items:read and change with items:write', () => {
    // The item contracts: the entry also holds locations' and their kinds' (RAD-92, under /stock/), checked by their own
    // keys in tools/locations.test.ts and tools/location-kind-labels.test.ts, and the books check (RAD-95, below).
    const all = Object.values(contracts).filter((c) => !c.path.startsWith('/stock/') && !c.path.startsWith('/books/'));
    expect(all.every((c) => c.perm === (c.method === 'GET' ? 'items:read' : 'items:write'))).toBe(true);
    expect(all.every((c) => c.tx.readOnly === (c.method === 'GET'))).toBe(true);
  });

  it('take an HSN of 4, 6 or 8 digits, a unit code and a valid SKU', () => {
    expect(['8711', '871160', '87116020', '871', '87116', '8711602012'].map((hsn) => ok(createItem, { ...item, hsn })))
      .toEqual([true, true, true, false, false, false]);
    expect(ok(createItem, { ...item, unit: 'nos' })).toBe(false);
    expect(ok(createItem, { ...item, sku: 'has space' })).toBe(false);
    expect(ok(createItem, { ...item, barcode: '8901234567890' })).toBe(true);
    expect(ok(createItem, { ...item, barcode: 'with space' })).toBe(false);
  });

  it('give a chassis number only to a serialised item (D-15)', () => {
    expect(ok(createItem, { ...item, serialised: false })).toBe(false);
    expect(ok(createItem, { ...item, serialised: false, hasChassis: false })).toBe(true);
  });

  it('change anything but the SKU, which documents print and search by', () => {
    expect(updateItem.input.parse({ id: item.categoryId, name: 'Scooter', sku: 'OTHER' })).toEqual({ id: item.categoryId, name: 'Scooter' });
    // Switched off, never deleted (ADR-005 §3); a new item is always active.
    expect(updateItem.input.parse({ id: item.categoryId, active: false })).toEqual({ id: item.categoryId, active: false });
  });
});

// RAD-95: the books check reads one snapshot, as at a date or now, with journal:read.
describe('the books check contract', () => {
  it('reads with journal:read, in one REPEATABLE READ snapshot', () => {
    const c = contracts.checkBooksContract;
    expect([c.method, c.path, c.perm, c.tx.readOnly, c.tx.isolation]).toEqual(['GET', '/books/check', 'journal:read', true, 'repeatable read']);
  });

  it('takes a business date, or none for every posting', () => {
    expect([ok(contracts.checkBooksContract, {}), ok(contracts.checkBooksContract, { asAt: '2026-11-19' }),
      ok(contracts.checkBooksContract, { asAt: '2026-02-30' })]).toEqual([true, true, false]);
  });
});
