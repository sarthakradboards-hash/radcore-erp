'use client';
// Sign-out (M1-45, RAD-55): end the session, clear this person's drafts, then a full page load, so nothing of theirs
// stays in this tab: not the query cache, not paused saves, not the session in memory (RAD-52's sign-out rule).
import { signOut } from '@radcore/lib-platform/contract';
import { useState } from 'react';
import { ApiError, callContract } from '../../lib/api-client.ts';
import { t } from '../../lib/i18n/index.ts';
import { drafts } from '../../lib/offline/drafts.ts';

/** Ends the session and leaves. Throws, keeping drafts and staying put, when the server couldn't end it. */
export async function signOutAndLeave(userId: string, go: (url: string) => void = (url) => window.location.assign(url)) {
  try {
    await callContract(signOut, {});
  } catch (e) {
    // Already over (timed out, or ended from another device): leaving is still right.
    if (!(e instanceof ApiError && e.code === 'signed_out')) throw e;
  }
  drafts.clearAll(userId);
  go('/sign-in');
}

/** @public sign-in screen API: its first caller is the shell's account menu (RAD-50 part 2). */
export function SignOutButton({ userId }: { userId: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'failed'>('idle');
  const run = async () => {
    setState('busy');
    try {
      await signOutAndLeave(userId);
    } catch {
      setState('failed');
    }
  };
  return (
    <>
      <button type="button" className="sign-out" onClick={() => void run()} disabled={state === 'busy'} aria-busy={state === 'busy'}>
        {t('auth.signOut')}
      </button>
      {state === 'failed' ? <p role="alert">{t('auth.signOutFailed')}</p> : null}
    </>
  );
}
