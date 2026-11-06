// RC-198: v1's dev compose published PostgreSQL on every interface with a known password.
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const compose = readFileSync('compose.dev.yml', 'utf8');

it('binds every published port to 127.0.0.1 only', () => {
  // shortcut: line-based, assumes the short "host:container" port syntax; switch to `docker compose config` in CI.
  const ports = [...compose.matchAll(/^\s*-\s*"?([^"\n]+:\d+)"?\s*$/gm)].map((m) => m[1]);
  expect(ports.length).toBeGreaterThan(0);
  for (const p of ports) expect(p).toMatch(/^127\.0\.0\.1:\d+:\d+$/);
});

it('commits no password: each secret is a required variable from the generated .env', () => {
  const secrets = [...compose.matchAll(/^\s*(\w*(PASSWORD|SECRET)\w*):\s*(.+)$/gm)];
  expect(secrets.length).toBeGreaterThan(0);
  for (const [, , , value] of secrets) expect(value).toMatch(/^"?\$\{\w+:\?[^}]*\}"?$/);
});

it('commits no access key either', () => {
  expect(compose).toMatch(/AWS_ACCESS_KEY_ID:\s*\$\{S3_ACCESS_KEY_ID:\?/);
});

it('runs the production PostgreSQL major version', () => {
  expect(compose).toMatch(/image:\s*postgres:16[.\-]/);
});

it('pins every image by digest', () => {
  const images = [...compose.matchAll(/^\s*image:\s*(\S+)\s*$/gm)].map((m) => m[1]);
  expect(images.length).toBe(2);
  for (const image of images) expect(image).toMatch(/^[\w./-]+:[\w.-]+@sha256:[0-9a-f]{64}$/);
});
