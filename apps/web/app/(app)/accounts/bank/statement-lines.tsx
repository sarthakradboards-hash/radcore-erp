'use client';
// Matching a bank account's statement lines to the books (RAD-168 on RAD-165's #454 and #460; ADR-009 §12, RC-210): the
// lines with whether each is matched, and under bank:reconcile, Match (one of the server's suggestions, or several lines
// on either side whose totals agree) and Unmatch with a reason. Out of page.tsx so each file stays under E2's cap.
import { addDays, formatDate, formatMoney } from '@radcore/lib-common';
import {
  listBookLinesContract, listMatchCandidatesContract, listStatementImportsContract, listStatementLinesContract, matchLinesContract,
  unmatchContract,
} from '@radcore/lib-accounts/contract';
import { useEffect, useId, useRef, useState } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { ReasonDialog } from '../../../../components/ui/dialog/reason-dialog.tsx';
import { announce } from '../../../../components/ui/live-region.tsx';
import { CheckboxesField, RadioField } from '../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../components/ui/form/form.tsx';
import { DataTable, type Column } from '../../../../components/ui/table/data-table.tsx';
import { useApiList, useApiMutation, useApiQuery } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { ChoiceButtons } from '../../admin/shared.tsx';
import { bookLineLabel, candidateLabel, MATCH_MESSAGES, matchTotals, movedWords } from './match-values.ts';

type Line = z.output<typeof listStatementLinesContract.output>['items'][number];
type BookLine = z.output<typeof listBookLinesContract.output>['items'][number];

/** A statement line in words, for the match panel's title and the row's buttons: which way the money went, how much, when
 * (auditor-3 on #456). */
const lineWords = (l: Line) => ({ dir: t(l.direction === 'in' ? 'books.bank.dir.in' : 'books.bank.dir.out'), amount: formatMoney(l.amount),
  date: formatDate(l.valueDate) });

const pickSchema = z.object({ journalLineId: z.string().min(1, t('books.bank.match.err.pick')) });

const severalSchema = z.object({
  statementLineIds: z.array(z.string()).min(1, t('books.bank.several.err.statement')).max(50, t('books.bank.several.err.many')),
  journalLineIds: z.array(z.string()).min(1, t('books.bank.several.err.book')).max(50, t('books.bank.several.err.many')),
});

/** Both ticked sides' totals and their difference, and the submit, offered only once they agree. */
function SeveralTotals({ statement, book }: { statement: readonly Line[]; book: readonly BookLine[] }) {
  const { control } = useFormContext<z.input<typeof severalSchema>>();
  const pickedStatement = useWatch({ control, name: 'statementLineIds' });
  const pickedBook = useWatch({ control, name: 'journalLineIds' });
  const totals = matchTotals(statement.filter((l) => pickedStatement.includes(l.id)), book.filter((b) => pickedBook.includes(b.journalLineId)));
  return (
    <>
      <dl className="admin-facts" aria-label={t('books.bank.several.totals')}>
        <dt>{t('books.bank.several.statementTotal')}</dt><dd>{movedWords(totals.statement)}</dd>
        <dt>{t('books.bank.several.bookTotal')}</dt><dd>{movedWords(totals.book)}</dd>
        <dt>{t('books.bank.several.difference')}</dt><dd>{movedWords(totals.difference)}</dd>
      </dl>
      {totals.balanced ? null : <p className="kit-hint">{t('books.bank.several.unbalanced')}</p>}
      <SubmitButton disabled={!totals.balanced}>{t('books.bank.match.save')}</SubmitButton>
    </>
  );
}

/** A match of several lines on either side (RC-210): the unmatched statement lines on screen, and the account's unmatched
 * book lines going the same way, within ten days of this line by default, a page at a time; their totals must agree. */
