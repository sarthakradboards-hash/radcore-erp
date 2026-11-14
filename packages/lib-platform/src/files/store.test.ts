// RAD-43 (RC-096, RC-191): what the file store decides without reaching S3. tools/s3.test.ts runs it on SeaweedFS.
import { testSettings } from '@radcore/test-helpers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachment, createFileStore, loadConfig, UploadRefused } from '../index.ts';
import { heldCredentials, type CredentialSource } from './store.ts';

const s3 = () => loadConfig(testSettings(), 'api').s3;

describe('attachment', () => {
  it.each([
    ['statement.pdf', 'attachment; filename="statement.pdf"; filename*=UTF-8\'\'statement.pdf'],
    ['बिल 1.pdf', 'attachment; filename="___ 1.pdf"; filename*=UTF-8\'\'%E0%A4%AC%E0%A4%BF%E0%A4%B2%201.pdf'],
    ['../../etc/passwd', 'attachment; filename="passwd"; filename*=UTF-8\'\'passwd'],
    ['a"b.csv', 'attachment; filename="a_b.csv"; filename*=UTF-8\'\'a%22b.csv'],
    ['C:\\Users\\asha\\cv.pdf', 'attachment; filename="cv.pdf"; filename*=UTF-8\'\'cv.pdf'],
    ["O'Brien (1)*.pdf", 'attachment; filename="O\'Brien (1)*.pdf"; filename*=UTF-8\'\'O%27Brien%20%281%29%2A.pdf'],
    ['', 'attachment; filename="file"; filename*=UTF-8\'\'file'],
  ])('names %j safely', (name, header) => {
    expect(attachment(name)).toBe(header);
  });

  it('never lets a name end the header or start another', () => {
    expect(attachment('x.pdf\r\nSet-Cookie: s=1')).not.toMatch(/[\r\n]/);
  });
});

describe('createFileStore', () => {
  it('signs a 60-second download link that downloads as an attachment and is never cached', async () => {
    const url = new URL(await createFileStore(s3()).downloadUrl('resume/1f0c', 'cv.pdf'));
    expect(url.origin).toBe('http://127.0.0.1:8333');
    expect(url.pathname).toBe('/radcore-files/resume/1f0c');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('60');
    expect(url.searchParams.get('response-content-disposition')).toBe(attachment('cv.pdf'));
    expect(url.searchParams.get('response-cache-control')).toBe('private, no-store');
  });

  it('signs a 5-minute upload policy for one server-made key under incoming/, its type and its kind\'s size', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-10T06:00:00Z'), toFake: ['Date'] });
    const { key, url, fields } = await createFileStore(s3()).presignUpload('photo', 'image/png');
    vi.useRealTimers();
    expect(key).toMatch(/^photo\/[0-9a-f-]{36}$/);
    expect(url).toBe('http://127.0.0.1:8333/radcore-files');
    // The browser writes only incoming/<key>; `key` itself, where the checked copy lives, is never in a policy.
    expect(fields['key']).toBe(`incoming/${key}`);
    expect(fields['Content-Type']).toBe('image/png');
    const policy = JSON.parse(Buffer.from(fields['Policy'] ?? '', 'base64').toString()) as
      { expiration: string; conditions: unknown[] };
    expect(policy.expiration).toBe('2026-11-10T06:05:00Z');
    for (const condition of [['content-length-range', 1, 10 * 1024 * 1024], { bucket: 'radcore-files' }, { key: `incoming/${key}` },
      { 'Content-Type': 'image/png' }]) expect(policy.conditions).toContainEqual(condition);
  });

  it('refuses to sign an upload of a type the kind doesn\'t take', async () => {
    await expect(createFileStore(s3()).presignUpload('resume', 'image/png')).rejects.toThrow(UploadRefused);
  });

  it('refuses a server file of a type its kind doesn\'t take, before reading it or reaching S3', async () => {
    await expect(createFileStore(s3()).putFile('export', 'no-such-file.csv', 'application/pdf')).rejects.toThrow(TypeError);
  });

  it('refuses a key made for another kind before reaching S3', async () => {
    await expect(createFileStore(s3()).verifyUpload('import/1f0c', 'photo')).rejects.toThrow(UploadRefused);
  });
});

describe('heldCredentials (ADR-001 §8: no IMDS call while signing)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  const creds = (id: string, expiration: string) => ({ accessKeyId: id, secretAccessKey: 's', expiration: new Date(expiration) });
  const logger = () => ({ info: vi.fn<(m: string) => void>(), error: vi.fn<(m: string, e?: unknown) => void>() });

  it('fetches once at start, signs from what it holds, and refreshes 15 minutes before expiry', async () => {
    vi.useFakeTimers({ now: Date.parse('2026-11-11T06:00:00Z') });
    const source = vi.fn<CredentialSource>()
      .mockResolvedValueOnce(creds('first', '2026-11-11T07:00:00Z'))
      .mockResolvedValueOnce(creds('second', '2026-11-11T13:00:00Z'));
    const held = await heldCredentials(source, logger());
    const reads = await Promise.all([held.read(), held.read(), held.read()]);
    expect([reads.map((c) => c.accessKeyId), source.mock.calls]).toEqual([['first', 'first', 'first'], [[]]]);
    await vi.advanceTimersByTimeAsync(44 * 60_000);
    expect(source).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect([(await held.read()).accessKeyId, source.mock.calls[1]]).toEqual(['second', [{ forceRefresh: true }]]);
    held.stop();
  });

  it('keeps the current credentials when a refresh fails, logs it, and tries again a minute later; stop ends it', async () => {
    vi.useFakeTimers({ now: Date.parse('2026-11-11T06:00:00Z') });
    const log = logger();
    const source = vi.fn<CredentialSource>()
      .mockResolvedValueOnce(creds('first', '2026-11-11T06:20:00Z'))
      .mockRejectedValueOnce(new Error('IMDS timed out'))
      .mockResolvedValueOnce(creds('second', '2026-11-11T12:00:00Z'));
    const held = await heldCredentials(source, log);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect([(await held.read()).accessKeyId, log.error.mock.calls.map((c) => c[0])]).toEqual(['first',
      ['file store: refreshing the S3 credentials failed; trying again in a minute']]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect((await held.read()).accessKeyId).toBe('second');
    held.stop();
    await vi.advanceTimersByTimeAsync(24 * 60 * 60_000);
    expect(source).toHaveBeenCalledTimes(3);
  });
});
