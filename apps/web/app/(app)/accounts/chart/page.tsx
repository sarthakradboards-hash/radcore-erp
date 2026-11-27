'use client';
// The chart of accounts (RAD-100 on RAD-86's routes): every account, by type, with the account it sits under. A control
// account (receivables, payables, stock, GST) is posted only by its documents, never by a manual journal (M2-03); the
// screen says which they are, and the manual journal doesn't offer them.
import { createAccount, listAccounts } from '@radcore/lib-accounts/contract';
import { ACCOUNT_TYPES } from '@radcore/lib-common';
import { useId, useState } from 'react';
import { useMe } from '../../../../components/shell/session-provider.tsx';
import { CloseButton, Dialog } from '../../../../components/ui/dialog/dialog.tsx';
import { SelectField, TextField } from '../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../components/ui/form/form.tsx';
import { announce } from '../../../../components/ui/live-region.tsx';
import { useApiMutation, useApiQuery } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import '../../../../components/ui/table/table.css';
import type { Account } from '../shared.tsx';
import { accountSchema, blankAccount, groups } from './account-values.ts';

const ADD_CODES = ['parent_not_group', 'duplicate_account', 'code_taken', 'system_account_insert'] as const;
const ADD_MESSAGES: Partial<Record<string, string>> = Object.fromEntries(ADD_CODES.map((c) => [c, t(`books.chart.err.${c}`)]));

/** Adds an ordinary account under a group (POST /accounts, accounts:write); it takes the group's type. */
function AddAccount({ accounts, onDone }: { accounts: readonly Account[]; onDone: () => void }) {
  const add = useApiMutation(createAccount, { invalidates: [listAccounts] });
  const options = groups(accounts).map((a) => ({ value: a.id, label: `${a.name} (${t(`books.type.${a.type}`)})` }));
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onDone(); }} title={t('books.chart.add.title')} description={t('books.chart.add.body')}>
      <Form schema={accountSchema} defaultValues={blankAccount} saved={false} messages={ADD_MESSAGES}
        onSubmit={async (v) => {
          await add.submit(v);
          onDone();
          setTimeout(() => announce(t('books.chart.add.done', { name: v.name })), 0);
        }}>
        <TextField name="name" label={t('books.chart.add.name')} autoComplete="off" />
        <SelectField name="parentId" label={t('books.chart.add.parent')} placeholder={t('books.chart.add.parent.pick')} options={options} />
        <TextField name="code" label={t('books.chart.add.code')} hint={t('books.chart.add.code.hint')} autoComplete="off" />
        <div className="kit-actions">
          <CloseButton>{t('books.chart.add.keep')}</CloseButton>
          <SubmitButton>{t('books.chart.add.save')}</SubmitButton>
        </div>
      </Form>
    </Dialog>
  );
}

function TypeTable({ type, accounts, nameOf }: { type: Account['type']; accounts: Account[]; nameOf: (id: string) => string }) {
  const captionId = useId();
  return (
    <div className="kit-table">
      <div className="kit-table-scroll" role="region" aria-labelledby={captionId} tabIndex={0}>
        <table>
          <caption id={captionId}>{t(`books.type.${type}`)}</caption>
          <thead>
            <tr>
              <th scope="col">{t('books.chart.name')}</th>
              <th scope="col">{t('books.chart.under')}</th>
              <th scope="col">{t('books.chart.posting')}</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id}>
                <td>{a.name}</td>
                <td>{a.parentId === null ? '' : nameOf(a.parentId)}</td>
                <td>{t(a.control ? 'books.chart.control' : 'books.chart.manual')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function ChartPage() {
  const { permissions } = useMe();
  const mayRead = permissions.includes('journal:read');
  const q = useApiQuery(listAccounts, {}, { enabled: mayRead });
  const [adding, setAdding] = useState(false);
  const accounts = q.data?.items;
  if (!mayRead) return <><h1>{t('books.chart.title')}</h1><p>{t('books.chart.none')}</p></>;
  if (q.error !== null) return <p role="alert" className="kit-form-alert">{t('error.title')}</p>;
  if (accounts === undefined) return <p>{t('loading')}</p>;
  const nameOf = (id: string) => accounts.find((a) => a.id === id)?.name ?? '';
  return (
    <>
      <h1>{t('books.chart.title')}</h1>
      <p>{t('books.chart.intro')}</p>
      {permissions.includes('accounts:write') ? (
        <div className="kit-actions">
          <button type="button" className="kit-button kit-button-primary" onClick={() => setAdding(true)}>{t('books.chart.add')}</button>
        </div>
      ) : null}
      {adding ? <AddAccount accounts={accounts} onDone={() => setAdding(false)} /> : null}
      {ACCOUNT_TYPES.map((type) => {
        const ofType = accounts.filter((a) => a.type === type);
        return ofType.length === 0 ? null : <TypeTable key={type} type={type} accounts={ofType} nameOf={nameOf} />;
      })}
    </>
  );
}
