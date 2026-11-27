import { expect, it } from 'vitest';
import { accountSchema, groups } from './account-values.ts';

const parent = '00000000-0000-4000-8000-000000000001';

it('sends a new account without an empty code, and words a bad name or code', () => {
  expect(accountSchema.parse({ name: ' Travel ', parentId: parent, code: '' })).toEqual({ name: 'Travel', parentId: parent });
  expect(accountSchema.parse({ name: 'Travel', parentId: parent, code: 'EX-10' })).toEqual({ name: 'Travel', parentId: parent, code: 'EX-10' });
  const paths = (v: object) => accountSchema.safeParse(v).error?.issues.map((i) => i.path.join('.'));
  expect(paths({ name: 'x'.repeat(121), parentId: parent, code: '' })).toEqual(['name']);
  expect(paths({ name: 'Travel', parentId: parent, code: 'ex 10' })).toEqual(['code']);
  expect(paths({ name: 'Travel', parentId: '', code: '' })).toEqual(['parentId']);
});

it('offers only switched-on ordinary accounts as groups', () => {
  const base = { code: null, systemKey: null, parentId: null, control: false, type: 'expense' };
  const accounts = [
    { ...base, id: 'a', name: 'Expenses', controlKind: 'none', active: true },
    { ...base, id: 'b', name: 'Old', controlKind: 'none', active: false },
    { ...base, id: 'c', name: 'Debtors', type: 'asset', controlKind: 'party', control: true, active: true },
  ] as Parameters<typeof groups>[0];
  expect(groups(accounts).map((a) => a.id)).toEqual(['a']);
});
