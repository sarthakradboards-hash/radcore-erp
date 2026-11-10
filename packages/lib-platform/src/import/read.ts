// Reading an uploaded file into a table (M1-28, RC-117): CSV in any common delimiter and encoding, or Excel (.xlsx),
// within ADR-003's parser limits. Every cell comes back as the text the file holds: Excel numbers too (never a
// JavaScript number), and Excel dates as YYYY-MM-DD. Turning cells into amounts and dates, with an error per row, is
// cells.ts. Files are only ever passed in as bytes: read-excel-file would read a string as a path.
import { Decimal } from '@radcore/lib-common';
import chardet from 'chardet';
import { parse } from 'csv-parse/sync';
import { inflateRawSync } from 'node:zlib';
import readXlsxFile from 'read-excel-file/node';

/** ADR-003 §7, parser limits for untrusted files. */
export const IMPORT_LIMITS = {
  maxBytes: 25 * 1024 * 1024,
  maxRows: 50_000,
  maxUnzippedBytes: 100 * 1024 * 1024,
  maxZipEntries: 1_000,
  sniffBytes: 64 * 1024,
} as const;

/** A file the importer refuses as a whole, with a sentence the person can act on. */
export class ImportFileError extends Error {
  override name = 'ImportFileError';
}

/** The file's header row and data rows, every cell a string ('' when empty). Row 1 is the header. */
export type Table = { header: string[]; rows: string[][] };

const MB = (n: number) => `${Math.round(n / 1024 / 1024)} MB`;

// chardet's names to the WHATWG labels TextDecoder takes (Node's full ICU). Anything else is refused, not guessed.
const ENCODINGS: Record<string, string> = {
  'UTF-8': 'utf-8', 'UTF-16LE': 'utf-16le', 'UTF-16BE': 'utf-16be', 'ISO-8859-1': 'windows-1252',
  'windows-1252': 'windows-1252', ASCII: 'utf-8',
};

/** The file's text, decoded by the encoding chardet finds in its first 64 KB (RC-117: not UTF-8 only). */
export function decodeText(bytes: Uint8Array): string {
  const found = chardet.detect(bytes.subarray(0, IMPORT_LIMITS.sniffBytes)) ?? 'UTF-8';
  const label = ENCODINGS[found];
  if (label === undefined) throw new ImportFileError(`The file's text encoding (${found}) isn't supported. Save it as UTF-8 and try again.`);
  return new TextDecoder(label).decode(bytes); // TextDecoder drops a byte-order mark itself
}

const DELIMITERS = [',', ';', '\t', '|'] as const;

/** The delimiter the header line uses most, counting only outside quotes (RC-117: not comma-only). */
export function sniffDelimiter(text: string): string {
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  const unquoted = firstLine.replace(/"[^"]*"/g, '');
  const counts = DELIMITERS.map((d) => unquoted.split(d).length - 1);
  const best = Math.max(...counts);
  return best > 0 ? DELIMITERS[counts.indexOf(best)] ?? ',' : ',';
}

function readCsv(bytes: Uint8Array): Table {
  const text = decodeText(bytes);
  let records: string[][];
  try {
    // to_line stops after the cap, so an oversized file isn't parsed in full; relax_column_count keeps short rows
    // for the row check to report rather than failing the file.
    records = parse(text, { delimiter: sniffDelimiter(text), relax_column_count: true, skip_empty_lines: true,
      to_line: IMPORT_LIMITS.maxRows + 2 }) as string[][];
  } catch (e) {
    const where = e instanceof Error && 'lines' in e ? ` near line ${String(e.lines)}` : '';
    throw new ImportFileError(`The CSV file couldn't be read${where}. Check its quotes and delimiters.`);
  }
  return table(records);
}

const DAMAGED = 'The Excel file is damaged. Open it in Excel, save it again and retry.';
const TOO_BIG_UNZIPPED = `The Excel file opens up to more than ${MB(IMPORT_LIMITS.maxUnzippedBytes)}. Split it and import each part.`;
const damaged = (): never => { throw new ImportFileError(DAMAGED); };
const tooBig = (): never => { throw new ImportFileError(TOO_BIG_UNZIPPED); };
type Entry = { name: string; method: number; compressed: number; size: number; offset: number };
// What inflateRawSync gives with `info: true`; Node's types don't say so.
const isInflated = (v: unknown): v is { buffer: Buffer; engine: { bytesWritten: number } } =>
  typeof v === 'object' && v !== null && 'buffer' in v && v.buffer instanceof Buffer && 'engine' in v
  && typeof v.engine === 'object' && v.engine !== null && 'bytesWritten' in v.engine && typeof v.engine.bytesWritten === 'number';

// The central directory, as the ZIP says: its entries, refused past 1,000 or past 100 MB declared.
function centralDirectory(bytes: Uint8Array, view: DataView): { entries: Entry[]; start: number } {
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) damaged();
  const count = view.getUint16(eocd + 10, true);
  if (count > IMPORT_LIMITS.maxZipEntries) throw new ImportFileError('The Excel file has too many parts to be a plain sheet.');
  const start = view.getUint32(eocd + 16, true);
  const entries: Entry[] = [];
  let at = start;
  for (let n = 0; n < count; n++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== 0x02014b50) damaged();
    const nameLength = view.getUint16(at + 28, true);
    entries.push({ name: Buffer.from(bytes.subarray(at + 46, at + 46 + nameLength)).toString('latin1'),
      method: view.getUint16(at + 10, true), compressed: view.getUint32(at + 20, true), size: view.getUint32(at + 24, true),
      offset: view.getUint32(at + 42, true) });
    at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  if (entries.reduce((s, e) => s + e.size, 0) > IMPORT_LIMITS.maxUnzippedBytes) tooBig();
  return { entries, start };
}