function MatchSeveral({ line, accountId, unmatched, headingId, onDone }: {
  line: Line; accountId: string; unmatched: readonly Line[]; headingId: string; onDone: () => void;
}) {
  const book = useApiList(listBookLinesContract, { id: accountId, filter: { direction: line.direction, from: addDays(line.valueDate, -10),
    to: addDays(line.valueDate, 10) } });
  const match = useApiMutation(matchLinesContract, { invalidates: [listStatementLinesContract, listMatchCandidatesContract, listStatementImportsContract,
    listBookLinesContract] });
  if (book.error !== null) return <p role="alert" className="kit-form-alert">{t('error.title')}</p>;
  if (book.isPending) return <p>{t('loading')}</p>;
  return (
    <Form aria-labelledby={headingId} schema={severalSchema} defaultValues={{ statementLineIds: [line.id], journalLineIds: [] }} saved={false}
      messages={MATCH_MESSAGES}
      onSubmit={async (v) => {
        await match.submit(v);
        onDone();
        setTimeout(() => announce(t('books.bank.match.done')), 0);
      }}>
      <CheckboxesField name="statementLineIds" label={t('books.bank.several.statement')}
        options={unmatched.map((l) => ({ value: l.id, label: `${formatDate(l.valueDate)}, ${l.narration}: ${t(l.direction === 'in' ? 'books.bank.several.in'
          : 'books.bank.several.out', { amount: formatMoney(l.amount) })}` }))} />
      {book.items.length === 0 ? <p>{t('books.bank.several.noBook')}</p> : (
        <CheckboxesField name="journalLineIds" label={t('books.bank.several.book')} hint={t('books.bank.several.book.hint')}
          options={book.items.map((b) => ({ value: b.journalLineId, label: bookLineLabel(b) }))} />
      )}
      {book.hasNextPage ? (
        <button type="button" className="kit-button" disabled={book.isFetchingNextPage} onClick={book.fetchNextPage}>{t('books.bank.several.more')}</button>
      ) : null}
      <SeveralTotals statement={unmatched} book={book.items} />
    </Form>
  );
}

/** Matches a statement line: to one of the book lines the server offers for it (same amount, nearby, best first), or, to
 * pick several on either side, by hand. */
function MatchPanel({ line, accountId, unmatched, onClose }: { line: Line; accountId: string; unmatched: readonly Line[]; onClose: () => void }) {
  const [several, setSeveral] = useState(false);
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const q = useApiQuery(listMatchCandidatesContract, { id: line.id });
  const match = useApiMutation(matchLinesContract, { invalidates: [listStatementLinesContract, listMatchCandidatesContract, listStatementImportsContract] });
  // The panel opens below the table, so focus goes to its heading.
  useEffect(() => { heading.current?.focus(); }, []);
  const title = t('books.bank.match.title', lineWords(line));
  const body = several ? <MatchSeveral line={line} accountId={accountId} unmatched={unmatched} headingId={headingId} onDone={onClose} />
    : q.error !== null ? <p role="alert" className="kit-form-alert">{t('error.title')}</p>
    : q.data === undefined ? <p>{t('loading')}</p>
    : q.data.candidates.length === 0 ? <p>{t('books.bank.match.none')}</p>
    : (
      <Form aria-labelledby={headingId} schema={pickSchema} defaultValues={{ journalLineId: q.data.candidates[0]?.journalLineId ?? '' }}
        saved={false} messages={MATCH_MESSAGES}
        onSubmit={async (v) => {
          await match.submit({ statementLineIds: [line.id], journalLineIds: [v.journalLineId] });
          onClose();
          setTimeout(() => announce(t('books.bank.match.done')), 0);
        }}>
        <RadioField name="journalLineId" label={t('books.bank.match.pick')}
          options={q.data.candidates.map((c) => ({ value: c.journalLineId, label: candidateLabel(c) }))} />
        <SubmitButton>{t('books.bank.match.save')}</SubmitButton>
      </Form>
    );
  return (
    <section aria-labelledby={headingId}>
      <h3 id={headingId} ref={heading} tabIndex={-1}>{title}</h3>
      <p>{t(several ? 'books.bank.several.intro' : 'books.bank.match.intro')}</p>
      <div className="admin-toolbar">
        <ChoiceButtons label={t('books.bank.match.how')} value={several ? 'several' : 'suggested'} onChange={(v) => setSeveral(v === 'several')}
          options={[{ value: 'suggested', label: t('books.bank.match.suggested') }, { value: 'several', label: t('books.bank.match.several') }]} />
      </div>
      {body}
      <div className="kit-actions">
        <button type="button" className="kit-button" onClick={onClose}>{t('books.bank.match.close')}</button>
      </div>
    </section>
  );
}

