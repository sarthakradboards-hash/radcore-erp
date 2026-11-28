'use client';
// Bank statements (RAD-168 on RAD-159's #434; ADR-009 §11): a bank account's statement lines, newest first (bank:read), and
// under bank:reconcile importing the bank's CSV or Excel file. The file goes straight to the bucket as a `statement`
// (statement_files:write), then the import names the account's layout: its columns' headings, kept for the next upload.
// The worker reads and checks it, all or nothing; the screen polls the import and lists every refused row, and an import
// can be undone while nothing is matched. Which rows are new, already present or refused is the server's to judge.
import { formatMoment } from '@radcore/lib-common';
import {
  getStatementFormatContract, getStatementImportContract, importStatementContract, listMoneyAccounts, listStatementImportsContract,
  listStatementLinesContract, undoStatementImportContract,
} from '@radcore/lib-accounts/contract';
import { statementFiles } from '@radcore/lib-platform/contract';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { useMe } from '../../../../components/shell/session-provider.tsx';
import { ReasonDialog } from '../../../../components/ui/dialog/reason-dialog.tsx';
import { CheckboxField, TextField } from '../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../components/ui/form/form.tsx';
import { DataTable, type Column } from '../../../../components/ui/table/data-table.tsx';
import { ApiError } from '../../../../lib/api-client.ts';
import { useApiList, useApiMutation, useApiQuery } from '../../../../lib/api/query.ts';
import { BucketRefused, postToBucket } from '../../../../lib/files/post-to-bucket.ts';
import { t } from '../../../../lib/i18n/index.ts';
import '../../../../components/ui/table/table.css';
import { ChoiceButtons } from '../../admin/shared.tsx';
import { refreshLines } from './lines-refresh.ts';
import { StatementLines } from './statement-lines.tsx';
import { BANK_MESSAGES, importSchema, importValues, importWhenChecked, lineCounts, UPLOADABLE, uploadType, type ImportInput } from './statement-values.ts';

type PastImport = z.output<typeof listStatementImportsContract.output>['items'][number];

/** The bank's file: chosen, sent straight to the bucket, then checked by the server; the form keeps its id. */
function StatementFile() {
  const inputId = useId();
  const { control, setValue, formState: { errors } } = useFormContext<ImportInput>();
  const fileId = useWatch({ control, name: 'fileId' });
  const start = useApiMutation(statementFiles.startUpload);
  const confirm = useApiMutation(statementFiles.confirmUpload);
  const [state, setState] = useState<{ busy: boolean; problem: string }>({ busy: false, problem: '' });
  const add = async (file: File) => {
    const kind = uploadType(file);
    if ('problem' in kind) {
      setState({ busy: false, problem: t(kind.problem === 'size' ? 'books.bank.file.err.size' : 'books.bank.file.err.type') });
      return;
    }
    setState({ busy: true, problem: '' });
    try {
      const { id, url, fields } = await start.submit({ filename: file.name, contentType: kind.contentType });
      await postToBucket(url, fields, file);
      await confirm.submit({ id });
      setValue('fileId', id, { shouldDirty: true, shouldValidate: true });
      setState({ busy: false, problem: '' });
    } catch (e) {
      setState({ busy: false, problem: e instanceof BucketRefused ? t('books.bank.file.err.bucket')
        : e instanceof ApiError ? (BANK_MESSAGES[e.code] ?? e.envelope.issues[0]?.message ?? e.envelope.message) : t('books.bank.file.err.offline') });
    }
  };
  const missing = errors.fileId?.message;
  return (
    <div className="kit-field">
      <label htmlFor={inputId}>{t('books.bank.file')}</label>
      <p className="kit-hint">{fileId === '' ? t('books.bank.file.hint') : t('books.bank.file.checking')}</p>
      <input id={inputId} type="file" accept={['.csv', '.xlsx', ...UPLOADABLE].join(',')} disabled={state.busy}
        onChange={(e) => { const f = e.currentTarget.files?.[0]; if (f !== undefined) void add(f); }} />
      {state.busy ? <p role="status">{t('books.bank.file.uploading')}</p> : null}
      {state.problem === '' ? null : <p role="alert" className="kit-form-alert">{state.problem}</p>}
      {missing === undefined || state.problem !== '' ? null : <p className="kit-field-error">{missing}</p>}
    </div>
  );
}

/** Where an import stands, polled while the worker reads it, with every refused row and, under bank:reconcile, the undo
 * (offered only while the server says it can be undone, when it's known: a matched line keeps it). */
