// ADR-003 §3's CSV formula guard, through the writer every export uses (M1-29): a cell a spreadsheet would run is
// escaped, and a plain decimal or date is not.
import { describe, expect, it } from 'vitest';
import { csvWriter } from '../index.ts';

async function csv(columns: string[], rows: string[][]): Promise<string> {
  const writer = csvWriter(columns);
  const chunks: string[] = [];
  writer.on('data', (c: Buffer | string) => chunks.push(c.toString()));
  const done = new Promise<void>((resolve, reject) => { writer.on('end', resolve); writer.on('error', reject); });
  for (const row of rows) writer.write(row);
  writer.end();
  await done;
  return chunks.join('');
}

describe('csvWriter', () => {
  it('starts with a byte-order mark and the header row', async () => {
    expect(await csv(['Party', 'Amount'], [['Asha Motors', '9111.00']])).toBe('﻿Party,Amount\nAsha Motors,9111.00\n');
  });

  it.each(['=1+1', '+cmd|calc', '-2+3', '@SUM(A1)', '\tx', '\rx', '＝1', '－12', '＋1'])(
    'escapes "%s", which a spreadsheet would run', async (value) => {
      const line = (await csv(['Note'], [[value]])).split('\n')[1] ?? '';
      expect(line.replace(/^"/, '').startsWith("'")).toBe(true);
    });

  it.each(['-1250.50', '9111', '0.375', '2026-11-07'])('writes the plain decimal or date "%s" as it is', async (value) => {
    expect((await csv(['Value'], [[value]])).split('\n')[1]).toBe(value);
  });

  it('quotes a cell with a comma or a quote, so a row never splits', async () => {
    expect((await csv(['Narration'], [['Tea, "snacks"']])).split('\n')[1]).toBe('"Tea, ""snacks"""');
  });
});
