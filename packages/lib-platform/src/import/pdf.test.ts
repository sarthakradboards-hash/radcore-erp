// A PDF's text read in the import isolate (RAD-159; ADR-003 §7; RC-135): lines top first, pieces left to right with
// where they start; past 200 pages, or not a PDF at all, refused as ImportFileError in the worker thread.
import { testPdf } from '@radcore/test-helpers';
import { createDeflate } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { ISOLATE_LIMITS, readPdf } from './isolate.ts';
import { linesOf } from './read-pdf.ts';
import { ImportFileError, PDF_LIMITS } from './read.ts';

// Each test starts a real worker, which loads pdf.js afresh.
describe('readPdf', { timeout: 60_000 }, () => {
  it('reads each page as lines, top first, each piece with its x', async () => {
    const pages = await readPdf(testPdf([[
      'IDFC FIRST Bank statement',
      [{ text: '01-04-2026', x: 40 }, { text: 'NEFT ASHA', x: 120 }, { text: '1,000.00', x: 420 }, { text: '11,000.00', x: 500 }],
    ], ['Page two']]));
    expect(pages.map((p) => p.map((l) => l.map((x) => x.text)))).toEqual([
      [['IDFC FIRST Bank statement'], ['01-04-2026', 'NEFT ASHA', '1,000.00', '11,000.00']],
      [['Page two']],
    ]);
    expect(pages[0]?.[1]?.map((x) => Math.round(x.x))).toEqual([40, 120, 420, 500]);
  });

  it(`refuses a PDF of more than ${PDF_LIMITS.maxPages} pages, and one that isn't a PDF`, async () => {
    const long = testPdf(Array.from({ length: PDF_LIMITS.maxPages + 1 }, (_, i) => [`Page ${i + 1}`]));
    await expect(readPdf(long)).rejects.toThrow(ImportFileError);
    await expect(readPdf(long)).rejects.toThrow(/more than 200 pages/);
    await expect(readPdf(new TextEncoder().encode('%PDF-1.7 not really'))).rejects.toThrow(/couldn't be read/);
  });
});

/** A one-page PDF whose content stream inflates from a few MB to `mb` MB of zeros: a decompression bomb. */
async function bombPdf(mb: number): Promise<Uint8Array> {
  const deflate = createDeflate({ level: 9 });
  const chunks: Buffer[] = [];
  deflate.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise((resolve) => deflate.on('end', resolve));
  const zeros = Buffer.alloc(1024 * 1024);
  for (let i = 0; i < mb; i++) if (!deflate.write(zeros)) await new Promise((resolve) => deflate.once('drain', resolve));
  deflate.end();
  await done;
  const stream = Buffer.concat(chunks);
  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n')];
  const offsets: number[] = [];
  const at = () => parts.reduce((n, p) => n + p.length, 0);
  const obj = (n: number, body: Buffer) => {
    offsets[n] = at();
    parts.push(Buffer.from(`${n} 0 obj\n`), body, Buffer.from('\nendobj\n'));
  };
  obj(1, Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'));
  obj(3, Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>'));
  obj(4, Buffer.concat([Buffer.from(`<< /Length ${stream.length} /Filter /FlateDecode >>\nstream\n`), stream, Buffer.from('\nendstream')]));
  const xref = at();
  const entries = offsets.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  parts.push(Buffer.from(`xref\n0 5\n0000000000 65535 f \n${entries}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
  return Buffer.concat(parts);
}

describe('a PDF decompression bomb', { timeout: 120_000 }, () => {
  it('is refused once the process grows past the cap, ArrayBuffers counted, and the next file still reads (RC-135)', async () => {
    const bomb = await bombPdf(2048);
    // Well within the statement kind's 15 MB.
    expect(bomb.length).toBeLessThan(15 * 1024 * 1024);
    await expect(readPdf(bomb, { ...ISOLATE_LIMITS, maxGrowthMb: 256 })).rejects.toThrow(/too much memory/);
    expect((await readPdf(testPdf([['Still here']])))[0]?.[0]?.[0]?.text).toBe('Still here');
  });
});

describe('linesOf', () => {
  it('puts pieces within 2 units of one baseline on one line, and drops empty ones', () => {
    expect(linesOf([{ str: 'b', x: 90, y: 700.5 }, { str: 'a', x: 10, y: 701.9 }, { str: ' ', x: 50, y: 701 }, { str: 'c', x: 10, y: 680 }])
      .map((l) => l.map((p) => p.text))).toEqual([['a', 'b'], ['c']]);
  });
});
