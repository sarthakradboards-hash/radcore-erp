// Blocks to a PDF (RAD-120): the one file that imports @react-pdf/renderer, run only inside the print pool's threads
// (pool.ts), never on the api's event loop. Fonts come from the bundled Noto Sans files as bytes, and images are bytes,
// so the library never fetches anything (ADR-003 §7). Noto Sans's `latin` file has the letters and its `latin-ext`
// file has ₹ (U+20B9), which the PDF standard fonts lack; every text falls back from one to the other.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Document, Font, Image, Page, renderToBuffer, Text, View } from '@react-pdf/renderer';
import { createElement as h, type ReactElement } from 'react';
import type { Paper } from '../contract/print.ts';
import { PAPERS, PRINT_LIMITS, type PrintBlock } from './blocks.ts';

const fontFile = (name: string) => `data:font/woff;base64,${readFileSync(createRequire(import.meta.url)
  .resolve(`@fontsource/noto-sans/files/noto-sans-${name}.woff`)).toString('base64')}`;
for (const [family, subset] of [['NotoSans', 'latin'], ['NotoSansExt', 'latin-ext']] as const) {
  Font.register({ family, fonts: [{ src: fontFile(`${subset}-400-normal`) }, { src: fontFile(`${subset}-700-normal`), fontWeight: 700 }] });
}
// A word is never split with a hyphen: a GSTIN or an invoice number must read whole.
Font.registerHyphenationCallback((word) => [word]);
const FONTS = ['NotoSans', 'NotoSansExt'];

/** The document was past PRINT_LIMITS.pages: the pool answers it `too_large`. */
export class TooLarge extends Error {
  override name = 'TooLarge';
}

const LINE = 1.35;
const GAP = 4;
/**
 * How tall these blocks run on `paper`, in points, margins aside: lines of text by the width they wrap at, the
 * images and the gaps.
 * shortcut: an estimate from character counts, since react-pdf has no auto height and lays out slowly (about 47 A4
 * pages of rows take it past 10 s here). Measure the laid-out page instead if the roll's few spare millimetres or a
 * near-50-page refusal are ever a nuisance.
 */
function contentHeight(blocks: readonly PrintBlock[], paper: Paper): number {
  const p = PAPERS[paper];
  const width = p.width - 2 * p.margin;
  const perLine = (size: number, share = 1) => Math.max(1, Math.floor((width * share) / (size * 0.55)));
  const lines = (text: string, size: number, share = 1) => Math.max(1, Math.ceil(text.length / perLine(size, share)));
  const body = (n: number, size = p.fontSize) => n * size * LINE;
  return blocks.reduce((sum, b) => sum + GAP + (() => {
    switch (b.kind) {
      case 'heading': return body(lines(b.text, p.fontSize + 3), p.fontSize + 3);
      case 'text': return body(lines(b.text, b.small === true ? p.fontSize - 1 : p.fontSize));
      case 'pairs': return body(b.rows.reduce((n, [l, v]) => n + lines(`${l}: ${v}`, p.fontSize), 0));
      case 'table': {
        const shown = (cells: readonly string[]) => b.columns.flatMap((c, i) => (paper === 'thermal80' && c.onThermal === false ? [] : [{ c, text: cells[i] ?? '' }]));
        const all = shown(b.columns.map((c) => c.label)).reduce((n, x) => n + x.c.share, 0);
        const row = (cells: readonly string[]) => Math.max(...shown(cells).map((x) => lines(x.text, p.fontSize, x.c.share / all)));
        return body(row(b.columns.map((c) => c.label)) + b.rows.reduce((n, r) => n + row(r), 0)) + 2 * (b.rows.length + 1);
      }
      case 'totals': return body(b.rows.length);
      case 'image': return b.width;
      case 'rule': return 2;
    }
  })(), 0);
}

/** The 80 mm roll's height for these blocks, erring long so nothing spills onto a second page. */
const thermalHeight = (blocks: readonly PrintBlock[]) =>
  Math.ceil((contentHeight(blocks, 'thermal80') + 2 * PAPERS.thermal80.margin) * 1.1 + 12);

const align = (a: 'left' | 'center' | 'right' | undefined) => ({ textAlign: a ?? 'left' }) as const;

