// RAD-50: in development and CI the browser's /api calls reach the api through Next. Anywhere else (deployed, the
// Vercel review copy, or an unset or misspelled APP_ENV) there is no rewrite, and Caddy routes /api.
import { afterEach, expect, it, vi } from 'vitest';
import config from './next.config';

afterEach(() => vi.unstubAllEnvs());

const rewritesWith = async (appEnv: string | undefined, api: string | undefined) => {
  vi.stubEnv('APP_ENV', appEnv);
  vi.stubEnv('API_INTERNAL_URL', api);
  return config.rewrites?.();
};

it.each(['development', 'ci'])('rewrites /api to API_INTERNAL_URL in %s', async (appEnv) => {
  expect(await rewritesWith(appEnv, 'http://127.0.0.1:3001/'))
    .toEqual([{ source: '/api/:path*', destination: 'http://127.0.0.1:3001/:path*' }]);
});

it.each(['staging', 'production', 'review', 'Development', 'prod', undefined])('has no rewrite when APP_ENV is %s', async (appEnv) => {
  expect(await rewritesWith(appEnv, 'http://127.0.0.1:3001')).toEqual([]);
});

it('has no rewrite without API_INTERNAL_URL', async () => {
  expect(await rewritesWith('development', undefined)).toEqual([]);
});
