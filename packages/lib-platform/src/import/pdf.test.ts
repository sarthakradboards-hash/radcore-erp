// A PDF's text read in the import isolate (RAD-159; ADR-003 §7; RC-135): lines top first, pieces left to right with
// where they start; past 200 pages, or not a PDF at all, refused as ImportFileError in the worker thread.
import { testPdf } from '@radcore/test-helpers';
import { describe, expect, it } from 'vitest';
import { readPdf } from './isolate.ts';
import { linesOf, PDF_LIMITS } from './read-pdf.ts';
import { ImportFileError } from './read.ts';

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

describe('linesOf', () => {
  it('puts pieces within 2 units of one baseline on one line, and drops empty ones', () => {
    expect(linesOf([{ str: 'b', x: 90, y: 700.5 }, { str: 'a', x: 10, y: 701.9 }, { str: ' ', x: 50, y: 701 }, { str: 'c', x: 10, y: 680 }])
      .map((l) => l.map((p) => p.text))).toEqual([['a', 'b'], ['c']]);
  });
});
