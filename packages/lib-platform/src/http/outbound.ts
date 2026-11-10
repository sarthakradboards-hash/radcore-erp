// The one way server code calls an outside service (ADR-002 L8, RAD-66; ADR-003 §3): every URL is checked against
// the client's exact origins before it is sent, including redirects and URLs taken from responses; the host must
// resolve only to global unicast addresses, and the connection goes to the address that was checked; the credential
// travels only in Authorization, never in a URL (RC-213); logs carry the origin and route, never a query, header or
// body. This file is L8's zone, the only server file allowed node:https.
import { lookup as dnsLookup } from 'node:dns/promises';
import { Agent, request as httpsRequest } from 'node:https';
import { BlockList, isIP, isIPv4, isIPv6, type LookupFunction } from 'node:net';
import type { Logger } from '../log.ts';
import { routeOf } from '../log/scrub.ts';

export type OutboundOptions = {
  /** Names the integration in logs and errors, such as "meta" or "alert". */
  name: string;
  /** The exact origins this client may reach, such as `https://graph.facebook.com`. */
  allowedOrigins: readonly string[];
  /** Sent as `Authorization: <scheme> <token>`. A URL holding the token is refused. */
  credential?: { scheme: string; token: string } | null;
  /** Query parameters a provider's own links carry a credential in (Meta's `access_token`): removed before sending. */
  credentialParams?: readonly string[];
  /** false when the URL itself is a secret (an alert webhook, a heartbeat address): logs show the origin alone. */
  logPath?: boolean;
  /** For the whole call: resolving, every redirect, and reading the body. */
  timeoutMs?: number;
  maxBytes?: number;
};
export type OutboundInit = { method?: string; headers?: Record<string, string>; body?: string | Buffer };
export type OutboundResponse = { status: number; headers: Headers; body: Buffer; url: string };
export type Outbound = { request(url: string | URL, init?: OutboundInit): Promise<OutboundResponse> };
type Headers = Record<string, string | string[] | undefined>;
type Address = { address: string; family: number };
/** DNS and the socket, apart so tests can count calls: `send` connects to `to`, the address the client checked. */
export type Transport = {
  resolve(hostname: string): Promise<Address[]>;
  send(url: URL, to: Address, init: { method: string; headers: Record<string, string>; body: string | Buffer | undefined;
    signal: AbortSignal; maxBytes: number }): Promise<{ status: number; headers: Headers; body: Buffer }>;
};

/** A call the client won't make. Its message never holds the URL. */
export class OutboundRefused extends Error {
  constructor(name: string, reason: string) {
    super(`${name}: refused, ${reason}`);
    this.name = 'OutboundRefused';
  }
}

const OUTBOUND_TIMEOUT_MS = 10_000;
const OUTBOUND_MAX_BYTES = 10 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
// The client sets these itself; a caller's Host could aim the request at another site on the same address.
const OWN_HEADERS = new Set(['authorization', 'proxy-authorization', 'host']);
const MIN_TOKEN_LENGTH = 8;

// Every IPv4 range that isn't global unicast (ADR-002's list plus the documentation, benchmark and reserved ranges).
const BLOCKED_V4 = new BlockList();
for (const [a, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]] as const) BLOCKED_V4.addSubnet(a, bits, 'ipv4');
// IPv6 is allowed only inside 2000::/3, so ::, ::1, fc00::/7, fe80::/10 and multicast are out by default; these are
// the non-global parts of 2000::/3 (Teredo, benchmarking, ORCHID, documentation).
const GLOBAL_V6 = new BlockList();
GLOBAL_V6.addSubnet('2000::', 3, 'ipv6');
const BLOCKED_V6 = new BlockList();
for (const [a, bits] of [['2001::', 32], ['2001:2::', 48], ['2001:10::', 28], ['2001:20::', 28], ['2001:db8::', 32],
  ['3fff::', 20]] as const) BLOCKED_V6.addSubnet(a, bits, 'ipv6');

