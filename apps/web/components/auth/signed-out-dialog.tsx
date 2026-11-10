'use client';
// RC-147: when the session ends under an open page, a dialog the person can't dismiss asks them to sign in again,
// right there. The page stays as it is behind it, so what they typed is kept; signing in closes the dialog and
// re-reads everything on screen. Mounted once, inside ApiProvider in the root layout.
// shortcut: anyone may sign in here, and the page's data then reloads as them; a check that it's the same person
// (comparing /me's user id) comes with the shell's session (RAD-50 part 2).
import { useQueryClient } from '@tanstack/react-query';
import { t } from '../../lib/i18n/index.ts';
import { clearSignedOut, useSignedOut } from '../../lib/session/signed-out.ts';
import { Dialog } from '../ui/dialog/dialog.tsx';
import { SignIn } from './sign-in.tsx';

export function SignedOutDialog() {
  const open = useSignedOut();
  const client = useQueryClient();
  const done = () => {
    clearSignedOut();
    void client.invalidateQueries();
  };
  return (
    <Dialog open={open} onOpenChange={() => undefined} dismissible={false} title={t('signedOut.title')}
      description={t('signedOut.body')}>
      {open ? <SignIn onDone={done} /> : null}
    </Dialog>
  );
}
