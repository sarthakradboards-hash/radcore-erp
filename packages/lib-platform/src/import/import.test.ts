// RC-117 (what the sources produce: Excel, any delimiter, any encoding, more than 1 MB) and RC-118 ("9,111.00" is
// 9111, a bad row is reported, not dropped), within ADR-003's parser limits.
import { Readable } from 'node:stream';
import { crc32, deflateRawSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { amountCell, checkRows, collectUpload, dateCell, decodeText, IMPORT_LIMITS, ImportFileError, parseAmountCell,
  parseDateCell, readTable, sniffDelimiter } from '../index.ts';

// Each test here starts real import workers, and each worker loads the parser and lib-common afresh (about 1 s cold,
// several on a loaded machine), at most two at a time: vitest's 5 s default is less than that start-up (RAD-46).
vi.setConfig({ testTimeout: 30_000 });

const utf8 = (s: string) => new TextEncoder().encode(s);
const NS = 'http://schemas.openxmlformats.org';

/**
 * How the test .xlsx is zipped. `declare` overrides the sheet's stated size, in both headers (`centralOnly`: the
 * central directory only); `deflate` compresses, `descriptor` writes sizes after the data as streaming writers do;
 * `parts` adds that many small entries; `pad` adds that many spaces to the sheet; `hidden` adds an entry the central
 * directory doesn't list.
 */
type Zip = { declare?: number; centralOnly?: boolean; deflate?: boolean; descriptor?: boolean; parts?: number;
  pad?: number; hidden?: boolean };

// A minimal .xlsx, zipped as `zip` says.
function xlsx(rows: (string | number)[][], zip: Zip = {}): Uint8Array {
  const cell = (v: string | number, c: number, r: number) => {
    const ref = `${String.fromCharCode(65 + c)}${r}`;
    return typeof v === 'number' ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t>${v}</t></is></c>`;
  };
  const body = rows.map((r, i) => `<row r="${i + 1}">${r.map((v, c) => cell(v, c, i + 1)).join('')}</row>`).join('');
  const rel = (id: string, type: string, target: string) =>
    `<Relationship Id="${id}" Type="${NS}/officeDocument/2006/relationships/${type}" Target="${target}"/>`;
  const files: [string, string][] = [
    ['[Content_Types].xml', `<Types xmlns="${NS}/package/2006/content-types">`
      + `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
      + '</Types>'],
    ['_rels/.rels', `<Relationships xmlns="${NS}/package/2006/relationships">${rel('rId1', 'officeDocument', 'xl/workbook.xml')}</Relationships>`],
    ['xl/workbook.xml', `<workbook xmlns="${NS}/spreadsheetml/2006/main" xmlns:r="${NS}/officeDocument/2006/relationships">`
      + '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', `<Relationships xmlns="${NS}/package/2006/relationships">${rel('rId1', 'worksheet', 'worksheets/sheet1.xml')}</Relationships>`],
    ['xl/worksheets/sheet1.xml', `<worksheet xmlns="${NS}/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`
      + ' '.repeat(zip.pad ?? 0)],
    ...Array.from({ length: zip.parts ?? 0 }, (_, i): [string, string] => [`docProps/part${String(i)}.xml`, '<x/>']),
  ];
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  const local = (name: string, text: string) => {
    const raw = Buffer.from(text);
    const data = zip.deflate ? deflateRawSync(raw) : raw;
    const n = Buffer.from(name);
    const stated = name.endsWith('sheet1.xml') ? zip.declare ?? raw.length : raw.length;
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(zip.descriptor ? 0x08 : 0, 6);
    head.writeUInt16LE(zip.deflate ? 8 : 0, 8);
    if (!zip.descriptor) {
      head.writeUInt32LE(crc32(raw), 14);
      head.writeUInt32LE(data.length, 18);
      head.writeUInt32LE(zip.centralOnly ? raw.length : stated, 22);
    }
    head.writeUInt16LE(n.length, 26);
    const tail = Buffer.alloc(zip.descriptor ? 16 : 0);
    if (zip.descriptor) {
      tail.writeUInt32LE(0x08074b50, 0);
      tail.writeUInt32LE(crc32(raw), 4);
      tail.writeUInt32LE(data.length, 8);
      tail.writeUInt32LE(stated, 12);
    }
    locals.push(head, n, data, tail);
    const at = offset;
    offset += 30 + n.length + data.length + tail.length;
    return { raw, data, n, stated, at };
  };
  for (const [name, text] of files) {
    const { raw, data, n, stated, at } = local(name, text);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(zip.descriptor ? 0x08 : 0, 8);
    central.writeUInt16LE(zip.deflate ? 8 : 0, 10);
    central.writeUInt32LE(crc32(raw), 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(stated, 24);
    central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(at, 42);
    centrals.push(central, n);
  }
  if (zip.hidden) local('xl/hidden.xml', '<hidden/>');
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

describe('RC-118: amounts as Indian files write them', () => {
  it.each([
    ['9,111.00', '9111.00'], ['1,25,000.50', '125000.50'], ['1,000,000', '1000000'], ['125000.5', '125000.5'],
    ['₹ 1,250', '1250'], ['Rs. 1,250.00', '1250.00'], ['-1,250', '-1250'], ['(1,250.00)', '-1250.00'], ['0.00', '0.00'],
    ['-0', '0'], [' 42 ', '42'],
  ])('"%s" is %s', (cell, want) => expect(parseAmountCell(cell)).toBe(want));

  it.each(['9,1,11', '9111,00', '1.2.3', 'abc', '', '12,3456', '1e5', '--5'])('"%s" is not an amount', (cell) => {
    expect(parseAmountCell(cell)).toBeUndefined();
  });
});

describe('RC-117: CSV in the delimiter and encoding the source uses', () => {
  it.each([[','], [';'], ['\t'], ['|']])('reads "%s"-separated files, quoted amounts intact', async (d) => {
    const t = await readTable(utf8(`Date${d}Narration${d}Amount\n07-11-2026${d}"Tea, snacks"${d}"9,111.00"\n`));
    expect(t).toEqual({ header: ['Date', 'Narration', 'Amount'], rows: [['07-11-2026', 'Tea, snacks', '9,111.00']] });
  });

  it('decodes UTF-16 with a byte-order mark, and Windows-1252', () => {
    const text = 'Party,Amount\nCafé Noir,1250\nCafé Bleu,980\n';
    expect(decodeText(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]))).toBe(text);
    expect(decodeText(Buffer.from(text, 'latin1'))).toBe(text);
  });

  it('picks the delimiter from the header, ignoring quoted text', () => {
    expect(sniffDelimiter('"a;b;c",x,y\n1,2,3')).toBe(',');
    expect(sniffDelimiter('one column only')).toBe(',');
  });

  it("reads a file well over v1's 1 MB", async () => {
    const lines = ['Narration,Amount', ...Array.from({ length: 30_000 }, (_, i) => `Payment ${i},"1,250.00"`)];
    const t = await readTable(utf8(lines.join('\n')));
    expect(t.rows).toHaveLength(30_000);
  });
});

