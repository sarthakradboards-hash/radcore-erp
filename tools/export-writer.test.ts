// RAD-47 part 2 (RC-086, ADR-002 Exports): the export writer pages a module's rows into one CSV file, and is complete
// or fails, never cut short. Past its cap it fails `too_large` and leaves no file; a failure mid-way leaves none either.
// No database here: the rows come from a fake page function, as a module's list would give them.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { Ctx } from '../packages/lib-platform/src/ctx.ts';
import { ExportTooLarge, writeExportFile, type ExportDefinition, type ExportRow } from '../packages/lib-platform/src/export/engine.ts';

const dir = mkdtempSync(join(tmpdir(), 'export-writer-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
// The writer reads only the principal's keys, for pii columns, and hands ctx to the page function, which these ignore.
const as = (permissions: string[]) => ({ principal: { kind: 'system', name: 'test', permissions } }) as unknown as Ctx;
const ctx = as([]);

// A list of `total` rows served `per` at a time through an opaque `after`, as a screen's keyset paging would.
function list(total: number, per: number, fail?: number, pii?: ExportDefinition<unknown>['pii']): ExportDefinition<{ city: string }> {
  return {
    kind: 'crm.parties', columns: ['name', 'phone', 'balance'], ...(pii === undefined ? {} : { pii }),
    rows: async (_ctx, filter, { after }) => {
      const start = after === undefined ? 0 : Number(after);
      if (fail !== undefined && start >= fail) throw new Error('the database went away');
      const items: ExportRow[] = Array.from({ length: Math.min(per, total - start) }, (_, i) =>
        ({ name: `Party ${String(start + i)} of ${filter.city}`, phone: '+919876543210', balance: '-1250.50' }));
      const next = start + per < total ? String(start + per) : null;
      return { items, next };
    },
  };
}

describe('writeExportFile', () => {
  it('writes every row across pages, after a header, with phones and amounts as they are (RC-203)', async () => {
    const path = join(dir, 'all.csv');
    // The writer asks for pages of 1,000; this list serves 2 at a time, so 5 rows take 3 pages.
    expect(await writeExportFile(ctx, list(5, 2), { city: 'Pune' }, path, 5)).toBe(5);
    const lines = readFileSync(path, 'utf8').replace(/^﻿/, '').trimEnd().split('\n');
    expect(lines[0]).toBe('name,phone,balance');
    expect(lines.slice(1)).toEqual([0, 1, 2, 3, 4].map((n) => `Party ${String(n)} of Pune,+919876543210,-1250.50`));
  });

  it('fails too_large past its cap and leaves no file, rather than handing over a truncated one (RC-086)', async () => {
    const path = join(dir, 'big.csv');
    await expect(writeExportFile(ctx, list(6, 2), { city: 'Pune' }, path, 5)).rejects.toBeInstanceOf(ExportTooLarge);
    expect(existsSync(path)).toBe(false);
  });

  it('leaves no file when a page fails part-way', async () => {
    const path = join(dir, 'broken.csv');
    await expect(writeExportFile(ctx, list(6, 2, 4), { city: 'Pune' }, path, 100)).rejects.toThrow('the database went away');
    expect(existsSync(path)).toBe(false);
  });

  it('masks a pii column for a principal without its key, as a screen would (RAD-40)', async () => {
    const lines = async (who: Ctx, name: string) => {
      const path = join(dir, name);
      await writeExportFile(who, list(1, 2, undefined, { phone: 'last4', balance: 'pay' }), { city: 'Pune' }, path, 5);
      return readFileSync(path, 'utf8').replace(/^﻿/, '').trimEnd().split('\n').slice(1);
    };
    expect(await lines(as([]), 'masked.csv')).toEqual(['Party 0 of Pune,••••••3210,••••••']);
    expect(await lines(as(['pii:read']), 'personal.csv')).toEqual(['Party 0 of Pune,+919876543210,••••••']);
    expect(await lines(as(['pii:read', 'pay:read']), 'shown.csv')).toEqual(['Party 0 of Pune,+919876543210,-1250.50']);
  });

  it('writes the header alone for an empty list', async () => {
    const path = join(dir, 'empty.csv');
    expect(await writeExportFile(ctx, list(0, 2), { city: 'Pune' }, path, 5)).toBe(0);
    expect(readFileSync(path, 'utf8').replace(/^﻿/, '').trimEnd()).toBe('name,phone,balance');
  });
});
