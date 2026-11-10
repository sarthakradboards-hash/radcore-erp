// ADR-002 L8's proof for the outbound client (RAD-66), on a mocked transport: every refusal sends nothing, redirects
// are capped and re-checked, and the credential travels only in Authorization (RC-213, RAD-42's "tokens never travel
// in URLs").
import { describe, expect, it, vi } from 'vitest';
import { createOutbound, isGlobalUnicast, OutboundRefused, type OutboundOptions, type Transport } from '../index.ts';

// Built at run time, so the secret scanner has nothing to match.
const TOKEN = 'meta-token-'.repeat(2);
const META = 'https://graph.facebook.com';
type Reply = { status: number; location?: string; body?: string };
type Sent = { url: string; to: string; method: string; headers: Record<string, string>; body: unknown };

const logger = () => ({ info: vi.fn<(m: string) => void>(), error: vi.fn<(m: string, e?: unknown) => void>() });
// A transport that answers with `replies` in turn (the last one repeats) and resolves names through `dns`.
const fake = (replies: Reply[] = [{ status: 200 }], dns: Record<string, string[]> = {}) => {
  const sent: Sent[] = [];
  const transport: Transport = {
    resolve: vi.fn<Transport['resolve']>(async (host) =>
      (dns[host] ?? ['157.240.1.1']).map((address) => ({ address, family: address.includes(':') ? 6 : 4 }))),
    send: vi.fn<Transport['send']>(async (url, to, init) => {
      sent.push({ url: url.href, to: to.address, method: init.method, headers: init.headers, body: init.body });
      const r = replies[Math.min(sent.length, replies.length) - 1] ?? { status: 200 };
      return { status: r.status, headers: r.location === undefined ? {} : { location: r.location },
        body: Buffer.from(r.body ?? '') };
    }),
  };
  return { transport, sent };
};
const meta = (t: ReturnType<typeof fake>, more: Partial<OutboundOptions> = {}, log = logger()) =>
  createOutbound({ name: 'meta', allowedOrigins: [META, 'https://www.facebook.com'],
    credential: { scheme: 'Bearer', token: TOKEN }, credentialParams: ['access_token'], ...more },
  { log, transport: t.transport });

describe('the outbound client sends', () => {
  it('a Graph paging link once, without access_token, with the token in the header', async () => {
    const t = fake();
    const res = await meta(t).request(`${META}/v21.0/123/leads?after=X&access_token=T`);
    expect(t.sent).toEqual([{ url: `${META}/v21.0/123/leads?after=X`, to: '157.240.1.1', method: 'GET',
      headers: { authorization: `Bearer ${TOKEN}` }, body: undefined }]);
    expect(res.status).toBe(200);
  });

  it('to the address it checked', async () => {
    const t = fake([{ status: 200 }], { 'graph.facebook.com': ['2a03:2880:f12f:83:face:b00c:0:25de'] });
    await meta(t).request(`${META}/me`);
    expect(t.sent.map((s) => s.to)).toEqual(['2a03:2880:f12f:83:face:b00c:0:25de']);
  });

  it('through up to 3 redirects, each one checked', async () => {
    const t = fake([{ status: 302, location: '/a' }, { status: 301, location: '/b' }, { status: 307, location: '/c' },
      { status: 200 }]);
    const res = await meta(t).request(`${META}/start`);
    expect(t.sent.map((s) => s.url)).toEqual([`${META}/start`, `${META}/a`, `${META}/b`, `${META}/c`]);
    expect(res.url).toBe(`${META}/c`);
  });

  it('without Authorization after a redirect to another allowed origin, for every later hop', async () => {
    const t = fake([{ status: 302, location: 'https://www.facebook.com/x' }, { status: 302, location: `${META}/y` },
      { status: 200 }]);
    await meta(t).request(`${META}/start`);
    expect(t.sent.map((s) => s.headers['authorization'] ?? null)).toEqual([`Bearer ${TOKEN}`, null, null]);
  });

  it('a POST as a GET without its body after a 303, and as a POST with it after a 307', async () => {
    const t = fake([{ status: 303, location: '/done' }, { status: 200 }]);
    await meta(t).request(`${META}/form`, { method: 'POST', body: 'a=1' });
    const u = fake([{ status: 307, location: '/again' }, { status: 200 }]);
    await meta(u).request(`${META}/form`, { method: 'POST', body: 'a=1' });
    expect(t.sent.map((s) => [s.method, s.body])).toEqual([['POST', 'a=1'], ['GET', undefined]]);
    expect(u.sent.map((s) => [s.method, s.body])).toEqual([['POST', 'a=1'], ['POST', 'a=1']]);
  });
});

