'use client';
// A record chosen with the kit's Picker, kept in the form as its id (RAD-125): the customer of a document, and the item
// of a line. The server finds the matches as the person types. `initial` is the record already chosen (an edit), so the
// box shows its name before anything is typed. The form checks the id with the contract's own schema.
import { useState } from 'react';
import { useController } from 'react-hook-form';
import { useFieldName } from '../../../components/ui/form/form.tsx';
import { Picker } from '../../../components/ui/picker/picker.tsx';

type Found<T> = { items: readonly T[]; isFetching: boolean; error: Error | null };

export function PickedField<T extends { id: string }>({ name, label, hint, initial, useSearch, optionLabel, optionDetail }: {
  name: string; label: string; hint?: string; initial: T | null;
  /** A hook: the screen's search over the record's list, from `useApiSearch`. */
  useSearch: (query: string) => Found<T>;
  optionLabel: (option: T) => string;
  optionDetail?: (option: T) => string | null;
}) {
  useFieldName(name);
  const { field, fieldState } = useController({ name });
  const [picked, setPicked] = useState<T | null>(null);
  const [query, setQuery] = useState('');
  const found = useSearch(query);
  const error = fieldState.error?.message;
  return (
    <div>
      <Picker label={label} {...(hint === undefined ? {} : { hint })} query={query} onQueryChange={setQuery} options={found.items}
        loading={found.isFetching} error={found.error} value={picked ?? initial} optionKey={(o) => o.id} optionLabel={optionLabel}
        {...(optionDetail === undefined ? {} : { optionDetail })}
        onChange={(option) => { setPicked(option); field.onChange(option.id); }} />
      {error === undefined ? null : <p role="alert" className="kit-field-error">{error}</p>}
    </div>
  );
}
