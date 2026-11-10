import { SignInPage } from '../../../components/auth/sign-in.tsx';
import { t } from '../../../lib/i18n/index.ts';

export const metadata = { title: `${t('signIn.title')} · RadCore` };

export default function SignIn() {
  return (
    <main className="auth-page">
      <h1 id="auth-title">{t('signIn.title')}</h1>
      <SignInPage />
    </main>
  );
}
