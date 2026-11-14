import { expect, it } from 'vitest';
import { webSettings } from './dev.ts';

const ROOT_ENV = [
  'DATABASE_URL=postgres://radcore_app:secret@127.0.0.1:5432/radcore',
  'SECRETS_LOCAL_KEY=abc',
  'S3_SECRET_ACCESS_KEY=def',
  'APP_ENV=development',
  'API_INTERNAL_URL=http://127.0.0.1:3001',
  'PUBLIC_ORIGIN=http://127.0.0.1:3000',
  'S3_FILES_ORIGIN=http://127.0.0.1:8333',
].join('\n');

it('takes only the settings web reads from the root .env (auditor on #88)', () => {
  expect(webSettings(ROOT_ENV, {})).toEqual({
    APP_ENV: 'development', API_INTERNAL_URL: 'http://127.0.0.1:3001', PUBLIC_ORIGIN: 'http://127.0.0.1:3000',
    S3_FILES_ORIGIN: 'http://127.0.0.1:8333',
  });
});

it('lets a value already in the environment win', () => {
  expect(webSettings(ROOT_ENV, { APP_ENV: 'ci' })['APP_ENV']).toBe('ci');
});
