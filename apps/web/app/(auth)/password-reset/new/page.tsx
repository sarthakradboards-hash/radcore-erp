// The reset email's link: /password-reset/new#token=… (ADR-001 §7a). The token never reaches the server in the URL.
import { SetPassword } from '../../../../components/auth/set-password.tsx';
import { t } from '../../../../lib/i18n/index.ts';

export const metadata = { title: `${t('reset.newTitle')} · RadCore` };

export default function NewPassword() {
  return (
    <main className="auth-page">
      <h1 id="auth-title">{t('reset.newTitle')}</h1>
      <SetPassword kind="reset" />
    </main>
  );
}
