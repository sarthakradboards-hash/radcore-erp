// The kinds of file people upload, each with its size limit and allowed types (ADR-004 §2, RAD-43). The limits go
// into the presigned POST's policy, so the bucket itself refuses a bigger file, and verifyUpload checks them again.
const MB = 1024 * 1024;
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export const FILE_KINDS = {
  photo: { maxBytes: 10 * MB, types: ['image/jpeg', 'image/png', 'image/webp', 'image/heic'] },
  resume: { maxBytes: 5 * MB, types: ['application/pdf'] },
  statement: { maxBytes: 15 * MB, types: ['application/pdf', 'text/csv', XLSX] },
  import: { maxBytes: 25 * MB, types: ['text/csv', XLSX] },
  // Item pictures (RAD-89, ADR-004 §2): the one view kind, shown inline in the app rather than downloaded, so a link
  // writes no download event. JPEG, PNG and WebP only: browsers can't show HEIC in a page. Uploaded and seen with the
  // items keys, not file keys of their own.
  item_picture: { maxBytes: 5 * MB, types: ['image/jpeg', 'image/png', 'image/webp'], view: true,
    perms: { read: 'items:read', write: 'items:write' } },
} as const satisfies Record<string, { maxBytes: number; types: readonly string[]; view?: true;
  perms?: { read: string; write: string } }>;

export type FileKind = keyof typeof FILE_KINDS;

type Key = `${string}:${string}`;
/** The keys that upload and see a kind: its own (`photo_files:write`), or the ones it names. */
export const fileKeys = (kind: FileKind): { read: Key; write: Key } => {
  const rule = FILE_KINDS[kind] as { perms?: { read: Key; write: Key } };
  return rule.perms ?? { read: `${kind}_files:read`, write: `${kind}_files:write` };
};
/** Whether a kind is viewed inline (item pictures) rather than downloaded with a recorded event. */
export const isViewKind = (kind: FileKind): boolean => (FILE_KINDS[kind] as { view?: true }).view === true;

/** Files the server writes itself, never uploaded by a browser: no presigned policy, so no size limit of their own;
 * the export's row cap and its size-limited volume bound them (RAD-47). */
export const SERVER_FILE_KINDS = {
  export: { types: ['text/csv', XLSX] },
} as const satisfies Record<string, { types: readonly string[] }>;

export type ServerFileKind = keyof typeof SERVER_FILE_KINDS;
