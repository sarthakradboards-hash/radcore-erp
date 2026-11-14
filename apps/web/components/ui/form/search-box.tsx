'use client';
// A search that applies on Submit (RAD-50 follow-up, e2e on #128). The field is uncontrolled: the browser keeps what
// was typed, so text entered before the page's scripts have loaded (a slow phone, WebKit) is still there when React
// takes over, and is what Submit sends. A controlled field would be reset to its first state on hydration.
import { useId } from 'react';
import './form.css';

type Props = {
  label: string;
  /** The submit button's words, such as "Show". */
  action: string;
  /** Called with the trimmed text. */
  onSearch: (text: string) => void;
  maxLength?: number;
};

export function SearchBox({ label, action, onSearch, maxLength = 100 }: Props) {
  const id = useId();
  return (
    <form role="search" className="kit-search" onSubmit={(e) => {
      e.preventDefault();
      onSearch(String(new FormData(e.currentTarget).get('q') ?? '').trim());
    }}>
      <div className="kit-field">
        <label htmlFor={id}>{label}</label>
        <input id={id} name="q" type="search" maxLength={maxLength} autoComplete="off" />
      </div>
      <button type="submit" className="kit-button">{action}</button>
    </form>
  );
}