function blockOf(b: PrintBlock, paper: Paper, key: number): ReactElement {
  const size = PAPERS[paper].fontSize;
  const thermal = paper === 'thermal80';
  switch (b.kind) {
    case 'heading':
      return h(Text, { key, style: { fontSize: size + 3, fontWeight: 700, marginBottom: GAP, ...align(thermal ? 'center' : 'left') } }, b.text);
    case 'text':
      return h(Text, { key, style: { fontSize: b.small === true ? size - 1 : size, fontWeight: b.bold === true ? 700 : 400,
        marginBottom: GAP, ...align(b.align) } }, b.text);
    case 'pairs':
      return h(View, { key, style: { marginBottom: GAP } }, b.rows.map(([label, value], i) =>
        h(View, { key: i, style: { flexDirection: 'row' } },
          h(Text, { style: { width: thermal ? '38%' : '28%', fontWeight: 700 } }, label),
          h(Text, { style: { width: thermal ? '62%' : '72%' } }, value))));
    case 'table': {
      const cols = b.columns.map((c, i) => ({ ...c, i })).filter((c) => !thermal || c.onThermal !== false);
      const all = cols.reduce((n, c) => n + c.share, 0);
      const row = (cells: readonly string[], head: boolean, k: number) => h(View, { key: k, wrap: false, style: { flexDirection: 'row',
        borderBottomWidth: head ? 0.75 : 0.25, borderColor: '#000', paddingVertical: 1 } }, cols.map((c) =>
        h(Text, { key: c.i, style: { width: `${(c.share / all) * 100}%`, paddingRight: 2, fontWeight: head ? 700 : 400,
          ...align(c.align) } }, cells[c.i] ?? '')));
      return h(View, { key, style: { marginBottom: GAP } }, [row(b.columns.map((c) => c.label), true, -1),
        ...b.rows.map((r, i) => row(r, false, i))]);
    }
    case 'totals':
      return h(View, { key, style: { marginBottom: GAP, alignItems: 'flex-end' } }, b.rows.map((r, i) =>
        h(View, { key: i, style: { flexDirection: 'row', width: thermal ? '100%' : '45%' } },
          h(Text, { style: { width: '60%', fontWeight: r.strong === true ? 700 : 400 } }, r.label),
          h(Text, { style: { width: '40%', textAlign: 'right', fontWeight: r.strong === true ? 700 : 400 } }, r.value))));
    case 'image':
      return h(Image, { key, src: { data: Buffer.from(b.png), format: 'png' }, style: { width: b.width, height: b.width, marginBottom: GAP,
        alignSelf: thermal ? 'center' : 'flex-start' } });
    case 'rule':
      return h(View, { key, style: { borderBottomWidth: 0.5, borderColor: '#000', marginBottom: GAP } });
  }
}

/** The PDF's pages, counted from its page objects. */
const pagesOf = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type\s*\/Page\b(?!s)/g) ?? []).length;

/** Blocks to a PDF on `paper`: deterministic (no creation date), refused past PRINT_LIMITS.pages. */
export async function renderBlocks(blocks: readonly PrintBlock[], paper: Paper, title: string): Promise<Buffer> {
  const p = PAPERS[paper];
  // A document plainly past the page limit is refused before the slow layout starts; the count after is the backstop.
  if (p.height !== null && contentHeight(blocks, paper) / (p.height - 2 * p.margin) > PRINT_LIMITS.pages) {
    throw new TooLarge(`more than ${PRINT_LIMITS.pages} pages`);
  }
  const size = p.height === null ? [p.width, thermalHeight(blocks)] : [p.width, p.height];
  const doc = h(Document, { title, author: '', creator: 'RadCore', producer: 'RadCore', creationDate: new Date(0), modificationDate: new Date(0) },
    h(Page, { size: { width: size[0] ?? p.width, height: size[1] ?? p.width }, style: { padding: p.margin, fontFamily: FONTS,
      fontSize: p.fontSize, lineHeight: LINE } }, blocks.map((b, i) => blockOf(b, paper, i))));
  const pdf = await renderToBuffer(doc);
  if (pagesOf(pdf) > PRINT_LIMITS.pages) throw new TooLarge(`more than ${PRINT_LIMITS.pages} pages`);
  return pdf;
}
