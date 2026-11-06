import type { AddressInfo } from 'node:net';
import { expect, it } from 'vitest';
import { createApp } from './app.ts';

it('answers the health check', async () => {
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  } finally {
    server.close();
  }
});
