'use client';
// A saved "board or list" choice (M1-44, RC-218). It is kept in a cookie so the server reads it (saved-view-server.ts)
// and the page draws, and fetches, the saved view first; a choice read in the browser after the first draw would fetch
// the wrong view first. Per device, which is what a view choice is.
import { useState } from 'react';
import { viewCookie } from './view-cookie.ts';

const YEAR_SECONDS = 365 * 24 * 60 * 60;

/** The view to show, starting from what the server read, and a setter that also saves the choice. */
export function useSavedView<V extends string>(name: string, initial: V): [V, (view: V) => void] {
  const [view, setView] = useState(initial);
  const choose = (next: V) => {
    setView(next);
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${viewCookie(name)}=${next}; Path=/; Max-Age=${YEAR_SECONDS}; SameSite=Lax${secure}`;
  };
  return [view, choose];
}
