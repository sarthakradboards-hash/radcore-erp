// RC-117 (what the sources produce: Excel, any delimiter, any encoding, more than 1 MB) and RC-118 ("9,111.00" is
// 9111, a bad row is reported, not dropped), within ADR-003's parser limits.
import { Readable } from 'node:stream';
import { crc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { amountCell, checkRows, collectUpload, decodeText, IMPORT_LIMITS, ImportFileError, parseAmountCell, readTable,
  sniffDelimiter } from '../index.ts';

const utf8 = (s: string) => new TextEncoder().encode(s);
const NS = 'http://schemas.openxmlformats.org';

// A minimal .xlsx: stored (uncompressed) ZIP entries. `declare` overrides each entry's stated size, for the bomb check.
function xlsx(rows: (string | number)[][], declare?: number): Uint8Array {
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
    ['xl/worksheets/sheet1.xml', `<worksheet xmlns="${NS}/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`],
  ];
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of files) {
    const data = Buffer.from(text);
    const n = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(declare ?? data.length, 24);
    central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, n, data);
    centrals.push(central, n);
    offset += 30 + n.length + data.length;
  }
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

  it('refuses an archive that would unzip past 100 MB, before inflating it', async () => {
    await expect(readTable(xlsx([['a']], 30 * 1024 * 1024))).rejects.toThrow(/more than 100 MB/);
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
