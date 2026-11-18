// The middle step of an upload (RAD-43, RC-191): the browser POSTs the file straight to the bucket with the presigned
// policy's fields from startUpload, never through the API. S3 takes the fields first and the file last, and refuses a
// file the policy doesn't allow (too big, another type) with a 4xx, before anything is stored.

/** The bucket answered with something other than success. */
export class BucketRefused extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`The bucket refused the upload (${status})`);
    this.status = status;
  }
}

export async function postToBucket(url: string, fields: Readonly<Record<string, string>>, file: Blob,
  send: typeof fetch = fetch): Promise<void> {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.append(name, value);
  body.append('file', file);
  const answer = await send(url, { method: 'POST', body });
  if (!answer.ok) throw new BucketRefused(answer.status);
}
