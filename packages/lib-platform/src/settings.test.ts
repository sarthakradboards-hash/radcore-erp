// RC-161 in code: each setting is declared once with its type and default, values are checked on the way in and out,
// and a request answers every setting from its one read.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineSetting, saveSetting, settingRow, Settings, type Ctx } from '../src/index.ts';
import { linkMaxDays } from './links.ts';

const META = { label: 'A test setting', description: 'For a test.', input: { kind: 'text' } } as const;
const prefix = defineSetting('sales.invoice_prefix', z.string().regex(/^[A-Z]{2,5}$/), 'INV', META);
const idleMinutes = defineSetting('platform.session_idle_minutes', z.number().int().min(5).max(480), 30, META);

describe('defineSetting', () => {
  it.each(['jobs.last_run', 'period_lock', 'lock.accounts', 'Sales.prefix', 'sales.invoice-prefix'])(
    'refuses the key "%s": settings are <module>.<name>, never job state or a lock', (key) => {
      expect(() => defineSetting(key, z.string(), 'x', META)).toThrow(TypeError);
    });

  it('refuses a default its own schema refuses', () => {
    expect(() => defineSetting('sales.x', z.string().min(2), 'a', META)).toThrow();
  });

  it('refuses a setting with no label or description: the settings screen shows both (ADR-001 §8c)', () => {
    expect(() => defineSetting('sales.y', z.string(), 'a', { ...META, label: ' ' })).toThrow(/label and a description/);
    expect(() => defineSetting('sales.y', z.string(), 'a', { ...META, description: '' })).toThrow(/label and a description/);
  });
});

describe('Settings', () => {
  it('gives the default when nothing is stored, and the stored value typed when it is', () => {
    const s = new Settings([{ key: 'sales.invoice_prefix', value: 'RB' }]);
    expect(s.get(prefix)).toBe('RB');
    expect(s.get(idleMinutes)).toBe(30);
  });

  it('answers from the one read: a change after it is not seen in the same request', () => {
    const rows = [{ key: 'platform.session_idle_minutes', value: 60 }];
    const s = new Settings(rows);
    rows[0] = { key: 'platform.session_idle_minutes', value: 15 };
    expect(s.get(idleMinutes)).toBe(60);
  });

  it('throws on a stored value that no longer fits, rather than ignoring it', () => {
    expect(() => new Settings([{ key: 'platform.session_idle_minutes', value: 'soon' }]).get(idleMinutes)).toThrow(TypeError);
  });
});

describe('settingRow', () => {
  it('checks a value before it can be stored', () => {
    expect(settingRow(prefix, 'RB')).toEqual({ key: 'sales.invoice_prefix', value: 'RB' });
    expect(() => settingRow(idleMinutes, 2)).toThrow();
  });
});

// auditor-2 on #181: lib-platform exports some of its own settings, so a module's service could pass one in. saveSetting
// refuses any platform.* setting before it touches the database. A module's own (stock.*, sales.*) is written as before,
// on PostgreSQL, in tools/location-kind-labels.test.ts.
describe('saveSetting', () => {
  it.each([idleMinutes, linkMaxDays])("refuses lib-platform's own setting $key, before any write", async (def) => {
    const ctx = new Proxy({}, { get: () => { throw new Error('the database was reached'); } }) as Ctx;
    await expect(saveSetting(ctx, def, 1)).rejects.toThrow(/is lib-platform's: a module can't change it/);
    await expect(saveSetting(ctx, def, null)).rejects.toThrow(/is lib-platform's/);
  });
});
