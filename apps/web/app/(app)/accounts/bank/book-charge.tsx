'use client';
// Booking a statement line as a bank charge (money out) or interest (money in) the books don't have (RAD-168 on RAD-165's
// #461; ADR-009 §12, RC-210): the person picks the account, and the server posts the entry on the line's date and matches
// it in one save. The chart is journal:read's, so without it nothing can be picked. Unmatching reverses it.
import {
  bookChargeContract, listAccounts, listBookLinesContract, listMatchCandidatesContract, listStatementImportsContract, listStatementLinesContract,
} from '@radcore/lib-accounts/contract';
import { z } from 'zod';
import { useMe } from '../../../../components/shell/session-provider.tsx';
import { SelectField } from '../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../components/ui/form/form.tsx';
import { announce } from '../../../../components/ui/live-region.tsx';
import { useApiMutation, useApiQuery } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { CHARGE_MESSAGES, chargeAccounts } from './match-values.ts';

const schema = z.object({ accountId: z.string().min(1, t('books.bank.charge.err.account')) });

export function BookCharge({ line, headingId, onDone }: { line: { id: string; direction: 'in' | 'out' }; headingId: string; onDone: () => void }) {
  const mayRead = useMe().permissions.includes('journal:read');
  const chart = useApiQuery(listAccounts, {}, { enabled: mayRead });
  const book = useApiMutation(bookChargeContract, { invalidates: [listStatementLinesContract, listMatchCandidatesContract, listStatementImportsContract,
    listBookLinesContract] });
  if (!mayRead) return <p>{t('books.bank.charge.none')}</p>;
  if (chart.error !== null) return <p role="alert" className="kit-form-alert">{t('error.title')}</p>;
  if (chart.data === undefined) return <p>{t('loading')}</p>;
  const accounts = chargeAccounts(chart.data.items, line.direction);
  if (accounts.length === 0) return <p>{t(`books.bank.charge.noAccount.${line.direction}`)}</p>;
  return (
    <Form aria-labelledby={headingId} schema={schema} defaultValues={{ accountId: '' }} saved={false} messages={CHARGE_MESSAGES}
      onSubmit={async ({ accountId }) => {
        const { entry } = await book.submit({ id: line.id, accountId });
        onDone();
        setTimeout(() => announce(t('books.bank.charge.done', { number: entry })), 0);
      }}>
      <SelectField name="accountId" label={t(`books.bank.charge.account.${line.direction}`)} placeholder={t('books.bank.charge.choose')}
        options={accounts.map((a) => ({ value: a.id, label: a.code === null ? a.name : `${a.code} ${a.name}` }))} />
      <SubmitButton>{t('books.bank.charge.save')}</SubmitButton>
    </Form>
  );
}
