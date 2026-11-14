'use client';
// The tables and pickers part of the kit gallery (RAD-54). A local fake stands in for the API: 2,100 parties, ordered,
// searched and paged on the "server" side over the `{ items, next }` envelope, after a short delay. No request is made.
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { SearchBox } from '../../components/ui/form/search-box.tsx';
import { Picker } from '../../components/ui/picker/picker.tsx';
import { DataTable, type Column, type Sort } from '../../components/ui/table/data-table.tsx';
import { useSavedView } from '../../components/ui/table/saved-view.ts';
import { VIEWS, type View } from './views.ts';

type Party = { id: string; name: string; city: string; limit: string };
type Page = { items: Party[]; next: string | null };
type SortBy = 'name' | 'city' | 'limit';

const NAMES = ['Asha', 'Bharat', 'Chandra', 'Devi', 'Eknath', 'Farida', 'Gopal'];
const CITIES = ['Pune', 'Nagpur', 'Indore', 'Surat', 'Mysuru'];
const PARTIES: Party[] = Array.from({ length: 2100 }, (_, i) => {
  const n = i + 1;
  return { id: `p-${n}`, name: `${NAMES[n % NAMES.length]} Traders ${n}`, city: CITIES[n % CITIES.length] ?? '',
    limit: `${(n * 250) % 100000}.00` };
});

const wait = () => new Promise((resolve) => setTimeout(resolve, 150));

/** The fake list route: search (every word), order, then a page after the cursor (here, just a row index). */
async function listParties(o: { search?: string; sort?: Sort<SortBy>; after?: string; limit: number }): Promise<Page> {
  await wait();
  const words = (o.search ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const found = PARTIES.filter((p) => words.every((w) => `${p.name} ${p.city}`.toLowerCase().includes(w)));
  if (o.sort !== undefined) {
    const { column, desc } = o.sort;
    const key = (p: Party) => (column === 'city' ? p.city : column === 'limit' ? Number(p.limit) : p.name);
    found.sort((a, b) => {
      const x = key(a), y = key(b);
      const by = x < y ? -1 : x > y ? 1 : a.id.localeCompare(b.id);
      return desc ? -by : by;
    });
  }
  const start = Number(o.after ?? 0);
  const end = start + o.limit;
  return { items: found.slice(start, end), next: end < found.length ? String(end) : null };
}

const COLUMNS: Column<Party, SortBy>[] = [
  { id: 'name', header: 'Name', cell: (p) => p.name, sortable: true },
  { id: 'city', header: 'City', cell: (p) => p.city, sortable: true },
  { id: 'limit', header: 'Credit limit (₹)', cell: (p) => p.limit, sortable: true, numeric: true },
];

export function Lists({ initialView }: { initialView: View }) {
  const [view, setView] = useSavedView<View>('kit', initialView);
  const [fetched, setFetched] = useState<string[]>([]);
  const [sort, setSort] = useState<Sort<SortBy>>({ column: 'name', desc: false });

  const list = useInfiniteQuery({
    queryKey: ['kit', 'parties', sort],
    queryFn: async ({ pageParam }) => {
      if (pageParam === undefined) setFetched((f) => [...f, 'list']);
      return listParties({ sort, limit: 50, ...(pageParam === undefined ? {} : { after: pageParam }) });
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.next ?? undefined,
    enabled: view === 'list',
  });
  const board = useQuery({
    queryKey: ['kit', 'board'],
    queryFn: async () => { setFetched((f) => [...f, 'board']); return listParties({ limit: 12 }); },
    enabled: view === 'board',
  });

  const [searched, setSearched] = useState('');
  const [query, setQuery] = useState('');
  const [party, setParty] = useState<Party | null>(null);
  const found = useQuery({
    queryKey: ['kit', 'search', query.trim()],
    queryFn: () => listParties({ search: query.trim(), limit: 20 }),
    enabled: query.trim() !== '',
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <h2>Lists</h2>
      <p>2,100 parties, ordered and paged by the fake server. The view choice is saved and read before the first draw.</p>
      <div role="group" aria-label="View" className="kit-actions">
        {VIEWS.map((v) => (
          <button key={v} type="button" className="kit-button" aria-pressed={view === v} onClick={() => setView(v)}>
            {v === 'list' ? 'List' : 'Board'}
          </button>
        ))}
      </div>
      <p>Fetched: <output aria-label="Fetched">{fetched.join(', ')}</output></p>
      {view === 'list' ? (
        <DataTable caption="Parties" columns={COLUMNS} rowKey={(p) => p.id} sort={sort} onSortChange={setSort}
          list={{
            items: list.data?.pages.flatMap((p) => p.items) ?? [],
            hasNextPage: list.hasNextPage,
            fetchNextPage: () => void list.fetchNextPage(),
            isFetchingNextPage: list.isFetchingNextPage,
            isPending: list.isPending,
            error: list.error,
            refetch: () => void list.refetch(),
          }} />
      ) : (
        <ul aria-label="Parties board">
          {(board.data?.items ?? []).map((p) => <li key={p.id}>{p.name}<br />{p.city}</li>)}
        </ul>
      )}

      <h2>Search</h2>
      <p>Applies on Show. Text typed before the scripts load is kept.</p>
      <SearchBox label="Search parties" action="Show" onSearch={setSearched} />
      <p>Searched: <output aria-label="Searched">{searched}</output></p>

      <h2>Pickers</h2>
      <p>Type part of a name or number (try 2050). Arrow keys only move the highlight; Enter or a click chooses.</p>
      <Picker label="Party" hint="Searches all 2,100 parties." query={query} onQueryChange={setQuery}
        options={query.trim() === '' ? [] : found.data?.items ?? []} loading={found.isFetching} error={found.error}
        value={party} onChange={setParty} optionKey={(p) => p.id} optionLabel={(p) => p.name}
        optionDetail={(p) => p.city} />
      <p>Chosen: <output aria-label="Chosen">{party?.name ?? ''}</output></p>
    </>
  );
}
