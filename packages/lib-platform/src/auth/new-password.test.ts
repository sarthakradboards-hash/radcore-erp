// RAD-32 (M1-14, ADR-001 §7a, ADR-003): the new-password check. Length in NFC code points, the bundled list always,
// then Pwned Passwords' range API; when that can't answer, the bundled list decides alone, with a capped alert.
// The range API is a fake here: these tests never reach the network.
import { createHash } from 'node:crypto';
import { PASSWORD_MIN_LENGTH } from '@radcore/lib-common';
import { describe, expect, it, vi } from 'vitest';
import type { Outbound, OutboundInit } from '../http/outbound.ts';
import { createNewPasswordCheck, PWNED_ORIGIN } from './new-password.ts';

const sha1 = (s: string) => createHash('sha1').update(s).digest('hex').toUpperCase();
const LONG = 'a quiet harbour at dawn'; // 23 code points, not on any list here

// A range API that answers with these suffixes (padding has a count of 0), and records each call.
function rangeApi(lines: (password: string) => string[] = () => []) {
  const calls: { url: string; init: OutboundInit | undefined }[] = [];
  const outbound: Outbound = {
    async request(url, init) {
      calls.push({ url: String(url), init });
      return { status: 200, headers: {}, url: String(url), body: Buffer.from(lines(LONG).join('\r\n')) };
    },
  };
  return { outbound, calls };
}

describe('the new-password check', () => {
  it(`refuses fewer than ${PASSWORD_MIN_LENGTH} code points of the NFC form`, async () => {
    const api = rangeApi();
    const check = createNewPasswordCheck({ common: new Set(), outbound: api.outbound, alert: async () => undefined,
      log: { info: () => undefined, error: () => undefined }, now: () => 0 });
    expect(await check('x'.repeat(PASSWORD_MIN_LENGTH - 1))).toBe('too_short');
    // 15 code points (café, a space, three emoji, a space, passwd), though 'e' + combining accent is two before NFC
    // and each emoji is two UTF-16 units.
    expect(await check(`café ${'🙂'.repeat(3)} passwd`)).toBe(null);
    expect(await check(`café ${'🙂'.repeat(2)} passwd`)).toBe('too_short');
    // A refusal on length never reaches the network.
    expect(api.calls.filter((c) => c.url.includes('passwd'))).toEqual([]);
  });

  it('refuses a password on the bundled list, whatever its case, without calling the range API', async () => {
    const api = rangeApi();
    const check = createNewPasswordCheck({ common: new Set(['correcthorsebatterystaple']), outbound: api.outbound,
      alert: async () => undefined, log: { info: () => undefined, error: () => undefined }, now: () => 0 });
    expect(await check('CorrectHorseBatteryStaple')).toBe('breached');
    expect(api.calls).toEqual([]);
  });

  it('sends only the first five hex characters of the SHA-1, padded, and refuses a suffix the API counts', async () => {
    const hash = sha1(LONG);
    const api = rangeApi(() => [`${hash.slice(5)}:3`, `${'0'.repeat(35)}:12`]);
    const check = createNewPasswordCheck({ common: new Set(), outbound: api.outbound, alert: async () => undefined,
      log: { info: () => undefined, error: () => undefined }, now: () => 0 });
    expect(await check(LONG)).toBe('breached');
    expect(api.calls).toEqual([{ url: `${PWNED_ORIGIN}/range/${hash.slice(0, 5)}`, init: { headers: { 'Add-Padding': 'true' } } }]);
    expect(JSON.stringify(api.calls)).not.toContain(hash.slice(5));
  });

  it("accepts a password whose suffix is absent, or present only as padding (a count of 0)", async () => {
    const hash = sha1(LONG);
    for (const lines of [[`${'0'.repeat(35)}:12`], [`${hash.slice(5)}:0`]]) {
      const check = createNewPasswordCheck({ common: new Set(), outbound: rangeApi(() => lines).outbound,
        alert: async () => undefined, log: { info: () => undefined, error: () => undefined }, now: () => 0 });
      expect(await check(LONG)).toBe(null);
    }
  });

  // ADR-001 §7a: refusing every password while the API is down would block invites and resets.
  it('lets the bundled list decide alone when the API cannot answer, logging it and alerting at most once an hour', async () => {
    const clock = { now: 0 };
    const alert = vi.fn(async () => undefined);
    const log = { info: vi.fn(), error: vi.fn() };
    const down: Outbound = { request: async () => { throw new Error('timed out'); } };
    const check = createNewPasswordCheck({ common: new Set(), outbound: down, alert, log, now: () => clock.now });
    expect(await check(LONG)).toBe(null);
    clock.now = 59 * 60_000;
    expect(await check(LONG)).toBe(null);
    expect(alert).toHaveBeenCalledTimes(1);
    clock.now = 61 * 60_000;
    await check(LONG);
    expect(alert).toHaveBeenCalledTimes(2);
    expect(log.error.mock.calls.map((c: unknown[]) => c[0])).toEqual(Array(3).fill('breached_check_skipped'));
    // A non-200 answer counts as no answer.
    const odd: Outbound = { request: async (url) => ({ status: 503, headers: {}, url: String(url), body: Buffer.from('') }) };
    expect(await createNewPasswordCheck({ common: new Set(), outbound: odd, alert, log, now: () => clock.now })(LONG)).toBe(null);
  });
});
