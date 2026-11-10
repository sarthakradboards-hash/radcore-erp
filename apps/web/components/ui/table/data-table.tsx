'use client';
// The one list table (M1-44): pages come from the server over the `{ items, next }` envelope, and so does the order.
// Pass it `useApiList(...)` as `list`. There is no total and no last page to jump to (RC-176); "Show more" works until
// the server says there is no next page, so no list stops at a fixed size (RC-086).
import { rowSortingFeature, tableFeatures, useTable, type ColumnDef, type RowData, type SortingState } from '@tanstack/react-table';
import { useId, useMemo, type ReactNode } from 'react';
import '../form/form.css'; // .kit-button
import './table.css';
import { t } from '../../../lib/i18n/index.ts';

const features = tableFeatures({ rowSortingFeature });

export type Column<T> = {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** The server can order the list by this column. */
  sortable?: boolean;
  /** Right-aligned, for amounts and counts. */
  numeric?: boolean;
};

/** The order the list is asked for. The screen puts it in the list's params, so a change starts from page one. */
export type Sort = { column: string; desc: boolean };

/** What `useApiList` returns, or the part of it the table reads. */
type ListView<T> = {
  items: readonly T[];
  hasNextPage: boolean;
  fetchNextPage: () => void;
  isFetchingNextPage: boolean;
  isPending: boolean;
  error: Error | null;
  refetch: () => void;
};

type Props<T> = {
  caption: string;
  columns: readonly Column<T>[];
  rowKey: (row: T) => string;
  list: ListView<T>;
  sort?: Sort;
  onSortChange?: (sort: Sort) => void;
  /** Shown when the list has no rows. */
  empty?: string;
};

export function DataTable<T extends RowData>({ caption, columns, rowKey, list, sort, onSortChange, empty = t('kit.table.empty') }: Props<T>) {
  const captionId = useId();
  const defs = useMemo(() => columns.map((c): ColumnDef<typeof features, T> => ({
    id: c.id, header: c.header, accessorFn: () => null, enableSorting: c.sortable === true,
  })), [columns]);
  const sorting: SortingState = sort === undefined ? [] : [{ id: sort.column, desc: sort.desc }];
  const table = useTable({
    features, columns: defs, data: list.items as T[], getRowId: rowKey,
    // A first click orders ascending: TanStack would guess from the cell values, which the server owns here.
    manualSorting: true, enableMultiSort: false, enableSortingRemoval: false, sortDescFirst: false,
    state: { sorting },
    onSortingChange: (change) => {
      const [next] = typeof change === 'function' ? change(sorting) : change;
      if (next !== undefined) onSortChange?.({ column: next.id, desc: next.desc });
    },
  });
  const byId = new Map(columns.map((c) => [c.id, c]));

  return (
    <div className="kit-table">
      {/* Scrolls sideways on a narrow screen; focusable so a keyboard can scroll it too. */}
      <div className="kit-table-scroll" role="region" aria-labelledby={captionId} tabIndex={0}>
        <table>
          <caption id={captionId}>{caption}</caption>
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map(({ column }) => {
                  const col = byId.get(column.id);
                  const dir = column.getIsSorted();
                  return (
                    <th key={column.id} scope="col" className={col?.numeric === true ? 'kit-numeric' : undefined}
                      aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : undefined}>
                      {column.getCanSort() ? (
                        <button type="button" className="kit-sort" onClick={column.getToggleSortingHandler()}>
                          {col?.header}<span aria-hidden="true">{dir === 'asc' ? ' ▲' : dir === 'desc' ? ' ▼' : ' ↕'}</span>
                        </button>
                      ) : col?.header}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id}>
                {columns.map((c) => (
                  <td key={c.id} className={c.numeric === true ? 'kit-numeric' : undefined}>{c.cell(row.original)}</td>
                ))}
              </tr>
            ))}
            {list.items.length === 0 && list.error === null ? (
              <tr><td colSpan={columns.length}>{list.isPending ? t('loading') : empty}</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {list.error === null ? null : (
        <div role="alert" className="kit-form-alert kit-table-error">
          {t('kit.table.error')}{' '}
          <button type="button" className="kit-button" onClick={list.refetch}>{t('kit.table.retry')}</button>
        </div>
      )}
      <div className="kit-table-foot">
        <p role="status">{list.items.length === 0 ? '' : t('kit.table.shown', { count: String(list.items.length) })}</p>
        {list.hasNextPage ? (
          <button type="button" className="kit-button" onClick={list.fetchNextPage}
            disabled={list.isFetchingNextPage} aria-busy={list.isFetchingNextPage}>{t('kit.table.more')}</button>
        ) : null}
      </div>
    </div>
  );
}
