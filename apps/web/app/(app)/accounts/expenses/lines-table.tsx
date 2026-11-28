'use client';
// An expense's lines as the bill prints them: what each is for, its taxable value and tax by head, and, once posted, the
// input credit claimed (or why none) and any tax that's ours to pay under reverse charge. The same table on the expense's
// page and on its cash approval, where the lines are the approval's own version.
import { formatMoney, formatNumber } from '@radcore/lib-common';
import { listExpenseCategories } from '@radcore/lib-accounts/contract';
import { useId } from 'react';
import '../../../../components/ui/table/table.css';
import { useApiQuery } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import { creditWords, lineName, taxOf, type Line } from './expense-values.ts';

type Shown = Pick<Line, 'categoryId' | 'accountId' | 'taxable' | 'cgst' | 'sgst' | 'igst'> & Partial<Pick<Line, 'description' | 'credit' | 'reverseCharge'>>;

export function LinesTable({ caption, lines, posted = false }: { caption: string; lines: readonly Shown[]; posted?: boolean }) {
  const captionId = useId();
  const categories = useApiQuery(listExpenseCategories, {});
  const reverse = lines.some((l) => l.reverseCharge != null);
  const amounts = ['taxable', 'cgst', 'sgst', 'igst'] as const;
  return (
    <div className="kit-table">
      <div className="kit-table-scroll" role="region" aria-labelledby={captionId} tabIndex={0}>
        <table>
          <caption id={captionId}>{caption}</caption>
          <thead>
            <tr>
              <th scope="col">{t('books.expense.line.for')}</th>
              {amounts.map((a) => <th key={a} scope="col" className="kit-numeric">{t(`books.expense.line.${a}`)}</th>)}
              {posted ? <th scope="col">{t('books.expense.line.credit')}</th> : null}
              {reverse ? <th scope="col" className="kit-numeric">{t('books.expense.line.reverse')}</th> : null}
            </tr>
          </thead>
          <tbody>
            {lines.map((l, n) => (
              <tr key={n}>
                <td>{categories.data === undefined ? t(categories.error === null ? 'loading' : 'books.expense.unnamed') : lineName(categories.data.items, l)}
                  {l.description == null ? '' : ` (${l.description})`}</td>
                {amounts.map((a) => <td key={a} className="kit-numeric">{formatNumber(l[a], 2)}</td>)}
                {posted ? <td>{creditWords(l.credit ?? null)}</td> : null}
                {reverse ? <td className="kit-numeric">{l.reverseCharge == null ? '' : formatMoney(taxOf(l.reverseCharge))}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
