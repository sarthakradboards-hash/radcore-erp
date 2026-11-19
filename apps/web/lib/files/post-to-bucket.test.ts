import { expect, it } from 'vitest';
import { BucketRefused, postToBucket } from './post-to-bucket.ts';

const file = new Blob(['png'], { type: 'image/png' });

it('posts the policy fields first and the file last, to the presigned URL', async () => {
  const sent: { url: string; init: RequestInit }[] = [];
  await postToBucket('http://bucket.test/radcore', { key: 'k/1', policy: 'p', 'x-amz-signature': 's' }, file,
    async (url, init) => { sent.push({ url: String(url), init: init ?? {} }); return new Response(null, { status: 204 }); });
  expect(sent[0]?.url).toBe('http://bucket.test/radcore');
  expect(sent[0]?.init.method).toBe('POST');
  expect([...(sent[0]?.init.body as FormData).keys()]).toEqual(['key', 'policy', 'x-amz-signature', 'file']);
});

it('throws BucketRefused with the status when the bucket refuses (too big, wrong type)', async () => {
  const refused = postToBucket('http://bucket.test/radcore', {}, file, async () => new Response('EntityTooLarge', { status: 400 }));
  await expect(refused).rejects.toBeInstanceOf(BucketRefused);
  await expect(refused).rejects.toMatchObject({ status: 400 });
});
