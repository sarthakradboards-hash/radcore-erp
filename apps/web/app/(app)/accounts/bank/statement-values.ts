// A statement import's form values (RAD-168 on RAD-159's #434; ADR-009 §11): the uploaded file, and the account's
// layout, the headings of its columns as the bank's file has them. The layout starts from the one the account was last
// read by, and is sent each time, so the server keeps it for the next upload. An empty reference column is none.
import { statementFormat } from '@radcore/lib-accounts/contract';
import { statementFiles } from '@radcore/lib-platform/contract';
import { z } from 'zod';
import { ApiError } from '../../../../lib/api-client.ts';
import { t } from '../../../../lib/i18n/index.ts';

type Format = z.output<typeof statementFormat>;

const CODES = ['not_a_bank_account', 'statement_format_required', 'upload_refused', 'not_ready', 'wrong_file_kind', 'not_imported'] as const;
/** The bank contracts' refusals in the screen's words, for Form's `messages`. */
export const BANK_MESSAGES: Partial<Record<string, string>> = Object.fromEntries(CODES.map((c) => [c, t(`books.bank.err.${c}`)]));

const heading = () => z.string().trim().min(1, t('books.bank.err.column')).max(100, t('books.bank.err.columnLong'));

export const importSchema = z.object({
  fileId: z.string().min(1, t('books.bank.err.file')),
  dateColumn: heading(), narrationColumn: heading(), referenceColumn: z.string().trim().max(100, t('books.bank.err.columnLong')),
  withdrawalColumn: heading(), depositColumn: heading(), balanceColumn: heading(), newestFirst: z.boolean(),
}).transform(({ fileId, referenceColumn, ...f }) => ({ fileId, format: { ...f, referenceColumn: referenceColumn === '' ? null : referenceColumn } }));

export type ImportInput = z.input<typeof importSchema>;

/** The types the worker reads now: CSV and Excel. A PDF statement waits for RAD-159's PDF reader (auditor-3 on #439). */
export const UPLOADABLE = statementFiles.startUpload.input.shape.contentType.options.filter((c) => c !== 'application/pdf');
type Uploadable = (typeof UPLOADABLE)[number];
/** The statement kind's limit (lib-platform's file kinds), checked here too so a big file is refused before it's sent. */
const MAX_BYTES = 15 * 1024 * 1024;

/**
 * The type a chosen file is uploaded as, or why it can't be. Windows browsers with Excel installed often call a .csv
 * `application/vnd.ms-excel`, or give no type at all, so a .csv named so is sent as text/csv (auditor-3 on #439).
 */
export function uploadType(file: { name: string; type: string; size: number }): { contentType: Uploadable } | { problem: 'type' | 'size' } {
  if (file.size > MAX_BYTES) return { problem: 'size' };
  const known = UPLOADABLE.find((c) => c === file.type);
  if (known !== undefined) return { contentType: known };
  if (/\.csv$/i.test(file.name) && (file.type === '' || file.type === 'application/vnd.ms-excel')) return { contentType: 'text/csv' };
  return { problem: 'type' };
}

/** The form's start: the account's kept layout, or empty before its first import. */
export const importValues = (format: Format | null): ImportInput => ({
  fileId: '', dateColumn: format?.dateColumn ?? '', narrationColumn: format?.narrationColumn ?? '', referenceColumn: format?.referenceColumn ?? '',
  withdrawalColumn: format?.withdrawalColumn ?? '', depositColumn: format?.depositColumn ?? '', balanceColumn: format?.balanceColumn ?? '',
  newestFirst: format?.newestFirst ?? false,
});

/** "1 new line; 2 already here." */
export const lineCounts = (added: number, present: number) => t('books.bank.import.counts', {
  added: t(added === 1 ? 'books.bank.import.new.one' : 'books.bank.import.new.other', { n: String(added) }),
  present: t(present === 1 ? 'books.bank.import.present.one' : 'books.bank.import.present.other', { n: String(present) }),
});

/**
 * Sends the import, waiting while the uploaded file is still being checked: no route reads a file's check, so a
 * `not_ready` is asked again every 2 s for up to 20 s (e2e-2 on #439). A refusal rolls back its saved-once claim, so the
 * same key asks again. Any other answer, or the last `not_ready`, goes to the form as it is.
 */
const pause = (ms: number) => new Promise<void>((done) => { setTimeout(done, ms); });
export async function importWhenChecked<T>(send: () => Promise<T>, tries = 10, wait = pause): Promise<T> {
  for (let left = tries; ; left -= 1) {
    try {
      return await send();
    } catch (e) {
      if (left <= 1 || !(e instanceof ApiError) || e.code !== 'not_ready') throw e;
      await wait(2000);
    }
  }
}
