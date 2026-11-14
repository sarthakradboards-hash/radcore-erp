'use client';
// A search that applies on Submit (RAD-50 follow-up, e2e on #128). The field is uncontrolled: the browser keeps what
// was typed, so text entered before the page's scripts have loaded (a slow phone, WebKit) is still there when React
// takes over, and is what Submit sends. A controlled field would be reset to its first state on hydration.
// The field has no name, so a Submit pressed before hydration (the browser's own GET) puts nothing in the URL: a name
// or email typed here never reaches the address bar, history or the proxy's log.
import { useId, useRef } from 'react';
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
  const field = useRef<HTMLInputElement>(null);
  return (
    <form role="search" className="kit-search" onSubmit={(e) => {
      e.preventDefault();
      onSearch((field.current?.value ?? '').trim());
    }}>
      <div className="kit-field">
        <label htmlFor={id}>{label}</label>
        <input ref={field} id={id} type="search" maxLength={maxLength} autoComplete="off" />
      </div>
      <button type="submit" className="kit-button">{action}</button>
    </form>
  );
}
