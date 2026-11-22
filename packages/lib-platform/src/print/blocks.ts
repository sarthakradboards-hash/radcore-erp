// Printouts (RAD-120, RC-152; the architect's ruling): what a document's template lays out. A template turns its
// document into these blocks, plain data, and only render.ts turns blocks into a PDF, so only that file imports the
// PDF library and React. Images are bytes, never URLs (ADR-003 §7).
import type { Paper } from '../contract/print.ts';
import type { Ctx } from '../ctx.ts';

export type PrintBlock =
  | { kind: 'heading'; text: string }
  | { kind: 'text'; text: string; align?: 'left' | 'center' | 'right'; bold?: boolean; small?: boolean }
  /** Label and value rows: "GSTIN: …", "Place of supply: …". */
  | { kind: 'pairs'; rows: readonly (readonly [label: string, value: string])[] }
  /** `share` is each column's part of the width. A column with `onThermal: false` is left off the 80 mm roll. */
  | { kind: 'table'; columns: readonly { label: string; share: number; align?: 'right'; onThermal?: boolean }[];
    rows: readonly (readonly string[])[] }
  | { kind: 'totals'; rows: readonly { label: string; value: string; strong?: boolean }[] }
  /** A PNG's bytes, `width` points wide and as tall: the IRN's QR code (RC-116), a logo. */
  | { kind: 'image'; png: Uint8Array; width: number }
  | { kind: 'rule' };

/** A printable document, declared by its module: how it's read at the printer's scope, its title, how it lays out. */
export type PrintDef<M> = {
  read(ctx: Ctx, id: string): Promise<M>;
  title(model: M): string;
  layout(model: M, paper: Paper): readonly PrintBlock[];
};

/** Each paper in points (1 mm = 72 / 25.4). The 80 mm roll has no fixed height: render.ts works it out. */
export const PAPERS: Readonly<Record<Paper, { width: number; height: number | null; margin: number; fontSize: number }>> = {
  a4: { width: 595.28, height: 841.89, margin: 36, fontSize: 9 },
  // About 4 mm a side, so the text sits in the roll's printable 72 mm (the architect on RAD-120).
  thermal80: { width: 226.77, height: null, margin: 11.34, fontSize: 8 },
};

/** The printing limits (ADR-003 §7): pages a document may have, how long a render may take, a thread's heap. */
export const PRINT_LIMITS = { pages: 50, renderMs: 10_000, heapMb: 256 } as const;