describe('RC-117: Excel', () => {
  it('reads .xlsx cells as the text they hold, numbers included', async () => {
    const t = await readTable(xlsx([['Party', 'Amount'], ['Asha Motors', 9111.1], ['Ravi Traders', 0.3]]));
    expect(t).toEqual({ header: ['Party', 'Amount'], rows: [['Asha Motors', '9111.1'], ['Ravi Traders', '0.3']] });
  });

  it('refuses an archive whose directory says it unzips past 100 MB, before inflating it', async () => {
    await expect(readTable(xlsx([['a']], { declare: 101 * 1024 * 1024, centralOnly: true }))).rejects.toThrow(/more than 100 MB/);
  });

  it('reads a deflated sheet, and one zipped with sizes after the data, as streaming writers do', async () => {
    const rows = [['Party', 'Amount'], ['Asha Motors', 9111.1]];
    const want = { header: ['Party', 'Amount'], rows: [['Asha Motors', '9111.1']] };
    expect(await readTable(xlsx(rows, { deflate: true }))).toEqual(want);
    expect(await readTable(xlsx(rows, { deflate: true, descriptor: true }))).toEqual(want);
  });

  // auditor-2's MUST on #56: read-excel-file inflates from the local headers, so the directory's sizes can't be trusted.
  it.each<[string, Zip]>([
    ['in both headers', { deflate: true, declare: 1000 }],
    ['with sizes after the data', { deflate: true, declare: 1000, descriptor: true }],
  ])('refuses a sheet that understates its size %s and unzips past 100 MB', async (_, zip) => {
    await expect(readTable(xlsx([['a']], { ...zip, pad: 101 * 1024 * 1024 }))).rejects.toThrow(/more than 100 MB/);
  }, 30_000);

  it('refuses 1,001 entries, and keeps 1,000', async () => {
    await expect(readTable(xlsx([['a']], { parts: 996 }))).rejects.toThrow(/too many parts/);
    expect(await readTable(xlsx([['a']], { parts: 995 }))).toEqual({ header: ['a'], rows: [] });
  });

  it.each<[string, Zip]>([
    ['an entry the directory does not list', { hidden: true }],
    ['a stated size that is not the real one', { declare: 3 }],
    ['a deflated size that is not the real one', { deflate: true, declare: 3 }],
  ])('refuses %s as damaged', async (_, zip) => {
    await expect(readTable(xlsx([['a']], zip))).rejects.toThrow(/damaged/);
  });

  it('refuses a damaged or legacy file with a sentence', async () => {
    const bad = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(100)]);
    await expect(readTable(bad)).rejects.toBeInstanceOf(ImportFileError);
  });
});

