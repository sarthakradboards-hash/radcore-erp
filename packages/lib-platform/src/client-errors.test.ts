// RAD-29 (RC-158): the browser's error report. Logged scrubbed; alerted on a key made from two fixed lists only, so the
// sender, who is anyone, can't mint new keys. The route itself (its rate limit, its manifest line) is tested in tools/.
import { describe, expect, it, vi } from 'vitest';
import { createClientErrors, pageOf } from './client-errors.ts';
import type { Ctx } from './ctx.ts';

const setup = () => {
  const log = { info: vi.fn<(m: string) => void>(), error: vi.fn<(m: string, e?: unknown) => void>() };
  const alert = vi.fn<(message: string, key?: string) => Promise<void>>(async () => undefined);
  const [route] = createClientErrors(log, alert).routes;
  const report = (input: { name: string; message: string; page: string; stack?: string }) =>
    route?.service({ requestId: 'r1' } as Ctx, { kind: 'error', ...input }, { before: undefined });
  return { log, alert, report };
};

describe('pageOf', () => {
  it.each([['/', '/'], ['/admin/users', '/admin/users'], ['/admin/users/', '/admin/users'],
    ['/admin/users?q=Asha#top', '/admin/users'], ['/password-reset/new', '/password-reset/new'],
    ['/admin/roles/sales-lead', '/admin/roles/[key]']])('%s is %s', (path, page) => {
    expect(pageOf(path)).toBe(page);
  });

  it.each(['/admin', '/admin/users/9876543210', '/admin/roles/a/b', '/nope', '', 'admin/users', '//admin/users'])('%s is no page', (path) => {
    expect(pageOf(path)).toBeNull();
  });
});

describe('the browser error report', () => {
  it('alerts on the page and class, with none of the sender\'s text', async () => {
    const { alert, report } = setup();
    await report({ name: 'TypeError', message: "Cannot read properties of undefined (reading 'Asha Rao')",
      page: '/admin/users?q=asha.rao@example.com' });
    expect(alert).toHaveBeenCalledWith('a browser error on /admin/users: TypeError (request r1)', 'web /admin/users TypeError');
  });

  // The coordinator's rule: junk paths and classes all land on one key, so one alert an hour at most.
  it('puts 50 distinct junk paths and classes on one key', async () => {
    const { alert, report } = setup();
    for (let i = 0; i < 50; i += 1) {
      await report({ name: `Evil${i}Error`, message: `boom ${i}`, page: `/x${i}/${'y'.repeat(i)}` });
    }
    expect(new Set(alert.mock.calls.map(([, key]) => key))).toEqual(new Set(['web unknown Error']));
    expect(alert.mock.calls.map(([message]) => message).every((m) => /^a browser error on an unknown page: Error \(request r1\)$/.test(m)))
      .toBe(true);
  });

  it('logs the report scrubbed: quoted input masked, shapes replaced, the stack cut to 20 lines', async () => {
    const { log, report } = setup();
    const stack = Array.from({ length: 30 }, (_, i) => `    at f${i} (https://radcore.example.in/_next/app.js:${i}:1)`);
    await report({ name: 'SyntaxError', message: 'Unexpected token, "Asha Rao 9876543210" is not valid', page: '/sign-in?email=asha@example.com',
      stack: ['call 9876543210', ...stack].join('\n') });
    const [line, fields] = log.error.mock.calls[0] ?? [];
    expect(line).toBe('browser error (error) on /sign-in (request r1)');
    const text = JSON.stringify(fields);
    expect(text).not.toMatch(/Asha|9876543210|asha@example/);
    expect(fields).toMatchObject({ errorClass: 'SyntaxError', message: 'Unexpected token, "…" is not valid' });
    expect(((fields as { stack: string }).stack).split('\n')).toHaveLength(20);
  });

  // The auditor's MUST on #154: Chrome's stack starts with the message, which quotes input; only frames are kept.
  it("keeps only a stack's frames, Chrome's and Firefox's, dropping the message line that starts it", async () => {
    const { log, report } = setup();
    const message = "Cannot read properties of undefined (reading 'Asha Rao')";
    await report({ name: 'TypeError', message, page: '/admin/users', stack: [`TypeError: ${message}`,
      '    at render (https://radcore.example.in/_next/static/chunks/app.js:10:5)',
      'render@https://radcore.example.in/_next/static/chunks/app.js:10:5',
      "  reading 'Asha Rao' again", ''].join('\n') });
    const [, fields] = log.error.mock.calls[0] ?? [];
    expect((fields as { stack: string }).stack).toBe(['    at render (https://radcore.example.in/_next/static/chunks/app.js:10:5)',
      'render@https://radcore.example.in/_next/static/chunks/app.js:10:5'].join('\n'));
    expect(JSON.stringify(fields)).not.toContain('Asha');
  });
});
