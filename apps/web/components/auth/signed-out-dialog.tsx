'use client';
// RC-147: when the session ends under an open page, a dialog the person can't dismiss asks them to sign in again,
// right there. The page stays as it is behind it, so what they typed is kept; signing in closes the dialog and
// re-reads everything on screen. Mounted once, inside ApiProvider in the root layout.
// RAD-50 (auditor on RAD-55): that holds only for the same person. If someone else signs in here (a shared counter),
// nothing of the last person's may stay, their cached data, drafts or screen state, so the page loads afresh.
import { getMe } from '@radcore/lib-platform/contract';
import { useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import { callContract } from '../../lib/api-client.ts';
import { keyOf } from '../../lib/api/query.ts';
import { t } from '../../lib/i18n/index.ts';
import { drafts } from '../../lib/offline/drafts.ts';
import { afterSignInAgain } from '../../lib/session/signed-in-again.ts';
import { clearSignedOut, useSignedOut } from '../../lib/session/signed-out.ts';
import { Dialog } from '../ui/dialog/dialog.tsx';
import { SignIn } from './sign-in.tsx';

type Me = z.output<typeof getMe.output>;

export function SignedOutDialog() {
  const open = useSignedOut();
  const client = useQueryClient();
  const done = async () => {
    // The shell's session (SessionProvider) is in the cache under /me's key: who was signed in before.
    const before = client.getQueryData<Me>(keyOf(getMe, {}))?.user.id;
    let after: string | undefined;
    try {
      after = (await callContract(getMe, {})).user.id;
    } catch {
      after = undefined; // can't tell who signed in: treat as someone else
    }
    if (after === undefined || afterSignInAgain(before, after) === 'reload') {
      if (before !== undefined) drafts.clearAll(before);
      window.location.reload();
      return;
    }
    clearSignedOut();
    void client.invalidateQueries();
  };
  return (
    <Dialog open={open} onOpenChange={() => undefined} dismissible={false} title={t('signedOut.title')}
      description={t('signedOut.body')}>
      {open ? <SignIn onDone={() => void done()} /> : null}
    </Dialog>
  );
}
