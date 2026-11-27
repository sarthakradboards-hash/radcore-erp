import { expect, it } from 'vitest';
import { ApiError } from '../../../../lib/api-client.ts';
import { importSchema, importValues, importWhenChecked, lineCounts, uploadType } from './statement-values.ts';

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

it('counts lines in words, one or many', () => {
  expect(lineCounts(1, 0)).toBe('1 new line; 0 already here.');
  expect(lineCounts(4, 1)).toBe('4 new lines; 1 already here.');
});

it('asks again while the file is still being checked, and passes any other refusal straight on', async () => {
  const notReady = new ApiError(422, { code: 'not_ready', message: 'Still being checked', issues: [] } as never);
  const waits: number[] = [];
  const wait = async (ms: number) => { waits.push(ms); };
  let calls = 0;
  await expect(importWhenChecked(async () => { calls += 1; if (calls < 3) throw notReady; return { id: 'x' }; }, 10, wait)).resolves.toEqual({ id: 'x' });
  expect([calls, waits]).toEqual([3, [2000, 2000]]);
  calls = 0;
  await expect(importWhenChecked(async () => { calls += 1; throw notReady; }, 3, wait)).rejects.toBe(notReady);
  expect(calls).toBe(3);
  const other = new ApiError(422, { code: 'upload_refused', message: 'Refused', issues: [] } as never);
  calls = 0;
  await expect(importWhenChecked(async () => { calls += 1; throw other; }, 10, wait)).rejects.toBe(other);
  expect(calls).toBe(1);
});
