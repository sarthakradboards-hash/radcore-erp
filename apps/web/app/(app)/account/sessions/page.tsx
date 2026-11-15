// Where you're signed in (M1-45). A <div>: the shell's one <main> already wraps every signed-in screen (RAD-50).
import { SessionsList } from '../../../../components/auth/sessions-list.tsx';
import { t } from '../../../../lib/i18n/index.ts';

export const metadata = { title: `${t('sessions.title')} · RadCore` };

export default function SessionsPage() {
  return (
    <div className="page-message">
      <h1>{t('sessions.title')}</h1>
      <SessionsList />
    </div>
  );
}
