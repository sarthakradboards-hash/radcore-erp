// Smoke test for the dev object store (SeaweedFS in compose.dev.yml): a presigned PUT, then a presigned GET.
// It needs the running store, so it runs where S3_ENDPOINT is set: CI's compose job, which has the store, or locally
// after `npm run db:up`. In CI it fails instead of skipping (RC-019); the test job, which has no store, excludes it.
import { CreateBucketCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { attachment, createFileStore } from '@radcore/lib-platform';
import { describe, expect, it } from 'vitest';

const env = process.env;

it.runIf(env['CI'] && !env['S3_ENDPOINT'])('has its object store in CI', () => {
  expect.fail('S3_ENDPOINT is not set: in CI this smoke test must run, not skip');
});

const client = () => new S3Client({
  endpoint: env['S3_ENDPOINT'] ?? '',
  region: env['S3_REGION'] ?? '',
  forcePathStyle: true,
  // Otherwise the SDK signs a checksum of the empty body into a presigned PUT, and the real body fails it.
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
  credentials: { accessKeyId: env['S3_ACCESS_KEY_ID'] ?? '', secretAccessKey: env['S3_SECRET_ACCESS_KEY'] ?? '' },
});

describe.skipIf(!env['S3_ENDPOINT'])('dev object store', () => {
  it('accepts a presigned PUT and serves it back on a presigned GET', async () => {
    const s3 = client();
    const Bucket = `smoke-${randomUUID()}`;
    const Key = 'hello.txt';
    await s3.send(new CreateBucketCommand({ Bucket }));

    const put = await fetch(await getSignedUrl(s3, new PutObjectCommand({ Bucket, Key }), { expiresIn: 60 }),
      { method: 'PUT', body: 'radcore' });
    expect(put.status, await put.clone().text()).toBe(200);

    const get = await fetch(await getSignedUrl(s3, new GetObjectCommand({ Bucket, Key }), { expiresIn: 60 }));
    expect(get.status).toBe(200);
    expect(await get.text()).toBe('radcore');

    // Unsigned access is refused, so the store isn't open to anything on the machine.
    expect((await fetch(`${env['S3_ENDPOINT']}/${Bucket}/${Key}`)).status).toBe(403);
  });
});

// RAD-43 (RC-096, RC-191): lib-platform's file store against the dev store. Each test uploads straight to the bucket,
// as a browser's presigned POST would, then checks what the API does with the result.
describe.skipIf(!env['S3_ENDPOINT'])('file store', () => {
  const store = async () => {
    const s3 = client();
    const bucket = `files-${randomUUID()}`;
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
    const put = (Key: string, body: Buffer | string, ContentType: string) =>
      s3.send(new PutObjectCommand({ Bucket: bucket, Key, Body: body, ContentType }));
    const files = createFileStore({ region: env['S3_REGION'] ?? '', bucket, endpoint: env['S3_ENDPOINT'] ?? '',
      accessKeyId: env['S3_ACCESS_KEY_ID'] ?? '', secretAccessKey: env['S3_SECRET_ACCESS_KEY'] ?? '' }, s3);
    return { put, files };
  };

  it('accepts an upload that fits its kind, and serves it as a never-cached attachment', async () => {
    const { put, files } = await store();
    const key = `resume/${randomUUID()}`;
    await put(key, '%PDF-1.7 resume', 'application/pdf');
    expect(await files.verifyUpload(key, 'resume')).toEqual({ size: 15, contentType: 'application/pdf' });

    const get = await fetch(await files.downloadUrl(key, 'Asha CV.pdf'));
    expect(get.status).toBe(200);
    expect(get.headers.get('content-disposition')).toBe(attachment('Asha CV.pdf'));
    expect(get.headers.get('cache-control')).toBe('private, no-store');
    expect(await get.text()).toBe('%PDF-1.7 resume');
  });

  it('refuses an upload over its kind\'s size, of a type its kind doesn\'t take, empty, or missing', async () => {
    const { put, files } = await store();
    const [big, text, empty, none] = [1, 2, 3, 4].map(() => `resume/${randomUUID()}`) as [string, string, string, string];
    await put(big, Buffer.alloc(5 * 1024 * 1024 + 1), 'application/pdf');
    await put(text, 'hello', 'text/plain');
    await put(empty, '', 'application/pdf');
    await expect(files.verifyUpload(big, 'resume')).rejects.toThrow('upload refused: the file is larger than 5242880 bytes');
    await expect(files.verifyUpload(text, 'resume')).rejects.toThrow('upload refused: a resume can\'t be "text/plain"');
    await expect(files.verifyUpload(empty, 'resume')).rejects.toThrow('upload refused: the file is empty');
    await expect(files.verifyUpload(none, 'resume')).rejects.toThrow('upload refused: nothing was uploaded');
  });
});