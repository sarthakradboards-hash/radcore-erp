// E6 lets through decimal helpers, labels and names that only end like a money word.
import { formatMoney, lineAmount, roundMoney, sum } from '@radcore/lib-common';

export const label = (total: string) => 'Total: ' + total + ` (${formatMoney(total)})`;
export const lines = (rows: { qty: string; rate: string }[]) => roundMoney(sum(rows.map((r) => lineAmount(r.qty, r.rate))));
export const pages = (generate: number, separate: number) => generate * separate - 1;
export const count = (items: string[], limit: number) => Math.min(items.length, limit) + 1;
