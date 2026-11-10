// The file store (ADR-004 §2, RAD-43): files live in S3 (SeaweedFS in development and CI), reached only through
// presigned links, so neither the API nor the database ever holds a whole file (RC-191). The client's endpoint comes
// only from settings (ADR-003 §7).
import { randomUUID } from 'node:crypto';
import { GetObjectCommand, HeadObjectCommand, NotFound, S3Client } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Config } from '../config.ts';
import { FILE_KINDS, type FileKind } from './kinds.ts';
import { confirmsType, MAGIC_BYTES } from './magic.ts';

/** How long a download link works. */
const DOWNLOAD_SECONDS = 60;
/** How long an upload link works (ADR-004 §2). */
const UPLOAD_SECONDS = 5 * 60;

export type FileStore = {
  /** A short-lived link that downloads the file as an attachment named `filename`, never cached. */
  downloadUrl(key: string, filename: string): Promise<string>;
  /** After an upload, before the file is used: it exists, its size and type fit its kind, and it begins the way its
   * type must (magic bytes). */
  verifyUpload(key: string, kind: FileKind): Promise<{ size: number; contentType: string }>;
  /** A 5-minute presigned POST for one new file of `kind` and type `contentType`, at a key the server makes. The
   * bucket refuses a bigger file, another type, another key or any extra field (ADR-004 §2). */
  presignUpload(kind: FileKind, contentType: string): Promise<{ key: string; url: string; fields: Record<string, string> }>;
};

/** An uploaded file that doesn't fit its kind. The message names the rule, never the file's name or content. */
export class UploadRefused extends Error {
  constructor(reason: string) {
    super(`upload refused: ${reason}`);
    this.name = 'UploadRefused';
  }
}

/** The S3 client from settings: the instance role in staging and production, the dev store's keys elsewhere. */
function s3Client(s3: Config['s3']): S3Client {
  return new S3Client({
    region: s3.region,
    ...(s3.endpoint !== null ? { endpoint: s3.endpoint, forcePathStyle: true } : {}),
    ...(s3.accessKeyId !== null && s3.secretAccessKey !== null
      ? { credentials: { accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey } } : {}),
    // A checksum is signed only where S3 requires one, so a presigned link's body isn't held to the empty body's.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

/**
 * `Content-Disposition: attachment` with the name in both forms (RFC 6266): an ASCII fallback with anything else,
 * quotes, backslashes, separators and control characters replaced, and the exact name UTF-8 encoded.
 */
export function attachment(filename: string): string {
  const base = filename.split(/[/\\]/).at(-1) ?? '';
  const ascii = base.replace(/[^\x20-\x7e]|["\\]/g, '_').trim() || 'file';
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(base || 'file')}`;
}

export function createFileStore(s3: Config['s3'], client: S3Client = s3Client(s3)): FileStore {
  const Bucket = s3.bucket;
  return {
    downloadUrl: (key, filename) => getSignedUrl(client, new GetObjectCommand({ Bucket, Key: key,
      ResponseContentDisposition: attachment(filename), ResponseCacheControl: 'private, no-store' }),
    { expiresIn: DOWNLOAD_SECONDS }),

    async verifyUpload(key, kind) {
      // Keys are made by the server as `<kind>/<uuid>`, so a key can't be passed off as another kind's.
      if (!key.startsWith(`${kind}/`)) throw new UploadRefused(`the key isn't a ${kind} key`);
      const rule = FILE_KINDS[kind];
      const meta = await client.send(new HeadObjectCommand({ Bucket, Key: key })).catch((err: unknown) => {
        if (err instanceof NotFound) throw new UploadRefused('nothing was uploaded');
        throw err;
      });
      const size = meta.ContentLength ?? 0;
      if (size === 0) throw new UploadRefused('the file is empty');
      if (size > rule.maxBytes) throw new UploadRefused(`the file is larger than ${rule.maxBytes} bytes`);
      const contentType = meta.ContentType ?? '';
      if (!(rule.types as readonly string[]).includes(contentType)) {
        throw new UploadRefused(`a ${kind} can't be ${JSON.stringify(contentType)}`);
      }
      const first = await client.send(new GetObjectCommand({ Bucket, Key: key, Range: `bytes=0-${MAGIC_BYTES - 1}` }));
      const head = await first.Body?.transformToByteArray() ?? new Uint8Array();
      if (!confirmsType(contentType, head)) throw new UploadRefused(`the file doesn't begin the way a ${contentType} must`);
      return { size, contentType };
    },

    async presignUpload(kind, contentType) {
      const rule = FILE_KINDS[kind];
      if (!(rule.types as readonly string[]).includes(contentType)) {
        throw new UploadRefused(`a ${kind} can't be ${JSON.stringify(contentType)}`);
      }
      const key = `${kind}/${randomUUID()}`;
      // The policy fixes the bucket and this key (the library adds both), the type, the size range and the expiry.
      // S3 refuses any form field the policy doesn't name, so the browser can't add an ACL or other settings.
      const { url, fields } = await createPresignedPost(client, { Bucket, Key: key, Expires: UPLOAD_SECONDS,
        Fields: { 'Content-Type': contentType }, Conditions: [['content-length-range', 1, rule.maxBytes]] });
      return { key, url, fields };
    },
  };
}
