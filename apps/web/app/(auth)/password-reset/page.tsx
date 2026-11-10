import { RequestReset } from '../../../components/auth/set-password.tsx';
import { t } from '../../../lib/i18n/index.ts';

export const metadata = { title: `${t('reset.title')} · RadCore` };

export default function PasswordReset() {
  return (
    <main className="auth-page">
      <h1 id="auth-title">{t('reset.title')}</h1>
      <p>{t('reset.intro')}</p>
      <RequestReset />
    </main>
  );
}