describe('the outbound client refuses, sending nothing', () => {
  it.each([
    ['a lookalike origin', 'https://graph.facebook.com.evil.example/'],
    ['http', 'http://graph.facebook.com/'],
    ['a user and password', 'https://user:pass@graph.facebook.com/'],
    ['another port', 'https://graph.facebook.com:8443/'],
    ['a trailing-dot host', 'https://graph.facebook.com./'],
    ['a token in the query', `${META}/me?token=${TOKEN}`],
    ['a percent-encoded token', `${META}/me?t=${encodeURIComponent(TOKEN).replace(/-/g, '%2D')}`],
    ['a token in the path', `${META}/${TOKEN}/me`],
    ['something that is no URL', 'graph.facebook.com/me'],
  ])('%s', async (_what, url) => {
    const t = fake();
    await expect(meta(t).request(url)).rejects.toThrow(OutboundRefused);
    expect(t.transport.send).not.toHaveBeenCalled();
  });

  it.each(['127.0.0.1', '0.0.0.0', '::ffff:127.0.0.1', '10.0.0.5', '169.254.169.254'])(
    'a host that resolves to %s', async (address) => {
      const t = fake([{ status: 200 }], { 'graph.facebook.com': ['157.240.1.1', address] });
      await expect(meta(t).request(`${META}/me`)).rejects.toThrow(/not public/);
      expect(t.transport.send).not.toHaveBeenCalled();
    });

  it('an address written as the host, without asking DNS', async () => {
    const t = fake();
    const local = createOutbound({ name: 'local', allowedOrigins: ['https://[::1]'] }, { log: logger(), transport: t.transport });
    await expect(local.request('https://[::1]/')).rejects.toThrow(/not public/);
    expect(t.transport.resolve).not.toHaveBeenCalled();
    expect(t.transport.send).not.toHaveBeenCalled();
  });

  it('a name the system resolver maps to loopback, through the real transport', async () => {
    const local = createOutbound({ name: 'local', allowedOrigins: ['https://localhost'] }, { log: logger() });
    await expect(local.request('https://localhost/')).rejects.toThrow(/not public/);
  });

  it('a caller-set Authorization or Host header', async () => {
    const t = fake();
    await expect(meta(t).request(`${META}/me`, { headers: { Authorization: 'Bearer other-token' } })).rejects.toThrow(OutboundRefused);
    await expect(meta(t).request(`${META}/me`, { headers: { host: 'evil.example' } })).rejects.toThrow(OutboundRefused);
    expect(t.transport.send).not.toHaveBeenCalled();
  });
});

