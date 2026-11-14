// RAD-29 (RC-158), web side: uncaught errors and rejections go to /api/client-errors through the contract, capped per
// page load; a report that fails is dropped without an error of its own; stopping the listener stops the reports.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { listenForClientErrors, reportClientError, resetReportCount } from './report.ts';

const setup = (status = 200) => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response('{}', { status }));
  const win = Object.assign(new EventTarget(), { location: { pathname: '/admin/users' } });
  vi.stubGlobal('window', win);
  vi.stubGlobal('fetch', fetch);
  const bodies = () => fetch.mock.calls.map(([url, init]) => [url, JSON.parse(String(init?.body)) as Record<string, unknown>]);
  return { fetch, win, bodies };
};

beforeEach(() => resetReportCount());
afterEach(() => vi.unstubAllGlobals());

it('reports an uncaught error and an unhandled rejection, same-origin, until stopped', () => {
  const { win, bodies } = setup();
  const stop = listenForClientErrors();
  const thrown = new TypeError('x is undefined');
  win.dispatchEvent(Object.assign(new Event('error'), { error: thrown, message: thrown.message }));
  win.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: 'gave up' }));
  stop();
  win.dispatchEvent(Object.assign(new Event('error'), { error: thrown, message: thrown.message }));
  expect(bodies()).toEqual([
    ['/api/client-errors', { kind: 'error', name: 'TypeError', message: 'x is undefined', page: '/admin/users', stack: thrown.stack }],
    ['/api/client-errors', { kind: 'unhandledrejection', name: 'Error', message: 'gave up', page: '/admin/users',
      stack: expect.any(String) }]]);
});

// The auditor's SHOULD on #154: the key the client's type asks for is never sent, and nothing needs crypto.
it('sends no idempotency key, and works without crypto.randomUUID', () => {
  const { fetch } = setup();
  vi.stubGlobal('crypto', {});
  reportClientError(new Error('boom'));
  expect(fetch.mock.calls[0]?.[1]?.headers).not.toHaveProperty('idempotency-key');
});

it('sends at most 10 reports per page load', () => {
  const { fetch } = setup();
  for (let i = 0; i < 25; i += 1) reportClientError(new Error(`loop ${i}`), 'render');
  expect(fetch).toHaveBeenCalledTimes(10);
});

it('drops a report the api refuses, without throwing', () => {
  const { fetch } = setup(429);
  expect(() => reportClientError(new Error('boom'), 'error')).not.toThrow();
  expect(fetch).toHaveBeenCalledTimes(1);
});
