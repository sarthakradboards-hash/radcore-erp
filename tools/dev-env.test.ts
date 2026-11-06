import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { writeDevEnv } from './dev-env.ts';

const tmp = () => join(mkdtempSync(join(tmpdir(), 'radcore-env-')), '.env');

it('generates distinct random passwords', () => {
  const file = tmp();
  expect(writeDevEnv(file)).toBe(true);
  const env = Object.fromEntries(readFileSync(file, 'utf8').trim().split('\n').map((l) => l.split('=', 2)));
  expect(env.POSTGRES_PASSWORD).toMatch(/^[A-Za-z0-9_-]{32,}$/);
  expect(env.MINIO_ROOT_PASSWORD).toMatch(/^[A-Za-z0-9_-]{32,}$/);
  expect(env.POSTGRES_PASSWORD).not.toBe(env.MINIO_ROOT_PASSWORD);
  expect(env.DATABASE_URL).toBe(`postgres://radcore:${env.POSTGRES_PASSWORD}@127.0.0.1:5432/radcore`);
});

it('never overwrites an existing .env', () => {
  const file = tmp();
  writeFileSync(file, 'POSTGRES_PASSWORD=keep\n');
  expect(writeDevEnv(file)).toBe(false);
  expect(readFileSync(file, 'utf8')).toBe('POSTGRES_PASSWORD=keep\n');
});
