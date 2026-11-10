// The invite link: /invite#token=… (ADR-001 §7a). The token never reaches the server in the URL.
import { SetPassword } from '../../../components/auth/set-password.tsx';
import { t } from '../../../lib/i18n/index.ts';

export const metadata = { title: `${t('invite.title')} · RadCore` };

export default function Invite() {
  return (
    <main className="auth-page">
      <h1 id="auth-title">{t('invite.title')}</h1>
      <SetPassword kind="invite" />
    </main>
  );
}
