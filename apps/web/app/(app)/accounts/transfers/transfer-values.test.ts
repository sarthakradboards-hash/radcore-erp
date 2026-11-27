import { expect, it } from 'vitest';
import { transferSchema } from './transfer-values.ts';

const cash = '00000000-0000-4000-8000-000000000001';
const bank = '00000000-0000-4000-8000-000000000002';
const base = { fromAccountId: cash, toAccountId: bank, amount: '10000.00', businessDate: '2026-11-27', reference: '', notes: '' };

it('sends a transfer without its empty optional boxes', () => {
  expect(transferSchema.parse(base)).toEqual({ fromAccountId: cash, toAccountId: bank, amount: '10000.00', businessDate: '2026-11-27' });
  expect(transferSchema.parse({ ...base, reference: ' SLIP-7 ', notes: 'Day takings' })).toMatchObject({ reference: 'SLIP-7', notes: 'Day takings' });
});

it('refuses the same account both ways, an empty pick and an amount of nothing', () => {
  const paths = (v: object) => transferSchema.safeParse(v).error?.issues.map((i) => i.path.join('.'));
  expect(paths({ ...base, toAccountId: cash })).toEqual(['toAccountId']);
  expect(paths({ ...base, fromAccountId: '' })).toContain('fromAccountId');
  expect(paths({ ...base, amount: '0' })).toEqual(['amount']);
  expect(paths({ ...base, amount: '1.234' })).toEqual(['amount']);
});
