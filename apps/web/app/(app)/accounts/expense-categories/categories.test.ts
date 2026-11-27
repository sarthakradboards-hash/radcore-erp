import { expect, it } from 'vitest';
import { createSchema, editSchema, expenseAccounts } from './categories.ts';

const id = '00000000-0000-4000-8000-000000000001';
const acct = '00000000-0000-4000-8000-000000000002';

it('sends no clause while credit is allowed, and asks for one while it is blocked', () => {
  expect(createSchema.parse({ name: 'Travel', credit: 'allowed', blockedClause: '(b)(i)', accountIds: [acct] }).blockedClause).toBeNull();
  expect(createSchema.parse({ name: 'Food', credit: 'blocked', blockedClause: '(b)(i)', accountIds: [acct] }).blockedClause).toBe('(b)(i)');
  const r = createSchema.safeParse({ name: 'Food', credit: 'blocked', blockedClause: '', accountIds: [acct] });
  expect(r.error?.issues.map((i) => i.path.join('.'))).toContain('blockedClause');
  expect(createSchema.safeParse({ name: 'Food', credit: 'allowed', blockedClause: '', accountIds: [] }).success).toBe(false);
});

it('sends an edit whole, with its id and reason', () => {
  expect(editSchema(id).parse({ name: ' Travel ', credit: 'allowed', blockedClause: '', accountIds: [acct], reason: 'Now allowed' }))
    .toEqual({ id, name: 'Travel', credit: 'allowed', blockedClause: null, accountIds: [acct], reason: 'Now allowed' });
  expect(editSchema(id).safeParse({ name: 'Travel', credit: 'allowed', blockedClause: '', accountIds: [acct], reason: ' ' }).success).toBe(false);
});

it('offers only switched-on ordinary expense accounts', () => {
  const base = { code: null, systemKey: null, parentId: null, control: false };
  const accounts = [
    { ...base, id: 'a', name: 'Travel', type: 'expense', controlKind: 'none', active: true },
    { ...base, id: 'b', name: 'Old', type: 'expense', controlKind: 'none', active: false },
    { ...base, id: 'c', name: 'Bank', type: 'asset', controlKind: 'none', active: true },
    { ...base, id: 'd', name: 'Stock', type: 'expense', controlKind: 'stock', active: true },
  ] as Parameters<typeof expenseAccounts>[0];
  expect(expenseAccounts(accounts).map((a) => a.id)).toEqual(['a']);
});
