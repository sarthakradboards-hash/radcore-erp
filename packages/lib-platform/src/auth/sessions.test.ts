// RAD-34: the sessions list's device name, and the session cookie's form and reading it from a Cookie header.
import { describe, expect, it } from 'vitest';
import { deviceOf, sessionCookieFor } from './sessions.ts';

describe('deviceOf', () => {
  it('names the browser and system from a User-Agent, never more', () => {
    expect([
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0; rv:131.0) Gecko/20100101 Firefox/131.0',
      'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 OPR/115.0',
      'curl/8.9.1',
      undefined,
    ].map(deviceOf)).toEqual(['Chrome on Android', 'Edge on Windows', 'Safari on iOS', 'Firefox on macOS', 'Chrome on ChromeOS',
      'Opera on Linux', 'Unknown device', 'Unknown device']);
  });
});

describe('sessionCookieFor', () => {
  const token = 'Ab_-'.repeat(10) + 'xyz';
  it('is __Host- and Secure on https, and plain over http, which only development and CI use', () => {
    expect([sessionCookieFor('https://erp.example.in').name, sessionCookieFor('https://erp.example.in').secure])
      .toEqual(['__Host-radcore_session', true]);
    expect([sessionCookieFor('http://127.0.0.1:3000').name, sessionCookieFor('http://127.0.0.1:3000').secure])
      .toEqual(['radcore_session', false]);
  });
  it('reads its own cookie wherever it sits in the header, and nothing else', () => {
    const { tokenIn } = sessionCookieFor('https://erp.example.in');
    expect(tokenIn(`__Host-radcore_session=${token}`)).toBe(token);
    expect(tokenIn(`theme=dark; __Host-radcore_session=${token}; lang=en`)).toBe(token);
    expect(tokenIn(`radcore_session=${token}`)).toBeNull();
    expect(tokenIn(`x__Host-radcore_session=${token}`)).toBeNull();
    expect(tokenIn(`__Host-radcore_session=${token}x`)).toBeNull();
    expect(tokenIn('__Host-radcore_session=short')).toBeNull();
    expect(tokenIn(undefined)).toBeNull();
    expect(sessionCookieFor('http://127.0.0.1:3000').tokenIn(`__Host-radcore_session=${token}`)).toBeNull();
  });
});
