// Smoke test for the dev object store (SeaweedFS in compose.dev.yml): a presigned PUT, then a presigned GET.
// It needs the running store, so it runs where S3_ENDPOINT is set (CI after `npm run db:up`).
import { CreateBucketCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

const env = process.env;

describe.skipIf(!env['S3_ENDPOINT'])('dev object store', () => {
  it('accepts a presigned PUT and serves it back on a presigned GET', async () => {
    const s3 = new S3Client({
      endpoint: env['S3_ENDPOINT'] ?? '',
      region: env['S3_REGION'] ?? '',
      forcePathStyle: true,
      // Otherwise the SDK signs a checksum of the empty body into a presigned PUT, and the real body fails it.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      credentials: { accessKeyId: env['S3_ACCESS_KEY_ID'] ?? '', secretAccessKey: env['S3_SECRET_ACCESS_KEY'] ?? '' },
    });
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
