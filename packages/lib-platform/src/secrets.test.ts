// RC-213: secrets encrypted with a per-value data key, bound to their place, rotatable, with a long enough key.
import { randomUUID } from 'node:crypto';
import { testKmsKeyArn } from '@radcore/test-helpers';
import { describe, expect, it } from 'vitest';
import { createSecrets, expiringBefore, SecretPlaceMismatch } from './index.ts';

const localKey = (fill: number, bytes = 32) => Buffer.alloc(bytes, fill).toString('base64url');
const local = (fill = 7) => createSecrets({ kmsKeyId: null, localKey: localKey(fill) });
const place = { table: 'integration_tokens', column: 'token', rowId: randomUUID() };
// Built at run time and shaped like no real token, so the secret scanner has nothing to match.
const TOKEN = 'meta '.repeat(6);

describe('createSecrets', () => {
  it('decrypts what it encrypted, and the ciphertext hides the value', async () => {
    const s = local();
    const c = await s.encrypt(TOKEN, place);
    expect(Buffer.from(c, 'base64').toString('latin1')).not.toContain(TOKEN);
    expect(await s.decrypt(c, place)).toBe(TOKEN);
  });

  it('uses a new data key every time, so the same value never encrypts the same', async () => {
    const s = local();
    expect(await s.encrypt(TOKEN, place)).not.toBe(await s.encrypt(TOKEN, place));
  });

  it.each([
    ['another row', { ...place, rowId: '00000000-0000-4000-8000-000000000000' }],
    ['another column', { ...place, column: 'refresh_token' }],
    ['another table', { ...place, table: 'bank_statement_passwords' }],
  ])('refuses a ciphertext copied to %s', async (_what, elsewhere) => {
    const s = local();
    await expect(s.decrypt(await s.encrypt(TOKEN, place), elsewhere)).rejects.toThrow(SecretPlaceMismatch);
  });

  it('refuses a tampered ciphertext, and one made under another key', async () => {
    const c = await local().encrypt(TOKEN, place);
    const bytes = Buffer.from(c, 'base64');
    bytes[bytes.length - 40] = (bytes[bytes.length - 40] ?? 0) ^ 1;
    await expect(local().decrypt(bytes.toString('base64'), place)).rejects.toThrow();
    await expect(local(9).decrypt(c, place)).rejects.toThrow();
  });

  it('re-encrypts under the current key with a new data key (rotation)', async () => {
    const s = local();
    const c = await s.encrypt(TOKEN, place);
    const again = await s.reencrypt(c, place);
    expect(again).not.toBe(c);
    expect(await s.decrypt(again, place)).toBe(TOKEN);
  });

  it('refuses a local key shorter than 32 bytes, and both or neither key', () => {
    expect(() => createSecrets({ kmsKeyId: null, localKey: localKey(7, 31) })).toThrow(/at least 32 random bytes/);
    expect(() => createSecrets({ kmsKeyId: null, localKey: null })).toThrow(/exactly one/);
    expect(() => createSecrets({ kmsKeyId: 'mrk-test', localKey: localKey(7) }))
      .toThrow(/exactly one/);
  });

  it('builds the KMS keyring from a multi-Region key ARN without calling KMS, and names the key it wraps with', () => {
    expect(createSecrets({ kmsKeyId: testKmsKeyArn(), localKey: null }).keyId).toBe(testKmsKeyArn());
    expect(local().keyId).toBe('local:secrets-local-v1');
  });

  // The MRK-aware strict keyring encrypts with these but decrypts only with the full ARN (auditor-2, RAD-42).
  it.each([
    ['a bare key id', `mrk-${'a'.repeat(32)}`],
    ['an alias', 'alias/rc'],
    ['a single-Region key ARN', testKmsKeyArn().replace('/mrk-', '/')],
  ])('refuses %s as the KMS key, since nothing it encrypted would decrypt', (_what, kmsKeyId) => {
    expect(() => createSecrets({ kmsKeyId, localKey: null })).toThrow(/multi-Region KMS key ARN/);
  });
});

describe('expiringBefore', () => {
  it('lists the tokens expiring before the horizon, soonest first, and skips those that never expire', () => {
    const tokens = [
      { id: 'shopify', expiresAt: null },
      { id: 'meta', expiresAt: '2026-11-20T00:00:00Z' },
      { id: 'whatsapp', expiresAt: '2026-11-10T00:00:00Z' },
      { id: 'gsp', expiresAt: '2027-01-01T00:00:00Z' },
    ];
    expect(expiringBefore(tokens, '2026-11-21T00:00:00Z').map((t) => t.id)).toEqual(['whatsapp', 'meta']);
  });

  it('fails closed: an unreadable expiry is reported first, and an unreadable horizon is refused', () => {
    const tokens = [{ id: 'meta', expiresAt: '2026-11-20T00:00:00Z' }, { id: 'broken', expiresAt: 'soon' }];
    expect(expiringBefore(tokens, '2026-11-21T00:00:00Z').map((t) => t.id)).toEqual(['broken', 'meta']);
    expect(() => expiringBefore(tokens, 'next week')).toThrow(/valid horizon/);
  });
});
