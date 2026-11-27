'use client';
// Expense categories (RAD-168 on RAD-152's routes; ADR-009 §2, §3): each category's input-credit rule and the expense
// accounts it may post to. Read under journal:read, like the chart; added, edited and switched off or on under
// accounts:write, each change with a reason. A new one starts blocked, ADR-009 §2's strict default. The server checks the
// accounts (and the database holds them to ordinary expense accounts); the screen only offers those.
import { createExpenseCategory, listAccounts, listExpenseCategories, setExpenseCategory } from '@radcore/lib-accounts/contract';
import { useId, useMemo, useState } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import type { z } from 'zod';
import { CloseButton, Dialog } from '../../../../components/ui/dialog/dialog.tsx';
import { ReasonDialog } from '../../../../components/ui/dialog/reason-dialog.tsx';
import { CheckboxesField, RadioField, SelectField, TextAreaField, TextField } from '../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../components/ui/form/form.tsx';
import { announce } from '../../../../components/ui/live-region.tsx';
import { useMe } from '../../../../components/shell/session-provider.tsx';
import { useApiMutation, useApiQuery } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import '../../../../components/ui/table/table.css';
import { blankCategory, CLAUSES, createSchema, editSchema, expenseAccounts, type CategoryValues } from './categories.ts';

type Category = z.output<typeof listExpenseCategories.output>['items'][number];
type Choice = { value: string; label: string };

const MESSAGES: Partial<Record<string, string>> = {
  name_taken: t('books.categories.err.name_taken'),
  not_an_expense_account: t('books.categories.err.not_an_expense_account'),
};
const refresh = [listExpenseCategories];
const clauseOptions = CLAUSES.map((c) => ({ value: c, label: `17(5)${c}` }));

/** The fields a new and an edited category share; the clause only while its credit is blocked. */
function CategoryFields({ accounts }: { accounts: readonly Choice[] }) {
  const { control } = useFormContext<CategoryValues>();
  const credit = useWatch({ control, name: 'credit' });
  return (
    <>
      <TextField name="name" label={t('books.categories.name')} />
      <RadioField name="credit" label={t('books.categories.credit')} options={[
        { value: 'blocked', label: t('books.categories.credit.blocked') },
        { value: 'allowed', label: t('books.categories.credit.allowed') },
      ]} />
      {credit === 'blocked'
        ? <SelectField name="blockedClause" label={t('books.categories.clause')} placeholder={t('books.categories.clause.pick')} options={clauseOptions} />
        : null}
      {accounts.length === 0 ? <p role="alert" className="kit-form-alert">{t('books.categories.accounts.none')}</p> : (
        <CheckboxesField name="accountIds" label={t('books.categories.accounts')} hint={t('books.categories.accounts.hint')} options={accounts} />
      )}
    </>
  );
}

function AddDialog({ accounts, onDone }: { accounts: readonly Choice[]; onDone: () => void }) {
  const add = useApiMutation(createExpenseCategory, { invalidates: refresh });
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onDone(); }} title={t('books.categories.add.title')}>
      <Form schema={createSchema} defaultValues={blankCategory} saved={false} messages={MESSAGES}
        onSubmit={async (v) => {
          await add.submit(v);
          onDone();
          setTimeout(() => announce(t('books.categories.add.done', { name: v.name })), 0);
        }}>
        <CategoryFields accounts={accounts} />
        <div className="kit-actions">
          <CloseButton>{t('books.categories.keep')}</CloseButton>
          <SubmitButton>{t('books.categories.add')}</SubmitButton>
        </div>
      </Form>
    </Dialog>
  );
}

function EditDialog({ category, accounts, onDone }: { category: Category; accounts: readonly Choice[]; onDone: () => void }) {
  const save = useApiMutation(setExpenseCategory, { invalidates: refresh });
  const schema = useMemo(() => editSchema(category.id), [category.id]);
  // An account the category posts to but the chart no longer offers (switched off since) stays ticked and is marked, so it's
  // seen and can be unticked; saving with it ticked is refused (auditor-3 on #430).
  const offered = [...accounts, ...category.accounts.filter((a) => !accounts.some((o) => o.value === a.id))
    .map((a) => ({ value: a.id, label: t('books.categories.accounts.off', { name: a.name }) }))];
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onDone(); }} title={t('books.categories.edit.title', { name: category.name })}>
      <Form schema={schema} saved={false} messages={MESSAGES}
        defaultValues={{ name: category.name, credit: category.credit, blockedClause: category.blockedClause ?? '',
          accountIds: category.accounts.map((a) => a.id), reason: '' }}
        onSubmit={async (v) => {
          await save.submit(v);
          onDone();
          setTimeout(() => announce(t('books.categories.edit.done', { name: v.name ?? category.name })), 0);
        }}>
        <CategoryFields accounts={offered} />
        <TextAreaField name="reason" label={t('books.reason')} />
        <div className="kit-actions">
          <CloseButton>{t('books.categories.keep')}</CloseButton>
          <SubmitButton>{t('books.categories.save')}</SubmitButton>
        </div>
      </Form>
    </Dialog>
  );
}

