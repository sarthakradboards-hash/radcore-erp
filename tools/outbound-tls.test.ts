// RAD-44 step 4 (auditor-2's should on RAD-66): the outbound client's real node:https transport against a real TLS
// server, before its first caller. The server is local, so the client's own address check (which refuses loopback)
// is bypassed by calling the transport directly with the checked address. That's what shows the pinning: the name
// `radcore.test` resolves nowhere, yet the socket reaches 127.0.0.1 with SNI and Host still the name. Here in tools/
// because it starts an https server (ADR-002 L8). Needs openssl for the throwaway certificate.
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { nodeTransport } from '../packages/lib-platform/src/http/outbound.ts';

const HAS_OPENSSL = spawnSync('openssl', ['version']).status === 0;
const NAME = 'radcore.test';
const LOOPBACK = { address: '127.0.0.1', family: 4 };
const OUTBOUND = pathToFileURL(resolve('packages/lib-platform/src/http/outbound.ts')).href;

describe.skipIf(!HAS_OPENSSL)('the outbound client\'s https transport, on a real TLS server', () => {
  const dir = mkdtempSync(join(tmpdir(), 'radcore-tls-'));
  const seen: { sni: string | false; host: string | undefined }[] = [];
  const state: { server?: Server; port: number } = { port: 0 };

  beforeAll(async () => {
    const made = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
      '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem'), '-subj', `/CN=${NAME}`,
      '-addext', `subjectAltName=DNS:${NAME}`], { stdio: 'ignore' });
    expect(made.status).toBe(0);
    const server = createServer({ key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')) },
      (req, res) => {
        seen.push({ sni: (req.socket as { servername?: string | false }).servername ?? false, host: req.headers.host });
        res.end(req.url === '/big' ? 'x'.repeat(2048) : 'ok');
      });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    state.server = server;
    state.port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    state.server?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const send = (path: string) => nodeTransport.send(new URL(`https://${NAME}:${state.port}${path}`), LOOPBACK,
    { method: 'GET', headers: {}, body: undefined, signal: AbortSignal.timeout(10_000), maxBytes: 1024 });

  it('verifies the certificate: a self-signed one is refused', async () => {
    await expect(send('/ok')).rejects.toMatchObject({ code: 'DEPTH_ZERO_SELF_SIGNED_CERT' });
  });

  // NODE_EXTRA_CA_CERTS is read once, at start, so the trusted run is a child process.
  it('with the certificate trusted, sends to the checked address with SNI and Host as the name, and caps the size',
    async () => {
      const script = `
        const { nodeTransport } = await import(${JSON.stringify(OUTBOUND)});
        const opts = { method: 'GET', headers: {}, body: undefined, signal: AbortSignal.timeout(10000), maxBytes: 1024 };
        const to = ${JSON.stringify(LOOPBACK)};
        const ok = await nodeTransport.send(new URL('https://${NAME}:${state.port}/ok'), to, opts);
        const big = await nodeTransport.send(new URL('https://${NAME}:${state.port}/big'), to, opts)
          .then(() => 'sent', (e) => e.message);
        console.log(JSON.stringify({ status: ok.status, body: ok.body.toString(), big }));`;
      // Not spawnSync: this process serves the requests, so it must keep running while the child sends them.
      const child = spawn(process.execPath, ['--input-type=module', '-e', script],
        { env: { ...process.env, NODE_EXTRA_CA_CERTS: join(dir, 'cert.pem') } });
      const out: string[] = [];
      const err: string[] = [];
      child.stdout.on('data', (b: Buffer) => out.push(b.toString()));
      child.stderr.on('data', (b: Buffer) => err.push(b.toString()));
      const [code] = await once(child, 'exit');
      expect({ code, stderr: err.join('') }).toEqual({ code: 0, stderr: '' });
      expect(JSON.parse(out.join('').trim().split('\n').at(-1) ?? '{}')).toEqual(
        { status: 200, body: 'ok', big: 'the response is larger than 1024 bytes' });
      expect(seen.at(0)).toEqual({ sni: NAME, host: `${NAME}:${state.port}` });
    }, 60_000);
});