function ImportStatus({ id, mayUndo, undoable = true }: { id: string; mayUndo: boolean; undoable?: boolean }) {
  const [settled, setSettled] = useState(false);
  const q = useApiQuery(getStatementImportContract, { id }, settled ? {} : { refetchInterval: 2000 });
  const undo = useApiMutation(undoStatementImportContract, { invalidates: [getStatementImportContract, listStatementLinesContract, listStatementImportsContract] });
  const [undoing, setUndoing] = useState(false);
  const captionId = useId();
  // The Undo button is gone once it's undone, so focus goes to the import's heading, not the body (e2e-2 on #439).
  const heading = useRef<HTMLHeadingElement>(null);
  const status = q.data?.status;
  // Polling stops once the worker has settled it (state set while rendering, React's pattern for state derived from a prop).
  if (!settled && status !== undefined && status !== 'queued') setSettled(true);
  // Its lines are in only now, well after the POST answered, so the table below reads them again (e2e-2 on #439).
  const client = useQueryClient();
  useEffect(() => { if (settled) void refreshLines(client); }, [settled, client]);
  const i = q.data;
  if (q.error !== null) return <p role="alert" className="kit-form-alert">{t('error.title')}</p>;
  if (i === undefined) return <p>{t('loading')}</p>;
  return (
    <section aria-labelledby={captionId}>
      <h3 id={captionId} ref={heading} tabIndex={-1}>{t('books.bank.import.heading', { when: formatMoment(i.createdAt) })}</h3>
      <p role="status">{t(`books.bank.import.status.${i.status}`)}</p>
      {i.status === 'imported' ? (
        <>
          <p>{lineCounts(i.newLines ?? 0, i.presentLines ?? 0)}</p>
          {mayUndo && undoable ? (
            <div className="kit-actions">
              <button type="button" className="kit-button" onClick={() => setUndoing(true)}>{t('books.bank.undo')}</button>
            </div>
          ) : null}
        </>
      ) : null}
      {i.refusals.length === 0 ? null : (
        <div className="kit-table">
          <div className="kit-table-scroll" role="region" aria-label={t('books.bank.refusals')} tabIndex={0}>
            <table>
              <caption>{t('books.bank.refusals')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('books.bank.col.row')}</th>
                  <th scope="col">{t('books.bank.col.column')}</th>
                  <th scope="col">{t('books.bank.col.problem')}</th>
                </tr>
              </thead>
              <tbody>
                {i.refusals.map((r, n) => (
                  <tr key={`${r.row}-${r.column}-${n}`}>
                    <td>{r.row === 0 ? t('books.bank.wholeFile') : String(r.row)}</td>
                    <td>{r.column}</td>
                    <td>{r.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <ReasonDialog open={undoing} onOpenChange={setUndoing} messages={BANK_MESSAGES} title={t('books.bank.undo.title')}
        action={t('books.bank.undo')} done={t('books.bank.undone')}
        onConfirm={async (reason) => { await undo.submit({ id: i.id, reason }); setTimeout(() => heading.current?.focus(), 0); }} />
    </section>
  );
}

/** Imports a statement into the account, by its kept layout or a new one. */
function ImportForm({ accountId }: { accountId: string }) {
  const headingId = useId();
  const format = useApiQuery(getStatementFormatContract, { id: accountId });
  const start = useApiMutation(importStatementContract, { invalidates: [listStatementLinesContract, listStatementImportsContract] });
  const [imports, setImports] = useState<string[]>([]);
  if (format.error !== null) return <p role="alert" className="kit-form-alert">{t('error.title')}</p>;
  if (format.data === undefined) return <p>{t('loading')}</p>;
  const latest = imports.at(-1);
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId}>{t('books.bank.import.title')}</h2>
      <p>{t(format.data.format === null ? 'books.bank.import.first' : 'books.bank.import.kept')}</p>
      {/* Keyed by the imports made, so each starts again with no file, from the layout as kept. */}
      <Form key={imports.length} aria-labelledby={headingId} schema={importSchema} defaultValues={importValues(format.data.format)} saved={false}
        messages={BANK_MESSAGES}
        onSubmit={async (v) => {
          const { id } = await importWhenChecked(() => start.submit({ accountId, ...v }));
          await format.refetch();
          setImports((was) => [...was, id]);
        }}>
        <StatementFile />
        <fieldset className="kit-field">
          <legend>{t('books.bank.layout')}</legend>
          <p className="kit-hint">{t('books.bank.layout.hint')}</p>
          <TextField name="dateColumn" label={t('books.bank.layout.date')} autoComplete="off" />
          <TextField name="narrationColumn" label={t('books.bank.layout.narration')} autoComplete="off" />
          <TextField name="referenceColumn" label={t('books.bank.layout.reference')} hint={t('books.bank.layout.reference.hint')} autoComplete="off" />
          <TextField name="withdrawalColumn" label={t('books.bank.layout.withdrawal')} autoComplete="off" />
          <TextField name="depositColumn" label={t('books.bank.layout.deposit')} autoComplete="off" />
          <TextField name="balanceColumn" label={t('books.bank.layout.balance')} autoComplete="off" />
          <CheckboxField name="newestFirst" label={t('books.bank.layout.newestFirst')} />
        </fieldset>
        <SubmitButton>{t('books.bank.import.submit')}</SubmitButton>
      </Form>
      {latest === undefined ? null : <ImportStatus key={latest} id={latest} mayUndo />}
    </section>
  );
}

/** The account's imports, newest first: the way back to one after a reload, to read its refused rows or undo it. The open
 * one is read from the list each time, so it follows the list's refresh: one opened while still being read offers Undo
 * once it's imported (e2e-2 on #449). */
function PastImports({ accountId, mayUndo }: { accountId: string; mayUndo: boolean }) {
  const list = useApiList(listStatementImportsContract, { filter: { accountId } });
  const [openId, setOpenId] = useState<string | null>(null);
  const open = list.items.find((r) => r.id === openId);
  // Numbered, since two imports in one minute would otherwise share a name (e2e-2 on #449).
  const n = (r: PastImport) => String(list.items.findIndex((x) => x.id === r.id) + 1);
  const cols: Column<PastImport>[] = [
    { id: 'when', header: t('books.bank.past.col.when'), cell: (r) => formatMoment(r.createdAt) },
    { id: 'status', header: t('books.bank.col.status'), cell: (r) => t(`books.bank.past.status.${r.status}`) },
    { id: 'lines', header: t('books.bank.past.col.lines'), cell: (r) => (r.status === 'imported' ? lineCounts(r.newLines ?? 0, r.presentLines ?? 0) : '') },
    { id: 'refused', header: t('books.bank.past.col.refused'), numeric: true, cell: (r) => (r.refused === 0 ? '' : String(r.refused)) },
    { id: 'review', header: t('books.bank.past.col.actions'), cell: (r) => (
      <button type="button" className="kit-button" aria-pressed={openId === r.id} onClick={() => setOpenId(r.id)}
        aria-label={t('books.bank.past.review.for', { n: n(r), when: formatMoment(r.createdAt) })}>{t('books.bank.past.review')}</button>
    ) },
  ];
  return (
    <>
      <h2>{t('books.bank.past')}</h2>
      <DataTable caption={t('books.bank.past')} columns={cols} rowKey={(r) => r.id} list={list} empty={t('books.bank.past.empty')} />
      {open === undefined ? null : <ImportStatus key={open.id} id={open.id} mayUndo={mayUndo} undoable={open.undoable} />}
    </>
  );
}

export default function BankPage() {
  const { permissions } = useMe();
  // The bank accounts come from /money-accounts, so the page needs that key as well as bank:read (auditor-3 on #439).
  const mayRead = permissions.includes('bank:read') && permissions.includes('money_accounts:read');
  const mayImport = permissions.includes('bank:reconcile') && permissions.includes('statement_files:write');
  const money = useApiQuery(listMoneyAccounts, {}, { enabled: mayRead });
  const banks = (money.data?.items ?? []).filter((a) => !a.cash);
  const [picked, setPicked] = useState('');
  const accountId = banks.some((b) => b.id === picked) ? picked : (banks[0]?.id ?? '');
  const body = !mayRead ? <p>{t('books.bank.none')}</p>
    : money.error !== null ? <p role="alert" className="kit-form-alert">{t('books.bank.noAccounts')}</p>
    : money.data === undefined ? <p>{t('loading')}</p>
    : banks.length === 0 ? <p>{t('books.bank.empty')}</p>
    : (
      <>
        <div className="admin-toolbar">
          <ChoiceButtons label={t('books.bank.account')} value={accountId} onChange={setPicked} options={banks.map((b) => ({ value: b.id, label: b.name }))} />
        </div>
        {mayImport ? <ImportForm key={accountId} accountId={accountId} /> : null}
        <PastImports key={`past-${accountId}`} accountId={accountId} mayUndo={permissions.includes('bank:reconcile')} />
        <StatementLines key={`lines-${accountId}`} accountId={accountId} mayMatch={permissions.includes('bank:reconcile')} />
      </>
    );
  return (
    <>
      <h1>{t('books.bank.title')}</h1>
      <p>{t('books.bank.intro')}</p>
      {body}
    </>
  );
}
