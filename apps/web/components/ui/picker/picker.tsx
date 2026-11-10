'use client';
// The one picker (M1-44): a combobox over server search, on cmdk. The server finds the matches, so any record can be
// picked by typing however long the list is (RC-086); the picker never filters on its own. Arrow keys only move the
// highlight, and a choice is made only by Enter or a click (RC-148).
//
//   const [query, setQuery] = useState('');
//   const found = useApiSearch(listParties, query);
//   <Picker label="Party" query={query} onQueryChange={setQuery} options={found.items} loading={found.isFetching}
//     error={found.error} value={party} onChange={setParty} optionKey={(p) => p.id} optionLabel={(p) => p.name} />
import { Command } from 'cmdk';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import '../form/form.css'; // .kit-field
import './picker.css';

type Props<T> = {
  label: string;
  hint?: string;
  value: T | null;
  onChange: (value: T) => void;
  /** The search text, sent as `filter.search` by useApiSearch. */
  query: string;
  onQueryChange: (text: string) => void;
  options: readonly T[];
  optionKey: (option: T) => string;
  optionLabel: (option: T) => string;
  /** A second line under the label, such as a city or a code. */
  optionDetail?: (option: T) => ReactNode;
  loading?: boolean;
  error?: Error | null;
};

export function Picker<T>({ label, hint, value, onChange, query, onQueryChange, options, optionKey, optionLabel,
  optionDetail, loading = false, error = null }: Props<T>) {
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const shown = open && query.trim() !== '';
  // cmdk always marks its input expanded; say whether the list is really showing.
  useEffect(() => { input.current?.setAttribute('aria-expanded', String(shown)); });

  const choose = (option: T) => {
    onChange(option);
    setOpen(false);
    onQueryChange('');
  };

  return (
    <div className="kit-field kit-picker">
      <Command label={label} shouldFilter={false}
        onKeyDown={(e) => {
          // Escape closes the list first; a dialog the picker sits in closes on the next Escape.
          if (e.key === 'Escape' && shown) { e.preventDefault(); setOpen(false); }
        }}>
        <Command.Input ref={input} aria-describedby={hint === undefined ? undefined : hintId}
          value={shown ? query : value === null ? query : optionLabel(value)}
          onFocus={(e) => e.currentTarget.select()} onBlur={() => setOpen(false)}
          onValueChange={(text) => { setOpen(true); onQueryChange(text); }} />
        {/* Pressing an option would blur the input and close the list before the click lands. */}
        <Command.List hidden={!shown} onMouseDown={(e) => e.preventDefault()}>
          {loading && options.length === 0 ? <Command.Loading>Searching…</Command.Loading> : null}
          {!loading && error === null ? <Command.Empty>Nothing matches “{query.trim()}”</Command.Empty> : null}
          {options.map((option) => (
            <Command.Item key={optionKey(option)} value={optionKey(option)} onSelect={() => choose(option)}>
              <span>{optionLabel(option)}</span>
              {optionDetail === undefined ? null : <span className="kit-picker-detail">{optionDetail(option)}</span>}
            </Command.Item>
          ))}
        </Command.List>
      </Command>
      {hint === undefined ? null : <p id={hintId} className="kit-field-hint">{hint}</p>}
      {error === null ? null : <p role="alert" className="kit-field-error">The search could not be run. Try again.</p>}
    </div>
  );
}
