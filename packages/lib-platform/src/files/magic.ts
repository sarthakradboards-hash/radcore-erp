// Upload magic bytes (ADR-003 §3, RAD-43): does the file begin the way its declared type must? It confirms, it
// doesn't detect: the declared type picks the one signature to check, at fixed offsets in the first 1 KB, following no
// length field and inflating nothing. An XLSX is confirmed only as a ZIP; whether it's a workbook is the import
// parser's question (RAD-46, in the isolate).

/** How much of a file the check reads. */
export const MAGIC_BYTES = 1024;

const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));
const at = (head: Uint8Array, offset: number, sig: readonly number[]): boolean =>
  head.length >= offset + sig.length && sig.every((b, i) => head[offset + i] === b);
const text = (head: Uint8Array, from: number, length: number): string =>
  String.fromCharCode(...head.subarray(from, from + length));

const JPEG = [0xff, 0xd8, 0xff];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const ZIP = [0x50, 0x4b, 0x03, 0x04];
const HEIC_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1']);

const isWebp = (h: Uint8Array) => at(h, 0, ascii('RIFF')) && at(h, 8, ascii('WEBP'));
const isHeic = (h: Uint8Array) => at(h, 4, ascii('ftyp')) && h.length >= 12 && HEIC_BRANDS.has(text(h, 8, 4));
// PDF readers look for the header anywhere in the first 1 KB.
const isPdf = (h: Uint8Array) => text(h, 0, MAGIC_BYTES).includes('%PDF-');

const CHECKS: Record<string, (head: Uint8Array) => boolean> = {
  'image/jpeg': (h) => at(h, 0, JPEG),
  'image/png': (h) => at(h, 0, PNG),
  'image/webp': isWebp,
  'image/heic': isHeic,
  'application/pdf': isPdf,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': (h) => at(h, 0, ZIP),
  // No signature: text with no NUL byte, and not one of the other kinds renamed.
  'text/csv': (h) => h.length > 0 && !h.subarray(0, MAGIC_BYTES).includes(0)
    && !(at(h, 0, JPEG) || at(h, 0, PNG) || at(h, 0, ZIP) || isWebp(h) || isHeic(h) || isPdf(h)),
};

/** Whether `head`, the file's first bytes, begins the way `contentType` must. An unknown type is refused. */
export function confirmsType(contentType: string, head: Uint8Array): boolean {
  return CHECKS[contentType]?.(head.subarray(0, MAGIC_BYTES)) ?? false;
}
