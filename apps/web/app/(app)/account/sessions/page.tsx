// Where you're signed in (M1-45). Its own <main> for now: the shell's frame (RAD-50 part 2) lands after this, and
// then wraps every screen in one.
import { SessionsList } from '../../../../components/auth/sessions-list.tsx';
import { t } from '../../../../lib/i18n/index.ts';

export const metadata = { title: `${t('sessions.title')} · RadCore` };

export default function SessionsPage() {
  return (
    <main className="page-message">
      <h1>{t('sessions.title')}</h1>
      <SessionsList />
    </main>
  );
}