function Table({ categories, accounts, mayWrite }: { categories: readonly Category[]; accounts: readonly Choice[]; mayWrite: boolean }) {
  const captionId = useId();
  const [acting, setActing] = useState<{ category: Category; action: 'edit' | 'switch' } | null>(null);
  const flip = useApiMutation(setExpenseCategory, { invalidates: refresh });
  const done = () => setActing(null);
  if (categories.length === 0) return <p>{t('books.categories.empty')}</p>;
  const c = acting?.category;
  return (
    <div className="kit-table">
      <div className="kit-table-scroll" role="region" aria-labelledby={captionId} tabIndex={0}>
        <table>
          <caption id={captionId}>{t('books.categories.title')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('books.categories.col.name')}</th>
              <th scope="col">{t('books.categories.col.credit')}</th>
              <th scope="col">{t('books.categories.col.accounts')}</th>
              <th scope="col">{t('books.categories.col.status')}</th>
              {mayWrite ? <th scope="col">{t('books.categories.col.actions')}</th> : null}
            </tr>
          </thead>
          <tbody>
            {categories.map((r) => (
              <tr key={r.id}>
                <th scope="row">{r.name}</th>
                <td>{r.credit === 'allowed' ? t('books.categories.allowed') : t('books.categories.blocked', { clause: r.blockedClause ?? '' })}</td>
                <td>{r.accounts.map((a) => a.name).join(', ')}</td>
                <td>{r.active ? t('books.categories.on') : t('books.categories.off')}</td>
                {mayWrite ? (
                  <td>
                    <div className="kit-actions">
                      <button type="button" className="kit-button" onClick={() => setActing({ category: r, action: 'edit' })}>
                        {t('books.categories.edit', { name: r.name })}
                      </button>
                      <button type="button" className="kit-button" onClick={() => setActing({ category: r, action: 'switch' })}>
                        {t(r.active ? 'books.categories.switchOff' : 'books.categories.switchOn', { name: r.name })}
                      </button>
                    </div>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {c !== undefined && acting?.action === 'edit' ? <EditDialog key={c.id} category={c} accounts={accounts} onDone={done} /> : null}
      <ReasonDialog open={c !== undefined && acting?.action === 'switch'} onOpenChange={(open) => { if (!open) done(); }} messages={MESSAGES}
        title={c === undefined ? '' : t(c.active ? 'books.categories.switchOff.title' : 'books.categories.switchOn.title', { name: c.name })}
        action={c === undefined ? '' : t(c.active ? 'books.categories.switchOff' : 'books.categories.switchOn', { name: c.name })}
        done={c === undefined ? '' : t(c.active ? 'books.categories.switchOff.done' : 'books.categories.switchOn.done', { name: c.name })}
        onConfirm={async (reason) => { if (c !== undefined) await flip.submit({ id: c.id, active: !c.active, reason }); }} />
    </div>
  );
}

export default function ExpenseCategoriesPage() {
  const { permissions } = useMe();
  // The keys the two reads need, from their contracts, so a change to either reaches the screen.
  const mayRead = [listExpenseCategories.perm, listAccounts.perm].every((p) => p === null || permissions.includes(p));
  const mayWrite = permissions.includes('accounts:write');
  const list = useApiQuery(listExpenseCategories, {}, { enabled: mayRead });
  const chart = useApiQuery(listAccounts, {}, { enabled: mayRead });
  const [adding, setAdding] = useState(false);
  const accounts = useMemo(() => expenseAccounts(chart.data?.items ?? []).map((a) => ({ value: a.id, label: a.name })), [chart.data]);
  const failed = list.error ?? chart.error;
  return (
    <>
      <h1>{t('books.categories.title')}</h1>
      <p>{t('books.categories.intro')}</p>
      {!mayRead ? <p>{t('books.categories.none')}</p> : failed !== null ? (
        <div role="alert" className="kit-form-alert">
          {t('error.title')}{' '}
          <button type="button" className="kit-button" onClick={() => { void list.refetch(); void chart.refetch(); }}>{t('error.retry')}</button>
        </div>
      ) : list.data === undefined || chart.data === undefined ? <p>{t('loading')}</p> : (
        <>
          {mayWrite ? (
            <div className="kit-actions">
              <button type="button" className="kit-button kit-button-primary" onClick={() => setAdding(true)}>{t('books.categories.add')}</button>
            </div>
          ) : null}
          <Table categories={list.data.items} accounts={accounts} mayWrite={mayWrite} />
          {adding ? <AddDialog accounts={accounts} onDone={() => setAdding(false)} /> : null}
        </>
      )}
    </>
  );
}