/** The account's statement lines, each matched or not; under bank:reconcile, Match an unmatched one, Unmatch a matched one. */
export function StatementLines({ accountId, mayMatch }: { accountId: string; mayMatch: boolean }) {
  const lines = useApiList(listStatementLinesContract, { filter: { accountId } });
  const unmatch = useApiMutation(unmatchContract, { invalidates: [listStatementLinesContract, listMatchCandidatesContract, listStatementImportsContract] });
  const [matching, setMatching] = useState<Line | null>(null);
  const [unmatching, setUnmatching] = useState<Line | null>(null);
  const tableHeading = useRef<HTMLHeadingElement>(null);
  // Matching or unmatching swaps the row's button, so focus goes back to the table's heading, not the body.
  const backToTable = () => setTimeout(() => tableHeading.current?.focus(), 0);
  const columns: Column<Line>[] = [
    { id: 'date', header: t('books.bank.col.date'), cell: (l) => formatDate(l.valueDate) },
    { id: 'narration', header: t('books.bank.col.narration'), cell: (l) => l.narration },
    { id: 'reference', header: t('books.bank.col.reference'), cell: (l) => l.reference },
    { id: 'out', header: t('books.bank.col.out'), numeric: true, cell: (l) => (l.direction === 'out' ? formatMoney(l.amount) : '') },
    { id: 'in', header: t('books.bank.col.in'), numeric: true, cell: (l) => (l.direction === 'in' ? formatMoney(l.amount) : '') },
    { id: 'balance', header: t('books.bank.col.balance'), numeric: true, cell: (l) => formatMoney(l.balance) },
    { id: 'match', header: t('books.bank.col.match'), cell: (l) => (
      <>
        {l.matchId === null ? null : <span>{t('books.bank.matched')} </span>}
        {!mayMatch ? null : l.matchId === null ? (
          <button key="match" type="button" className="kit-button" aria-pressed={matching?.id === l.id} onClick={() => setMatching(l)}
            aria-label={t('books.bank.match.for', lineWords(l))}>{t('books.bank.match')}</button>
        ) : (
          <button key="unmatch" type="button" className="kit-button" onClick={() => setUnmatching(l)} aria-label={t('books.bank.unmatch.for', lineWords(l))}>
            {t('books.bank.unmatch')}
          </button>
        )}
      </>
    ) },
  ];
  return (
    <>
      <h2 ref={tableHeading} tabIndex={-1}>{t('books.bank.lines')}</h2>
      <DataTable caption={t('books.bank.lines')} columns={columns} rowKey={(l) => l.id} list={lines} empty={t('books.bank.lines.empty')} />
      {matching === null ? null : <MatchPanel key={matching.id} line={matching} accountId={accountId} unmatched={lines.items.filter((x) => x.matchId === null)} onClose={() => { setMatching(null); backToTable(); }} />}
      <ReasonDialog open={unmatching !== null} onOpenChange={(open) => { if (!open) setUnmatching(null); }} messages={MATCH_MESSAGES}
        title={t('books.bank.unmatch.title')} action={t('books.bank.unmatch')} done={t('books.bank.unmatched')}
        onConfirm={async (reason) => {
          const matchId = unmatching?.matchId;
          if (matchId === null || matchId === undefined) return;
          await unmatch.submit({ id: matchId, reason });
          backToTable();
        }} />
    </>
  );
}
