import { expect, it } from 'vitest';
import { importSchema, importValues } from './statement-values.ts';

const file = '00000000-0000-4000-8000-000000000001';
const format = { dateColumn: 'Txn Date', narrationColumn: 'Description', referenceColumn: 'Ref No', withdrawalColumn: 'Debit',
  depositColumn: 'Credit', balanceColumn: 'Balance', newestFirst: true };

it('starts from the kept layout, and sends it back with the file', () => {
  expect(importSchema.parse({ ...importValues(format), fileId: file })).toEqual({ fileId: file, format });
  expect(importValues(null)).toMatchObject({ dateColumn: '', referenceColumn: '', newestFirst: false });
});

it('sends an empty reference column as none, and asks for the file and each other heading', () => {
  expect(importSchema.parse({ ...importValues(format), referenceColumn: ' ', fileId: file }).format.referenceColumn).toBeNull();
  const r = importSchema.safeParse(importValues(null));
  expect(r.error?.issues.map((i) => i.path.join('.')).toSorted())
    .toEqual(['balanceColumn', 'dateColumn', 'depositColumn', 'fileId', 'narrationColumn', 'withdrawalColumn']);
});
