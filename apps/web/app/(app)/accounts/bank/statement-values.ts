// A statement import's form values (RAD-168 on RAD-159's #434; ADR-009 §11): the uploaded file, and the account's
// layout, the headings of its columns as the bank's file has them. The layout starts from the one the account was last
// read by, and is sent each time, so the server keeps it for the next upload. An empty reference column is none.
import { statementFormat } from '@radcore/lib-accounts/contract';
import { z } from 'zod';
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

/** The form's start: the account's kept layout, or empty before its first import. */
export const importValues = (format: Format | null): ImportInput => ({
  fileId: '', dateColumn: format?.dateColumn ?? '', narrationColumn: format?.narrationColumn ?? '', referenceColumn: format?.referenceColumn ?? '',
  withdrawalColumn: format?.withdrawalColumn ?? '', depositColumn: format?.depositColumn ?? '', balanceColumn: format?.balanceColumn ?? '',
  newestFirst: format?.newestFirst ?? false,
});
