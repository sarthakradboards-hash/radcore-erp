// RC-161 in code: each setting is declared once with its type and default, values are checked on the way in and out,
// and a request answers every setting from its one read.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineSetting, settingRow, Settings } from '../src/index.ts';

const prefix = defineSetting('sales.invoice_prefix', z.string().regex(/^[A-Z]{2,5}$/), 'INV');
const idleMinutes = defineSetting('platform.session_idle_minutes', z.number().int().min(5).max(480), 30);

describe('defineSetting', () => {
  it.each(['jobs.last_run', 'period_lock', 'lock.accounts', 'Sales.prefix', 'sales.invoice-prefix'])(
    'refuses the key "%s": settings are <module>.<name>, never job state or a lock', (key) => {
      expect(() => defineSetting(key, z.string(), 'x')).toThrow(TypeError);
    });

  it('refuses a default its own schema refuses', () => {
    expect(() => defineSetting('sales.x', z.string().min(2), 'a')).toThrow();
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
