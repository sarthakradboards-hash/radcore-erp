// RAD-43 (RC-096, RC-191): what the file store decides without reaching S3. tools/s3.test.ts runs it on SeaweedFS.
import { testSettings } from '@radcore/test-helpers';
import { describe, expect, it, vi } from 'vitest';
import { attachment, createFileStore, loadConfig, UploadRefused } from '../index.ts';

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

  it('signs a 5-minute upload policy for one server-made key, its type and its kind\'s size', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-10T06:00:00Z'), toFake: ['Date'] });
    const { key, url, fields } = await createFileStore(s3()).presignUpload('photo', 'image/png');
    vi.useRealTimers();
    expect(key).toMatch(/^photo\/[0-9a-f-]{36}$/);
    expect(url).toBe('http://127.0.0.1:8333/radcore-files');
    expect(fields['key']).toBe(key);
    expect(fields['Content-Type']).toBe('image/png');
    const policy = JSON.parse(Buffer.from(fields['Policy'] ?? '', 'base64').toString()) as
      { expiration: string; conditions: unknown[] };
    expect(policy.expiration).toBe('2026-11-10T06:05:00Z');
    for (const condition of [['content-length-range', 1, 10 * 1024 * 1024], { bucket: 'radcore-files' }, { key },
      { 'Content-Type': 'image/png' }]) expect(policy.conditions).toContainEqual(condition);
  });

  it('refuses to sign an upload of a type the kind doesn\'t take', async () => {
    await expect(createFileStore(s3()).presignUpload('resume', 'image/png')).rejects.toThrow(UploadRefused);
  });

  it('refuses a key made for another kind before reaching S3', async () => {
    await expect(createFileStore(s3()).verifyUpload('import/1f0c', 'photo')).rejects.toThrow(UploadRefused);
  });
});