/**
 * Checks the ZIP limits on what read-excel-file will actually inflate. It reads the archive as a stream, from the
 * local headers in file order, never from the central directory, so a central directory that understates its sizes
 * would get past a check of the directory alone. Here the local entries are walked from the start the same way, must
 * match the central directory one for one with nothing in between, and each is inflated against what is left of the
 * 100 MB budget, so a lie throws before more is allocated (inflated buffers are outside the worker's heap cap).
 */
function checkZip(bytes: Uint8Array): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const { entries, start } = centralDirectory(bytes, view);
  let at = 0;
  let left = IMPORT_LIMITS.maxUnzippedBytes;
  for (const e of entries) {
    if (at !== e.offset || at + 30 > start || view.getUint32(at, true) !== 0x04034b50) damaged();
    const flags = view.getUint16(at + 6, true);
    const nameLength = view.getUint16(at + 26, true);
    const name = Buffer.from(bytes.subarray(at + 30, at + 30 + nameLength)).toString('latin1');
    const descriptor = (flags & 0x08) !== 0;
    if (name !== e.name || view.getUint16(at + 8, true) !== e.method || (!descriptor
      && (view.getUint32(at + 18, true) !== e.compressed || view.getUint32(at + 22, true) !== e.size))) damaged();
    const data = at + 30 + nameLength + view.getUint16(at + 28, true);
    if (data + e.compressed > start) damaged();
    let size = e.compressed;
    if (e.method === 8) {
      let out: unknown;
      try {
        out = inflateRawSync(bytes.subarray(data, start), { maxOutputLength: Math.max(1, left), info: true });
      } catch (err) {
        if ((err as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE') tooBig();
        throw new ImportFileError(DAMAGED);
      }
      // The deflate stream must end exactly where the directory says, as a streaming reader will find it.
      if (!isInflated(out) || out.engine.bytesWritten !== e.compressed) return damaged();
      size = out.buffer.length;
    } else if (e.method !== 0) damaged();
    if (size !== e.size) damaged();
    left -= size;
    if (left < 0) tooBig();
    at = data + e.compressed;
    if (descriptor) at += at + 4 <= start && view.getUint32(at, true) === 0x08074b50 ? 16 : 12;
  }
  if (at !== start) damaged();
}

const cellText = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10); // Excel keeps dates without a zone; read as UTC
  return typeof v === 'string' ? v : String(v);
};

// Excel stores a number as the shortest text for its double, so a formula's result can read 1640.0000000000002.
// Cut to the 15 significant digits Excel shows, in decimal: the person gets the 1640 they saw.
const excelNumber = (s: string): string => {
  try {
    return new Decimal(s).toSignificantDigits(15).toFixed();
  } catch {
    return s; // not a number after all: the cell's own check reports it
  }
};

async function readExcel(bytes: Uint8Array): Promise<Table> {
  checkZip(bytes);
  let sheets: Awaited<ReturnType<typeof readXlsxFile<string>>>;
  try {
    // parseNumber keeps each number as text, so 9111.1 never becomes a float (RC-215).
    sheets = await readXlsxFile<string>(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      { parseNumber: excelNumber, trim: false });
  } catch {
    throw new ImportFileError("The Excel file couldn't be read. Old .xls files aren't supported: save it as .xlsx.");
  }
  const first = sheets[0];
  if (!first) throw new ImportFileError('The Excel file has no sheet.');
  return table(first.data.map((row) => row.map(cellText)));
}

function table(records: string[][]): Table {
  const [header, ...rows] = records;
  if (!header) throw new ImportFileError('The file is empty.');
  if (rows.length > IMPORT_LIMITS.maxRows) {
    throw new ImportFileError(`The file has more than ${IMPORT_LIMITS.maxRows.toLocaleString('en-IN')} rows. Split it and import each part.`);
  }
  return { header: header.map((h) => h.trim()), rows };
}

/** An upload's bytes, read from its stream and refused as soon as it passes the size cap (never held whole). */
export async function collectUpload(source: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of source) {
    size += chunk.length;
    if (size > IMPORT_LIMITS.maxBytes) {
      throw new ImportFileError(`The file is larger than ${MB(IMPORT_LIMITS.maxBytes)}. Split it and import each part.`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

/** Reads an uploaded CSV or .xlsx file, chosen by its first bytes, never by its name. In this thread: callers use
 * isolate.ts's readTable, which runs this in a worker. */
export async function parseTable(bytes: Uint8Array): Promise<Table> {
  if (bytes.length > IMPORT_LIMITS.maxBytes) {
    throw new ImportFileError(`The file is larger than ${MB(IMPORT_LIMITS.maxBytes)}. Split it and import each part.`);
  }
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  return zip ? readExcel(bytes) : readCsv(bytes);
}
