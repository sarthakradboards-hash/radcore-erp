// The workbook writer (RAD-92): one XLSX file with a sheet per list, for an export that is several lists in one (the
// masters workbook), on write-excel-file (ADR-003). Each sheet is its header row, in bold, then its rows, in its
// columns' order. Text goes in as text, never as a formula, so a cell starting `=` or `+` is only ever shown.
// shortcut: write-excel-file builds the whole file in memory, so a workbook's rows are gathered first; fine at master
// sizes (thousands of rows), not for a ledger. Use a streaming writer if a workbook ever holds one.
import writeXlsxFile from 'write-excel-file/node';
import type { ExportRow } from './engine.ts';

/** One sheet as it's written: its name, its columns in order (each a key of the rows) and its rows. */
export type WorkbookSheet = { readonly name: string; readonly columns: readonly string[]; readonly rows: readonly ExportRow[] };

/** Writes the sheets to `path` as one XLSX workbook. */
export async function writeXlsx(path: string, sheets: readonly WorkbookSheet[]): Promise<void> {
  await writeXlsxFile(sheets.map((s) => ({
    sheet: s.name,
    data: [s.columns.map((c) => ({ value: c, fontWeight: 'bold' as const })), ...s.rows.map((r) => s.columns.map((c) => r[c] ?? null))],
  }))).toFile(path);
}
