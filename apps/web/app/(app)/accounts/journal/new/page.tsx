'use client';
// A manual journal (RAD-100 on RAD-86's routes): a business date, the reason it's made, and two lines or more, each one
// account with a debit or a credit. Control accounts are posted only by their documents (M2-03), so they aren't offered,
// and the screen names them. The running totals are shown; whether they balance, whether the day's period is locked
// and whether its year is open are the server's to say (journal:post, with the second factor).
import { dateString, formatMoney, indiaDate, moneyString, reason, sum } from '@radcore/lib-common';
import { listAccounts, listJournal, postJournal } from '@radcore/lib-accounts/contract';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFieldArray, useFormContext, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { SelectField, TextAreaField, TextField } from '../../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../../components/ui/form/form.tsx';
import { announce } from '../../../../../components/ui/live-region.tsx';
import { useApiMutation, useApiQuery } from '../../../../../lib/api/query.ts';
import { t } from '../../../../../lib/i18n/index.ts';
import { JOURNAL_MESSAGES, type Account } from '../../shared.tsx';

const isMoney = (s: string) => moneyString().safeParse(s).success;
const amount = z.string().trim().refine((s) => s === '' || isMoney(s), t('books.new.err.amount'));
// Each line is one side: a debit or a credit, not both and not neither.
const line = z.object({ accountId: z.string().min(1, t('books.new.err.account')), debit: amount, credit: amount })
  .transform((l, ctx) => {
    if ((l.debit === '') === (l.credit === '')) {
      ctx.addIssue({ code: 'custom', message: t('books.new.err.side'), path: ['debit'] });
      return z.NEVER;
    }
    return l.debit === '' ? { accountId: l.accountId, credit: l.credit } : { accountId: l.accountId, debit: l.debit };
  });
const schema = z.object({ businessDate: dateString(), reason: reason(), lines: z.array(line).min(2) });
type Values = z.input<typeof schema>;
const blank = { accountId: '', debit: '', credit: '' };

/** The sum of the amounts typed so far that are amounts; a box still being typed in counts as nothing. */
const total = (xs: readonly string[]) => sum(xs.map((s) => s.trim()).filter(isMoney));

function Totals() {
  const lines = useWatch<Values, 'lines'>({ name: 'lines' });
  const debits = total(lines.map((l) => l.debit));
  const credits = total(lines.map((l) => l.credit));
  const off = debits.minus(credits).abs();
  return (
    <p>
      {t('books.new.totals', { debits: formatMoney(debits), credits: formatMoney(credits) })}{' '}
      {off.isZero() ? null : t('books.new.off', { by: formatMoney(off) })}
    </p>
  );
}

function Lines({ accounts }: { accounts: Account[] }) {
  const { control } = useFormContext<Values>();
  const { fields, append, remove } = useFieldArray({ control, name: 'lines' });
  const options = accounts.filter((a) => !a.control).map((a) => ({ value: a.id, label: a.name }));
  return (
    <>
      {fields.map((f, i) => (
        <fieldset key={f.id}>
          <legend>{t('books.new.line', { n: String(i + 1) })}</legend>
          <SelectField name={`lines.${i}.accountId`} label={t('books.entry.account')} placeholder={t('books.new.pick')} options={options} />
          <TextField name={`lines.${i}.debit`} label={t('books.entry.debit')} inputMode="decimal" autoComplete="off" />
          <TextField name={`lines.${i}.credit`} label={t('books.entry.credit')} inputMode="decimal" autoComplete="off" />
          {fields.length > 2 ? (
            <button type="button" className="kit-button" onClick={() => remove(i)}>{t('books.new.remove', { n: String(i + 1) })}</button>
          ) : null}
        </fieldset>
      ))}
      <button type="button" className="kit-button" onClick={() => append(blank)}>{t('books.new.add')}</button>
      <Totals />
    </>
  );
}

export default function NewJournalPage() {
  const router = useRouter();
  const q = useApiQuery(listAccounts, {});
  const post = useApiMutation(postJournal, { invalidates: [listJournal] });
  const accounts = q.data?.items;
  if (q.error !== null) return <p role="alert" className="kit-form-alert">{t('error.title')}</p>;
  if (accounts === undefined) return <p>{t('loading')}</p>;
  const control = accounts.filter((a) => a.control).map((a) => a.name);

  return (
    <>
      <p><Link href="/accounts/journal">{t('books.entry.back')}</Link></p>
      <h1 id="new-journal">{t('books.new.title')}</h1>
      <p>{t('books.new.intro')}</p>
      {control.length === 0 ? null : <p>{t('books.new.control', { names: control.join(', ') })}</p>}
      <Form aria-labelledby="new-journal" schema={schema} saved={false} messages={JOURNAL_MESSAGES}
        defaultValues={{ businessDate: indiaDate(new Date()), reason: '', lines: [blank, blank] }}
        onSubmit={async (v) => {
          const done = await post.submit(v);
          setTimeout(() => announce(t('books.new.posted', { number: done.number })), 0);
          router.push(`/accounts/journal/${done.id}`);
        }}>
        <TextField name="businessDate" label={t('books.journal.date')} type="date" />
        <TextAreaField name="reason" label={t('books.reason')} hint={t('books.new.reason.hint')} />
        <Lines accounts={accounts} />
        <SubmitButton>{t('books.new.post')}</SubmitButton>
      </Form>
    </>
  );
}

