'use client';
// Draft autosave (M1-42, RC-149): a form's unsent values survive a reload, a crash or a failed save.
// sessionStorage, not localStorage: a draft can hold a customer's name or phone, and on a shared counter device it
// should go when the tab closes. Keyed by user, and cleared at sign-out (RAD-55), so nobody else gets it.
import { useEffect } from 'react';

const PREFIX = 'radcore:draft:';
// Never stored, at any depth: a settings form with an SMTP password or an integration's API key. Sign-in, second-factor
// and password forms go further and never autosave at all (RAD-55), since their short field names ("code") can't be told apart.
const SECRET = /password|passcode|passphrase|secret|token|api[-_]?key/i;
const keyFor = (user: string, form: string) => `${PREFIX}${user}:${form}`;

// Storage can be missing or refuse (private mode, quota): a draft is a convenience, so it never breaks the form.
const store = (): Storage | undefined => {
  try { return globalThis.sessionStorage; } catch { return undefined; }
};

/** @public UI-kit API: first callers are RAD-53's forms (load) and RAD-55's sign-out (clearAll). */
export const drafts = {
  load<T>(user: string, form: string): T | null {
    try {
      const raw = store()?.getItem(keyFor(user, form));
      return raw == null ? null : (JSON.parse(raw) as T); // the form's own schema checks it on submit
    } catch { return null; }
  },
  save(user: string, form: string, value: unknown): void {
    const json = JSON.stringify(value, (k, v: unknown) => (SECRET.test(k) ? undefined : v));
    try { store()?.setItem(keyFor(user, form), json); } catch { /* full or blocked: skip */ }
  },
  clear(user: string, form: string): void {
    try { store()?.removeItem(keyFor(user, form)); } catch { /* blocked: nothing stored */ }
  },
  clearAll(user: string): void {
    const s = store();
    if (!s) return;
    try {
      const mine = Array.from({ length: s.length }, (_, i) => s.key(i)).filter((k) => k?.startsWith(keyFor(user, '')));
      for (const k of mine) s.removeItem(k!);
    } catch { /* blocked: nothing stored */ }
  },
};

/**
 * Saves `values` a second after the last change. The form clears the draft after a successful save.
 * @public UI-kit API: first callers are RAD-53's forms.
 */
export function useDraftAutosave(user: string, form: string, values: unknown, delayMs = 1000): void {
  const json = JSON.stringify(values);
  useEffect(() => {
    const t = setTimeout(() => drafts.save(user, form, JSON.parse(json)), delayMs);
    return () => clearTimeout(t);
  }, [user, form, json, delayMs]);
}
