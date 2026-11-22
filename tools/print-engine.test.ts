// RAD-120 (RC-152; the architect's ruling): the print engine, through its pool of threads. A document renders on A4
// and on the 80 mm roll with ₹ in Noto Sans; one past 50 pages is refused too_large; a render past its time limit is
// answered server_error and the next one works. Read straight from the PDF: its page sizes, and its fonts' ToUnicode
// maps, which name ₹ (U+20B9) only if it was drawn with the bundled font, since the standard fonts lack it.
import { rmSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { AppError, createPrintPool, PAPERS, type PrintBlock, type PrintPool } from '@radcore/lib-platform';
import { afterAll, describe, expect, it } from 'vitest';
import { crashMarker } from './print-crash-thread.ts';

const invoice: PrintBlock[] = [
  { kind: 'heading', text: 'Tax invoice INV/2026-27/0001' },
  { kind: 'pairs', rows: [['GSTIN', '27AAPFU0939F1ZV'], ['Place of supply', '27 Maharashtra']] },
  { kind: 'table', columns: [{ label: 'Item', share: 4 }, { label: 'HSN', share: 2, onThermal: false }, { label: 'Qty', share: 1, align: 'right' },
    { label: 'Amount', share: 2, align: 'right' }], rows: [['Scooter', '87116020', '1', '₹ 80,000.00']] },
  { kind: 'rule' },
  { kind: 'totals', rows: [{ label: 'CGST 2.5%', value: '₹ 2,000.00' }, { label: 'Total', value: '₹ 84,000.00', strong: true }] },
];
const text = (pdf: Uint8Array) => Buffer.from(pdf).toString('latin1');
/** Every page's size, as [width, height], from its MediaBox. */
const pages = (pdf: Uint8Array) => [...text(pdf).matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)].map(([, w, h]) => [Number(w), Number(h)]);
/** Every compressed stream, inflated. */
const streams = (pdf: Uint8Array) => [...text(pdf).matchAll(/stream\r?\n/g)].flatMap((m) => {
  const start = (m.index ?? 0) + m[0].length;
  const body = Buffer.from(pdf).subarray(start, text(pdf).indexOf('endstream', start));
  try {
    return [inflateSync(body).toString('latin1')];
  } catch {
    return [];
  }
});
const failure = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof AppError ? e.code : String(e)));

describe('the print engine', () => {
  const opened: PrintPool[] = [];
  const pool = (o: Parameters<typeof createPrintPool>[0] = {}) => {
    const p = createPrintPool({ size: 1, ...o });
    opened.push(p);
    return p;
  };
  afterAll(async () => {
    await Promise.all(opened.map((p) => p.close()));
  });

  it('renders an invoice on A4 and on the 80 mm roll, with ₹ drawn in the bundled font', async () => {
    const p = pool();
    const [a4, roll] = [await p.render(invoice, 'a4', 'INV/2026-27/0001'), await p.render(invoice, 'thermal80', 'INV/2026-27/0001')];
    expect(text(a4).startsWith('%PDF-')).toBe(true);
    expect(pages(a4).map(([w = 0, h = 0]) => [Math.round(w), Math.round(h)])).toEqual([[595, 842]]);
    // One page, the roll's width, as tall as its lines.
    const [[width = 0, height = 0] = []] = pages(roll);
    expect([pages(roll).length, Math.round(width), height > 120 && height < 600]).toEqual([1, Math.round(PAPERS.thermal80.width), true]);
    for (const pdf of [a4, roll]) expect(streams(pdf).some((s) => /<20b9>/i.test(s)), 'a ToUnicode entry for ₹').toBe(true);
    // No creation date: a reprint is the same file.
    expect(Buffer.from(await p.render(invoice, 'a4', 'INV/2026-27/0001')).equals(Buffer.from(a4))).toBe(true);
  }, 60_000);

  it('refuses a document past 50 pages as too_large', async () => {
    const rows = Array.from({ length: 4000 }, (_, i) => [`Line ${i + 1}`, '87116020', '1', '₹ 1.00']);
    const long: PrintBlock[] = [{ kind: 'table', columns: [{ label: 'Item', share: 4 }, { label: 'HSN', share: 2 }, { label: 'Qty', share: 1 },
      { label: 'Amount', share: 2 }], rows }];
    expect(await failure(pool().render(long, 'a4', 'Long'))).toBe('too_large');
  }, 120_000);

  // The auditor on #317: a thread that throws as it loads (its fonts missing), or goes past its heap, is the job's
  // server_error, never an unhandled 'error' that takes the api down; and the next print starts a thread again.
  it('answers a thread that dies as it loads with server_error, keeps the process up, and renders once it loads again', async () => {
    writeFileSync(crashMarker(), '');
    try {
      const p = pool({ entry: new URL('./print-crash-thread.ts', import.meta.url) });
      const first = await p.render(invoice, 'a4', 'Crash').then(() => null, (e: unknown) => e);
      expect([first instanceof AppError ? first.code : String(first), String(first)]).toEqual(['server_error', expect.stringContaining('the fonts did not load')]);
      rmSync(crashMarker());
      expect(text(await p.render(invoice, 'a4', 'After')).startsWith('%PDF-')).toBe(true);
    } finally {
      rmSync(crashMarker(), { force: true });
    }
  }, 60_000);

  it('answers a thread past its heap with server_error, and the process stays up', async () => {
    // A heap too small to load the PDF library: the thread runs out of memory (ERR_WORKER_OUT_OF_MEMORY) as it starts.
    const p = pool({ heapMb: 4 });
    expect(await failure(p.render(invoice, 'a4', 'Too big'))).toBe('server_error');
  }, 60_000);

  it('refuses a print past 20 waiting as rate_limited, and fails what waits when the pool closes', async () => {
    const p = createPrintPool({ size: 1, renderMs: 30_000, entry: new URL('./print-stall-thread.ts', import.meta.url) });
    // All asked for at once, before the thread is ready to take any: 20 wait, and the next is refused.
    const waiting = Array.from({ length: 20 }, () => failure(p.render(invoice, 'a4', 'stall')));
    expect(await failure(p.render(invoice, 'a4', 'stall'))).toBe('rate_limited');
    await p.close();
    expect(new Set(await Promise.all(waiting))).toEqual(new Set(['server_error']));
  }, 60_000);

  it('answers a render past its time limit with server_error, and renders the next one', async () => {
    // Time counts from the ask, so the next print also waits for its new thread to start: 5 s leaves room under load.
    const p = pool({ renderMs: 5000, entry: new URL('./print-stall-thread.ts', import.meta.url) });
    expect(await failure(p.render(invoice, 'a4', 'stall'))).toBe('server_error');
    expect(text(await p.render(invoice, 'a4', 'After')).startsWith('%PDF-')).toBe(true);
  }, 60_000);
});