describe('the outbound client stops', () => {
  it('a redirect to another site after the first hop', async () => {
    const t = fake([{ status: 302, location: 'https://evil.example/' }]);
    await expect(meta(t).request(`${META}/me`)).rejects.toThrow(OutboundRefused);
    expect(t.transport.send).toHaveBeenCalledTimes(1);
  });

  it('a redirect whose Location carries the token', async () => {
    const t = fake([{ status: 302, location: `/next?key=${TOKEN}` }]);
    await expect(meta(t).request(`${META}/me`)).rejects.toThrow(/credential must not travel in the URL/);
    expect(t.transport.send).toHaveBeenCalledTimes(1);
  });

  it('a chain of 4 redirects at the 4th', async () => {
    const t = fake([{ status: 302, location: '/1' }, { status: 302, location: '/2' }, { status: 302, location: '/3' },
      { status: 302, location: '/4' }]);
    await expect(meta(t).request(`${META}/0`)).rejects.toThrow(/more than 3 redirects/);
    expect(t.transport.send).toHaveBeenCalledTimes(4);
  });

  it('at the timeout, when the service doesn\'t answer', async () => {
    const t = fake();
    t.transport.send = () => new Promise(() => undefined);
    await expect(meta(t, { timeoutMs: 20 }).request(`${META}/me`)).rejects.toThrow('meta: no answer within 20 ms');
  });

  it('a response larger than the size limit', async () => {
    const t = fake([{ status: 200, body: 'x'.repeat(11) }]);
    await expect(meta(t, { maxBytes: 10 }).request(`${META}/me`)).rejects.toThrow(/larger than 10 bytes/);
  });
});

describe('the outbound client logs', () => {
  it('the origin and route, never the query, a header or the body', async () => {
    const log = logger();
    const t = fake([{ status: 200, body: 'lead: someone@example.in' }]);
    await meta(t, {}, log).request(`${META}/v21.0/12345/leads?after=cursor-1&access_token=T`, { body: 'secret body' });
    expect(log.info.mock.calls).toEqual([[`outbound meta: GET ${META}/v21.0/:n/leads 200`]]);
  });

  it('the origin alone for a client whose URL is a secret', async () => {
    const log = logger();
    const t = fake();
    const alert = createOutbound({ name: 'alert', allowedOrigins: ['https://hooks.example.in'], logPath: false },
      { log, transport: t.transport });
    await alert.request('https://hooks.example.in/services/T0/B0/hook-path');
    expect(log.info.mock.calls).toEqual([['outbound alert: GET https://hooks.example.in 200']]);
  });

  it('a refusal without the URL', async () => {
    const log = logger();
    const url = `${META}/me?token=${TOKEN}`;
    const err = await meta(fake(), {}, log).request(url).catch((e: unknown) => e);
    expect(String(err)).toBe('OutboundRefused: meta: refused, the credential must not travel in the URL');
    expect(log.error.mock.calls.flat().join(' ')).not.toContain(TOKEN);
  });
});

describe('createOutbound', () => {
  it.each([
    [{ allowedOrigins: ['https://graph.facebook.com/v21.0'] }, /not an https origin/],
    [{ allowedOrigins: ['http://graph.facebook.com'] }, /not an https origin/],
    [{ allowedOrigins: ['https://graph.facebook.com:8443'] }, /not an https origin/],
    [{ allowedOrigins: [] }, /allowedOrigins is empty/],
    [{ allowedOrigins: [META], credential: { scheme: 'Bearer', token: 'short' } }, /too short/],
  ])('refuses %j', (o, why) => {
    expect(() => createOutbound({ name: 'x', ...o }, { log: logger(), transport: fake().transport })).toThrow(why);
  });
});

describe('isGlobalUnicast', () => {
  it.each(['157.240.1.1', '8.8.8.8', '2a03:2880:f12f:83:face:b00c:0:25de', '::ffff:8.8.8.8', '64:ff9b::808:808'])(
    'allows %s', (address) => {
      expect(isGlobalUnicast(address)).toBe(true);
    });

  it.each(['0.0.0.0', '10.1.2.3', '100.100.100.200', '127.0.0.1', '169.254.169.254', '172.16.0.1', '172.31.255.255',
    '192.168.1.1', '192.0.2.1', '198.18.0.1', '224.0.0.1', '255.255.255.255', '::', '::1', 'fc00::1', 'fd12:3456::1',
    'fe80::1', 'fe80::1%eth0', 'ff02::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '64:ff9b::7f00:1', '2002:7f00:1::',
    '2002:a00:1::1', '2001:db8::1', '2001:0:4136:e378::1', '::127.0.0.1', '100::1', 'not-an-address'])(
    'refuses %s', (address) => {
      expect(isGlobalUnicast(address)).toBe(false);
    });
});
