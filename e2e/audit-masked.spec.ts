// RAD-57 / #237 (auditor-2's SHOULD): /admin/audit shows a masked value as the kit's "Hidden", never as the server's
// JSON, to a viewer who may read the audit trail but not costs. No built-in role has audit:read without cost:read, so
// this seeds one. The unit test guards the helper; this guards the page's use of it, in a real browser.
import { randomUUID } from 'node:crypto';
import type { APIRequestContext, Page } from '@playwright/test';
import { expect, expectAccessible, test } from './fixtures.ts';
import { apiSignIn, seedPerson, seedRole, type Person } from './people.ts';

test.describe.configure({ mode: 'serial' });

const ROLE = 'audit_no_cost';
const R = randomUUID().slice(0, 6).toUpperCase();
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
let admin: Person;
let viewer: Person;
let api: APIRequestContext;
let itemId = '';

const send = (method: 'post' | 'patch', url: string, data: unknown) =>
  api[method](url, { headers: { 'idempotency-key': randomUUID() }, data });
async function signedIn(page: Page, baseURL: string, who: Person): Promise<void> {
  await page.context().clearCookies();
  const a = await apiSignIn(baseURL, who.email);
  await page.context().addCookies((await a.storageState()).cookies);
  await a.dispose();
}
async function itemRows(page: Page) {
  await page.goto('/admin/audit');
  await page.waitForFunction(() => Object.keys(document.querySelector('main') ?? {}).some((k) => k.startsWith('__reactFiber')));
  await page.getByRole('form').getByLabel('Table', { exact: true }).fill('items');
  await page.getByRole('form').getByRole('button', { name: 'Show' }).click();
  return page.getByRole('row').filter({ hasText: itemId });
}

test.beforeAll(async ({ baseURL }) => {
  await seedRole(ROLE, 'E2E audit, no cost', ['session:read', 'audit:read']);
  admin = await seedPerson('admin', { name: `E2E Admin ${R}` });
  viewer = await seedPerson(ROLE, { name: `E2E Viewer ${R}` });
  api = await apiSignIn(baseURL!, admin.email);
  const category = await send('post', '/api/item-categories', { name: `E2E cat ${R}` });
  expect(category.status(), await category.text()).toBe(200);
  const units = ((await (await api.get('/api/units-of-measure?input=%7B%7D')).json()) as { units: { code: string }[] }).units;
  const item = await send('post', '/api/items', { sku: `E2E-${R}-AUD`, name: `E2E audit item ${R}`, categoryId: ((await category.json()) as { id: string }).id,
    hsn: '8471', unit: units[0]!.code, barcode: null, serialised: false, hasChassis: false, purchasePrice: '1250.50' });
  expect(item.status(), await item.text()).toBe(200);
  itemId = ((await item.json()) as { id: string }).id;
  const change = await send('patch', `/api/items/${itemId}`, { purchasePrice: '1300' });
  expect(change.status(), await change.text()).toBe(200);
});
test.afterAll(async () => { await api?.dispose(); });

test('without cost:read the audit trail shows a price as "Hidden", never as the server\'s JSON or the value', async ({ page, baseURL }) => {
  await signedIn(page, baseURL!, viewer);
  const rows = await itemRows(page);
  await expect(rows).toHaveCount(2); // the insert and the price change
  const change = rows.filter({ hasText: 'Changed' });
  await expect(change).toContainText('purchase_price');
  await expect(change.locator('dd').filter({ hasText: '→' })).toContainText(/Hidden.*→.*Hidden/s);
  await expect(rows.filter({ hasText: 'Added' })).toContainText('Hidden');
  const text = (await rows.allInnerTexts()).join('\n').replace(UUID, '<id>'); // an id can hold digits like 1300
  expect(text).not.toMatch(/1250|1300/);
  expect(text).not.toContain('masked');
  await expectAccessible(page);
});

test('with cost:read the same rows show the values', async ({ page, baseURL }) => {
  await signedIn(page, baseURL!, admin);
  const change = (await itemRows(page)).filter({ hasText: 'Changed' });
  await expect(change).toContainText(/1250\.50*\s*→\s*1300/);
  await expect(change).not.toContainText('Hidden');
});