// An IPv6 address as its eight 16-bit groups (it has passed isIPv6).
function groups(ip: string): number[] {
  let s = ip.split('%')[0] ?? '';
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(s);
  if (dotted) {
    const [a, b, c, d] = dotted.slice(1).map(Number) as [number, number, number, number];
    s = `${s.slice(0, dotted.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head = '', tail] = s.split('::');
  const h = head === '' ? [] : head.split(':');
  const t = tail === undefined || tail === '' ? [] : tail.split(':');
  const fill = tail === undefined ? [] : Array<string>(8 - h.length - t.length).fill('0');
  return [...h, ...fill, ...t].map((g) => parseInt(g, 16));
}
const v4Of = (hi: number, lo: number): string => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
// The IPv4 address inside an IPv4-mapped (::ffff:0:0/96), NAT64 (64:ff9b::/96) or 6to4 (2002::/16) address.
function embeddedV4(ip: string): string | null {
  const g = groups(ip);
  const zeros = (from: number, to: number) => g.slice(from, to).every((x) => x === 0);
  if (zeros(0, 5) && g[5] === 0xffff) return v4Of(g[6] ?? 0, g[7] ?? 0);
  if (g[0] === 0x64 && g[1] === 0xff9b && zeros(2, 6)) return v4Of(g[6] ?? 0, g[7] ?? 0);
  if (g[0] === 0x2002) return v4Of(g[1] ?? 0, g[2] ?? 0);
  return null;
}

/** Whether an address is global unicast, the only kind the client connects to (ADR-002 L8). */
export function isGlobalUnicast(address: string): boolean {
  const v4 = isIPv4(address) ? address : isIPv6(address) ? embeddedV4(address) : null;
  if (v4 !== null) return !BLOCKED_V4.check(v4, 'ipv4');
  return isIPv6(address) && GLOBAL_V6.check(address, 'ipv6') && !BLOCKED_V6.check(address, 'ipv6');
}

// Settle with `work`, or fail when the call's deadline passes first.
const within = <T>(work: Promise<T>, signal: AbortSignal): Promise<T> => new Promise<T>((resolve, reject) => {
  if (signal.aborted) {
    reject(signal.reason);
    return;
  }
  signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  work.then(resolve, reject);
});

// No keep-alive pool to reuse across checks, and a fresh agent ignores proxy settings in the environment.
const agent = new Agent({ keepAlive: false });

/** DNS through the system resolver; the socket through node:https, pinned to the checked address. */
const nodeTransport: Transport = {
  resolve: (hostname) => dnsLookup(hostname, { all: true, verbatim: true }),
  send: (url, to, { method, headers, body, signal, maxBytes }) => new Promise((resolve, reject) => {
    // Whatever the hostname resolves to now, the socket goes to the address that was checked.
    const pinned: LookupFunction = (_host, options, done) => {
      if (options.all) done(null, [to]);
      else done(null, to.address, to.family);
    };
    const req = httpsRequest(url, { method, headers, agent, signal, lookup: pinned }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) req.destroy(new Error(`the response is larger than ${maxBytes} bytes`));
        else chunks.push(chunk);
      });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end(body);
  }),
};

const decoded = (s: string): string => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};
// The token anywhere in the URL, raw, percent-encoded or decoded (query values are decoded, `+` as a space).
const holdsToken = (url: URL, token: string): boolean =>
  [url.href, decoded(url.href), ...url.searchParams.values()].some((s) => s.includes(token))
  || url.href.includes(encodeURIComponent(token));

const header = (headers: Headers, name: string): string | undefined => {
  const v = headers[name];
  return Array.isArray(v) ? v[0] : v;
};

/** A client for one integration (ADR-002 L8). `transport` is for tests. */
export function createOutbound(options: OutboundOptions, { log, transport = nodeTransport }:
  { log: Logger; transport?: Transport }): Outbound {
  const { name, credential = null, credentialParams = [], logPath = true } = options;
  const timeoutMs = options.timeoutMs ?? OUTBOUND_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? OUTBOUND_MAX_BYTES;
  const allowed = new Set<string>();
  for (const origin of options.allowedOrigins) {
    const u = URL.canParse(origin) ? new URL(origin) : null;
    if (u === null || u.protocol !== 'https:' || u.port !== '' || u.origin !== origin) {
      throw new Error(`${name}: ${JSON.stringify(origin)} is not an https origin (scheme and host only, default port)`);
    }
    allowed.add(origin);
  }
  if (allowed.size === 0) throw new Error(`${name}: allowedOrigins is empty`);
  if (credential !== null && credential.token.length < MIN_TOKEN_LENGTH) {
    throw new Error(`${name}: the credential token is too short to check URLs for (${MIN_TOKEN_LENGTH} or more)`);
  }

  const refuse = (reason: string): never => {
    log.error(`outbound ${name}: refused, ${reason}`);
    throw new OutboundRefused(name, reason);
  };
  const where = (url: URL): string => (logPath ? `${url.origin}${routeOf(url.pathname)}` : url.origin);

  // ADR-002 L8's check, for the first URL and every one after it.
  const checked = (input: string | URL, base?: URL): URL => {
    const url = URL.canParse(String(input), base) ? new URL(String(input), base) : refuse('not a valid URL');
    if (url.protocol !== 'https:') refuse('only https is allowed');
    if (url.port !== '') refuse('only the default port is allowed');
    if (url.username !== '' || url.password !== '') refuse('a URL may not hold a user or password');
    if (!allowed.has(url.origin)) refuse('that origin is not on the list');
    for (const p of credentialParams) if (url.searchParams.has(p)) url.searchParams.delete(p);
    if (credential !== null && holdsToken(url, credential.token)) refuse('the credential must not travel in the URL');
    return url;
  };

  const addressOf = async (url: URL, signal: AbortSignal): Promise<Address> => {
    const host = url.hostname.replace(/^\[(.*)\]$/, '$1');
    const family = isIP(host);
    const found = family !== 0 ? [{ address: host, family }] : await within(transport.resolve(host), signal);
    const first = found[0];
    if (first === undefined || !found.every((a) => isGlobalUnicast(a.address))) {
      return refuse('the host resolves to an address that is not public');
    }
    return first;
  };

  return {
    async request(input, init = {}) {
      if (Object.keys(init.headers ?? {}).some((h) => OWN_HEADERS.has(h.toLowerCase()))) {
        refuse('the client sets Authorization and Host itself');
      }
      const signal = AbortSignal.timeout(timeoutMs);
      let url = checked(input);
      let method = (init.method ?? 'GET').toUpperCase();
      let body = init.body;
      let withCredential = credential !== null;
      for (let hop = 0; ; hop += 1) {
        const to = await addressOf(url, signal);
        const headers = { ...init.headers,
          ...(withCredential && credential ? { authorization: `${credential.scheme} ${credential.token}` } : {}) };
        let res: Awaited<ReturnType<Transport['send']>>;
        try {
          res = await within(transport.send(url, to, { method, headers, body, signal, maxBytes }), signal);
        } catch (err) {
          const reason = signal.aborted ? `no answer within ${timeoutMs} ms` : 'the request failed';
          log.error(`outbound ${name}: ${method} ${where(url)} ${reason}`, signal.aborted ? undefined : err);
          throw signal.aborted ? new Error(`${name}: ${reason}`) : err;
        }
        log.info(`outbound ${name}: ${method} ${where(url)} ${res.status}`);
        if (res.body.length > maxBytes) throw new Error(`${name}: the response is larger than ${maxBytes} bytes`);
        const location = REDIRECTS.has(res.status) ? header(res.headers, 'location') : undefined;
        if (location === undefined) return { ...res, url: url.href };
        if (hop === MAX_REDIRECTS) refuse(`more than ${MAX_REDIRECTS} redirects`);
        const next = checked(location, url);
        // Another allowed origin is a different service: the credential stays behind, for every later hop too.
        if (next.origin !== url.origin) withCredential = false;
        if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === 'POST')) {
          method = 'GET';
          body = undefined;
        }
        url = next;
      }
    },
  };
}
