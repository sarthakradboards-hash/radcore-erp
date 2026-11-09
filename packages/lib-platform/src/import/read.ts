// Reading an uploaded file into a table (M1-28, RC-117): CSV in any common delimiter and encoding, or Excel (.xlsx),
// within ADR-003's parser limits. Every cell comes back as the text the file holds: Excel numbers too (never a
// JavaScript number), and Excel dates as YYYY-MM-DD. Turning cells into amounts and dates, with an error per row, is
// cells.ts. Files are only ever passed in as bytes: read-excel-file would read a string as a path.
import chardet from 'chardet';
import { parse } from 'csv-parse/sync';
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

// The ZIP central directory lists each entry's uncompressed size, so an Excel file that would unzip past the limits
// is refused before anything is inflated. A file that lies about its sizes is caught by the worker's memory cap.
function checkZip(bytes: Uint8Array): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new ImportFileError("The Excel file is damaged. Open it in Excel, save it again and retry.");
  const entries = view.getUint16(eocd + 10, true);
  if (entries > IMPORT_LIMITS.maxZipEntries) throw new ImportFileError('The Excel file has too many parts to be a plain sheet.');
  let at = view.getUint32(eocd + 16, true);
  let unzipped = 0;
  for (let n = 0; n < entries; n++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== 0x02014b50) {
      throw new ImportFileError("The Excel file is damaged. Open it in Excel, save it again and retry.");
    }
    unzipped += view.getUint32(at + 24, true);
    at += 46 + view.getUint16(at + 28, true) + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  if (unzipped > IMPORT_LIMITS.maxUnzippedBytes) {
    throw new ImportFileError(`The Excel file opens up to more than ${MB(IMPORT_LIMITS.maxUnzippedBytes)}. Split it and import each part.`);
  }
}

const cellText = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10); // Excel keeps dates without a zone; read as UTC
  return typeof v === 'string' ? v : String(v);
};

async function readExcel(bytes: Uint8Array): Promise<Table> {
  checkZip(bytes);
  let sheets: Awaited<ReturnType<typeof readXlsxFile<string>>>;
  try {
    // parseNumber keeps each number as the text the file holds, so 9111.1 never becomes a float (RC-215).
    sheets = await readXlsxFile<string>(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      { parseNumber: (s: string) => s, trim: false });
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

/** Reads an uploaded CSV or .xlsx file, chosen by its first bytes, never by its name. */
export async function readTable(bytes: Uint8Array): Promise<Table> {
  if (bytes.length > IMPORT_LIMITS.maxBytes) {
    throw new ImportFileError(`The file is larger than ${MB(IMPORT_LIMITS.maxBytes)}. Split it and import each part.`);
  }
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  return zip ? readExcel(bytes) : readCsv(bytes);
}
