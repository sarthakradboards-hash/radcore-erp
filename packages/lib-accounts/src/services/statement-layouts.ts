// The PDF statement layouts (M5-11, RAD-159; ADR-009 §11): one per bank the company uses, written in code from that
// bank's own statement. A layout knows its bank's PDF by what it says, and turns its lines into the same table a CSV
// gives, read by the layout's own column headings. A PDF no layout knows is refused (`statement_layout_unknown`), and
// the person uploads the bank's CSV or Excel instead.
import type { PdfPages, Table } from '@radcore/lib-platform';
import type { StatementFormat } from './statement-read.ts';

export type StatementLayout = {
  /** The bank, as the refusal and the import name it. */
  readonly bank: string;
  /** Whether these pages are this bank's statement (its name and the heading row, say). */
  matches(pages: PdfPages): boolean;
  /** The statement as a table, with the format that reads it. */
  read(pages: PdfPages): { table: Table; format: StatementFormat };
};

// shortcut: no bank's layout yet. Each is written from a masked sample of that bank's PDF statement, asked of Sarthak
// on RAD-159; until one lands, every PDF is refused and the bank's CSV or Excel imports instead.
export const STATEMENT_LAYOUTS: readonly StatementLayout[] = [];