describe('ADR-003 parser limits', () => {
  it('refuses a stream past 25 MB as soon as it gets there', async () => {
    let read = 0;
    const big = Readable.from((function* chunks() {
      for (let i = 0; i < 40; i++) {
        read++;
        yield Buffer.alloc(1024 * 1024);
      }
    })());
    await expect(collectUpload(big)).rejects.toThrow(/larger than 25 MB/);
    expect(read).toBeLessThan(30);
  });

  it('refuses more than 50,000 rows', async () => {
    const lines = ['n', ...Array.from({ length: IMPORT_LIMITS.maxRows + 1 }, (_, i) => String(i))];
    await expect(readTable(utf8(lines.join('\n')))).rejects.toThrow(/more than 50,000 rows/);
  });
});

describe('RC-118: every row is either a value or its errors', () => {
  const Row = z.object({ Narration: z.string().min(1), Amount: amountCell() });

  it('reports the bad rows by row number and keeps the good ones', async () => {
    const t = await readTable(utf8('Narration,Amount\nTea,"9,111.00"\n,12\nFuel,"9,1,11"\nRent,"1,25,000"\n'));
    const r = checkRows(t, Row);
    expect(r.rows).toEqual([{ row: 2, value: { Narration: 'Tea', Amount: '9111.00' } },
      { row: 5, value: { Narration: 'Rent', Amount: '125000' } }]);
    expect(r.errors.map((e) => [e.row, e.column])).toEqual([[3, 'Narration'], [4, 'Amount']]);
    expect(r.rows.length + new Set(r.errors.map((e) => e.row)).size).toBe(t.rows.length);
  });

  it('names a missing column once', async () => {
    const r = checkRows(await readTable(utf8('Narration\nTea\n')), Row);
    expect(r).toEqual({ rows: [], errors: [{ row: 1, column: 'Amount', message: 'The file has no column called Amount' }] });
  });
});

describe('RC-118: dates are read day first and strictly, and a bad one is that row\'s error', () => {
  it.each([['07-11-2026', '2026-11-07'], ['7/11/2026', '2026-11-07'], ['07.11.2026', '2026-11-07'],
    ['07 Nov 2026', '2026-11-07'], ['7-November-2026', '2026-11-07'], ['1 Sept 2026', '2026-09-01'],
    ['2026-11-07', '2026-11-07'], [' 29-02-2028 ', '2028-02-29']])('reads "%s" as %s', (cell, date) => {
    expect(parseDateCell(cell)).toBe(date);
  });

  it.each(['31-02-2026', '29-02-2026', '13/13/2026', '07-11-26', '07-11/2026', '2026/11/07', '07 Nox 2026', 'Nov 7 2026',
    '', 'tomorrow'])('refuses "%s"', (cell) => {
    expect(parseDateCell(cell)).toBeUndefined();
  });

  it('keeps every row: a bad date is reported on its row, never dropped', async () => {
    const Row = z.object({ Date: dateCell(), Amount: amountCell() });
    const t = await readTable(utf8('Date,Amount\n07-11-2026,"9,111.00"\n31-02-2026,10\n07-11-26,12\n08 Nov 2026,5\n'));
    const r = checkRows(t, Row);
    expect(r.rows).toEqual([{ row: 2, value: { Date: '2026-11-07', Amount: '9111.00' } },
      { row: 5, value: { Date: '2026-11-08', Amount: '5' } }]);
    expect(r.errors).toEqual([
      { row: 3, column: 'Date', message: '"31-02-2026" isn\'t a real date. Write it as DD-MM-YYYY' },
      { row: 4, column: 'Date', message: '"07-11-26" isn\'t a real date. Write it as DD-MM-YYYY' }]);
  });
});

describe("auditor-2 SHOULD on #56: Excel's float text", () => {
  it('reads a number as the 15 significant digits Excel shows', async () => {
    // A formula's =A1*0.18 is stored as the double's shortest text, 1640.0000000000002.
    const t = await readTable(xlsx([['Amount'], [1640.0000000000002], [0.1], [123456789012.34]]));
    expect(t.rows).toEqual([['1640'], ['0.1'], ['123456789012.34']]);
  });
});
