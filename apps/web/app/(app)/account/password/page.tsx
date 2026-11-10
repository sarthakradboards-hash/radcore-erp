// Changing your password (M1-45). Its own <main> for now: the shell's frame (RAD-50 part 2) lands after this.
import { ChangePassword } from '../../../../components/auth/change-password.tsx';
import { t } from '../../../../lib/i18n/index.ts';

export const metadata = { title: `${t('password.title')} · RadCore` };

export default function Password() {
  return (
    <main className="page-message">
      <h1 id="page-title">{t('password.title')}</h1>
      <ChangePassword />
    </main>
  );
}
