// Smoke test for the dev object store (SeaweedFS in compose.dev.yml): a presigned PUT, then a presigned GET.
// It needs the running store, so it runs where S3_ENDPOINT is set: CI's compose job, which has the store, or locally
// after `npm run db:up`. In CI it fails instead of skipping (RC-019); the test job, which has no store, excludes it.
import { CreateBucketCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { attachment, createFileStore } from '@radcore/lib-platform';
import { describe, expect, it } from 'vitest';

const env = process.env;

// Staging's smoke job runs this file against real S3 (S3_REAL_POLICY=1), where there's no dev store to find.
const REAL_S3 = env['S3_REAL_POLICY'] === '1';
// A presigned POST of a PDF-shaped body of `size` bytes, with these form fields; the store's answer.
const post = async (url: string, fields: Record<string, string>, size: number) => {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  form.append('file', new Blob([Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(Math.max(0, size - 9))])]));
  return (await fetch(url, { method: 'POST', body: form })).status;
};

it.runIf(env['CI'] && !env['S3_ENDPOINT'] && !REAL_S3)('has its object store in CI', () => {
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

  it('refuses a file whose first bytes don\'t match its declared type', async () => {
    const { put, files } = await store();
    const key = `photo/${randomUUID()}`;
    await put(key, '<html>not a picture</html>', 'image/png');
    await expect(files.verifyUpload(key, 'photo')).rejects.toThrow('upload refused: the file doesn\'t begin the way a image/png must');
  });

  it('streams a server-written file to a key it makes, and serves it back (RAD-47\'s export)', async () => {
    const { files } = await store();
    const dir = mkdtempSync(join(tmpdir(), 'radcore-put-'));
    const csv = 'number,total\nINV-1,1250.50\n';
    try {
      const path = join(dir, 'invoices.csv');
      writeFileSync(path, csv);
      const { key, size } = await files.putFile('export', path, 'text/csv');
      expect(key).toMatch(/^export\/[0-9a-f-]{36}$/);
      expect(size).toBe(Buffer.byteLength(csv));
      const get = await fetch(await files.downloadUrl(key, 'invoices.csv'));
      expect(get.headers.get('content-type')).toBe('text/csv');
      expect(await get.text()).toBe(csv);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // ADR-004 §1's smoke test: the presigned POST's conditions are enforced by the store, not only by our code.

  it('takes a presigned POST within its policy, and the store refuses one too big, of another type or key', async () => {
    const { files } = await store();
    const upload = await files.presignUpload('resume', 'application/pdf');
    const send = (fields: Record<string, string>, size: number) => post(upload.url, fields, size);
    expect({
      within: await send(upload.fields, 1024),
      tooBig: await send(upload.fields, 5 * 1024 * 1024 + 1),
      otherType: await send({ ...upload.fields, 'Content-Type': 'text/html' }, 1024),
      otherKey: await send({ ...upload.fields, key: `resume/${randomUUID()}` }, 1024),
    }).toEqual({ within: 204, tooBig: 400, otherType: 403, otherKey: 403 });
    expect(await files.verifyUpload(upload.key, 'resume')).toEqual({ size: 1024, contentType: 'application/pdf' });
  });

});

// The one policy case SeaweedFS doesn't enforce: it accepts a form field the policy doesn't name (204 in CI), where
// real S3 answers 403. So this runs only with S3_REAL_POLICY=1, which the staging smoke job sets (M8-09), against the
// real bucket with the instance role; RAD-43's upload criterion is met when it's green there. Our code never sends
// such a field; the policy is the bucket's guard against a browser that does. A refused POST stores nothing.
describe.runIf(REAL_S3)('file store on real S3', () => {
  it('refuses a presigned POST with a field its policy doesn\'t name, such as an ACL', async () => {
    const files = createFileStore({ region: env['S3_REGION'] ?? '', bucket: env['S3_BUCKET_FILES'] ?? '', endpoint: null,
      accessKeyId: null, secretAccessKey: null });
    const upload = await files.presignUpload('resume', 'application/pdf');
    expect(await post(upload.url, { ...upload.fields, acl: 'public-read' }, 1024)).toBe(403);
  });
});