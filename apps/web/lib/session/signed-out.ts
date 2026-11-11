'use client';
// Whether the session has ended under the open page (RAD-55, RC-147). Any read or save answered 401 signed_out sets
// it; the signed-out dialog shows while it's set, and signing in again in that dialog clears it.
import { useSyncExternalStore } from 'react';
import { ApiError } from '../api-client.ts';

let signedOut = false;
const listeners = new Set<() => void>();

function set(value: boolean): void {
  if (signedOut === value) return;
  signedOut = value;
  for (const listener of listeners) listener();
}

/** For the query client: any failure that says the session has ended. */
export const noteSignedOut = (error: unknown): void => {
  if (error instanceof ApiError && error.code === 'signed_out') set(true);
};

/** After signing in again. */
export const clearSignedOut = (): void => set(false);

export const isSignedOut = (): boolean => signedOut;

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useSignedOut = (): boolean => useSyncExternalStore(subscribe, isSignedOut, () => false);
