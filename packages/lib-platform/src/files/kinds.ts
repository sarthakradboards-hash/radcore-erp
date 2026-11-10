// The kinds of file people upload, each with its size limit and allowed types (ADR-004 §2, RAD-43). The limits go
// into the presigned POST's policy, so the bucket itself refuses a bigger file, and verifyUpload checks them again.
const MB = 1024 * 1024;
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export const FILE_KINDS = {
  photo: { maxBytes: 10 * MB, types: ['image/jpeg', 'image/png', 'image/webp', 'image/heic'] },
  resume: { maxBytes: 5 * MB, types: ['application/pdf'] },
  statement: { maxBytes: 15 * MB, types: ['application/pdf', 'text/csv', XLSX] },
  import: { maxBytes: 25 * MB, types: ['text/csv', XLSX] },
} as const satisfies Record<string, { maxBytes: number; types: readonly string[] }>;

export type FileKind = keyof typeof FILE_KINDS;
