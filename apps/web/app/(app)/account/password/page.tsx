// Changing your password (M1-45). A <div>: the shell's one <main> already wraps every signed-in screen (RAD-50).
import { ChangePassword } from '../../../../components/auth/change-password.tsx';
import { t } from '../../../../lib/i18n/index.ts';

export const metadata = { title: `${t('password.title')} · RadCore` };

export default function Password() {
  return (
    <div className="page-message">
      <h1 id="page-title">{t('password.title')}</h1>
      <ChangePassword />
    </div>
  );
}
