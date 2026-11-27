import { expect, it } from 'vitest';
import { importSchema, importValues, uploadType } from './statement-values.ts';

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

it('uploads a .csv Windows calls Excel as CSV, and refuses a PDF or a file over the limit before sending it', () => {
  const xlsx = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  expect(uploadType({ name: 'apr.csv', type: 'application/vnd.ms-excel', size: 10 })).toEqual({ contentType: 'text/csv' });
  expect(uploadType({ name: 'APR.CSV', type: '', size: 10 })).toEqual({ contentType: 'text/csv' });
  expect(uploadType({ name: 'apr.xlsx', type: xlsx, size: 10 })).toEqual({ contentType: xlsx });
  expect(uploadType({ name: 'apr.pdf', type: 'application/pdf', size: 10 })).toEqual({ problem: 'type' });
  expect(uploadType({ name: 'apr.xls', type: 'application/vnd.ms-excel', size: 10 })).toEqual({ problem: 'type' });
  expect(uploadType({ name: 'apr.csv', type: 'text/csv', size: 16 * 1024 * 1024 })).toEqual({ problem: 'size' });
});
