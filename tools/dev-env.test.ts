import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '@radcore/lib-platform';
import { expect, it } from 'vitest';
import { writeDevEnv } from './dev-env.ts';

const tmp = () => join(mkdtempSync(join(tmpdir(), 'radcore-env-')), '.env');
const SECRET = /^[A-Za-z0-9_-]{32,}$/;

it('generates distinct random credentials', () => {
  const file = tmp();
  expect(writeDevEnv(file)).toBe(true);
  const env = Object.fromEntries(readFileSync(file, 'utf8').trim().split('\n').map((l) => l.split('=', 2)));
  expect(env['POSTGRES_PASSWORD']).toMatch(SECRET);
  expect(env['S3_ACCESS_KEY_ID']).toMatch(/^[A-Z0-9]{20}$/);
  expect(env['S3_SECRET_ACCESS_KEY']).toMatch(SECRET);
  expect(env['POSTGRES_PASSWORD']).not.toBe(env['S3_SECRET_ACCESS_KEY']);
  expect(env['DATABASE_URL']).toBe(`postgres://radcore:${env['POSTGRES_PASSWORD']}@127.0.0.1:5432/radcore`);
  expect(env['S3_ENDPOINT']).toBe('http://127.0.0.1:8333');
  expect(env['MIGRATION_DATABASE_URL']).toBe(env['DATABASE_URL']);
});

it('adds MIGRATION_DATABASE_URL to an .env from before RAD-25, as its DATABASE_URL', () => {
  const file = tmp();
  writeFileSync(file, 'DATABASE_URL=postgres://radcore:old@127.0.0.1:5432/radcore\n');
  writeDevEnv(file);
  expect(parse(file)['MIGRATION_DATABASE_URL']).toBe('postgres://radcore:old@127.0.0.1:5432/radcore');
});

const parse = (file: string): Record<string, string> => Object.fromEntries(readFileSync(file, 'utf8').split('\n')
  .filter((l) => l !== '' && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));

it('never overwrites an existing .env, and appends only the settings it lacks', () => {
  const file = tmp();
  writeFileSync(file, 'POSTGRES_PASSWORD=keep\nLOG_LEVEL=debug');
  expect(writeDevEnv(file)).toBe(false);
  const text = readFileSync(file, 'utf8');
  expect(text.startsWith('POSTGRES_PASSWORD=keep\nLOG_LEVEL=debug\nNODE_ENV=development\n')).toBe(true);
  expect(parse(file)['LOG_LEVEL']).toBe('debug');
  expect(text.match(/^LOG_LEVEL=/gm)).toHaveLength(1);
  expect(writeDevEnv(file)).toBe(false);
  expect(readFileSync(file, 'utf8')).toBe(text);
});

// RAD-28: `npm run dev` must start under the settings check.
it.each(['api', 'worker'] as const)('writes settings the %s accepts', (proc) => {
  const file = tmp();
  writeDevEnv(file);
  expect(() => loadConfig(parse(file), proc)).not.toThrow();
});
