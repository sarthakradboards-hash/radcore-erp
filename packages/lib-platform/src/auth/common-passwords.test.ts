// RAD-32 (ADR-003 §3): the bundled common-password list. The real file isn't in the repository yet: until it is, a
// deployed api refuses to start, and development and CI use a small hand-made fixture.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { COMMON_PASSWORDS_FIXTURE, loadCommonPasswords } from './common-passwords.ts';

const missing = join(mkdtempSync(join(tmpdir(), 'radcore-list-')), 'none.txt');
const log = () => ({ info: vi.fn<(m: string) => void>(), error: vi.fn<(m: string, e?: unknown) => void>() });

describe('the bundled common-password list', () => {
  it('reads one lower-cased password per line, skipping comments and blank lines', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'radcore-list-')), 'list.txt');
    writeFileSync(file, '# a comment\nPasswordPassword1\r\n\n  spaces kept inside  \n');
    expect([...loadCommonPasswords('production', log(), file)].sort()).toEqual(['  spaces kept inside  ', 'passwordpassword1']);
  });

  it.each(['staging', 'production'] as const)('refuses to start in %s without the real list', (appEnv) => {
    expect(() => loadCommonPasswords(appEnv, log(), missing)).toThrow(/common-password list/);
  });

  it.each(['development', 'ci', 'review'] as const)('uses the fixture in %s without the real list, and says so', (appEnv) => {
    const l = log();
    const list = loadCommonPasswords(appEnv, l, missing);
    expect(list.has('correcthorsebatterystaple')).toBe(true);
    expect(l.info).toHaveBeenCalledWith(expect.stringContaining(COMMON_PASSWORDS_FIXTURE.split(/[\/]/).at(-1) ?? ''));
  });
});
