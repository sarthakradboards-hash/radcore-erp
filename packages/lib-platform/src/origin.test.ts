// RC-165: the cross-site check let a request with no Origin header through. Here a write needs Origin to be exactly
// the app's public origin; a read needs none.
import { describe, expect, it } from 'vitest';
import { originAllowed } from './index.ts';

const APP = 'https://erp.example.in';

describe('originAllowed', () => {
  it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'post'])('lets a %s from the app itself through', (method) => {
    expect(originAllowed(method, APP, APP)).toBe(true);
  });

  it.each<[string, string | undefined]>([
    ['no Origin at all (RC-165)', undefined],
    ['another site', 'https://evil.example'],
    ["the browser's opaque origin", 'null'],
    ['plain http', 'http://erp.example.in'],
    ['another port', 'https://erp.example.in:8443'],
    ['a subdomain', 'https://x.erp.example.in'],
    ['a trailing slash', 'https://erp.example.in/'],
    ['an empty header', ''],
  ])('refuses a write with %s', (_, origin) => {
    expect(originAllowed('POST', origin, APP)).toBe(false);
  });

  it.each(['GET', 'HEAD', 'OPTIONS'])('lets a %s through with no Origin, as a read', (method) => {
    expect(originAllowed(method, undefined, APP)).toBe(true);
  });
});
