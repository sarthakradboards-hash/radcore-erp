// Shown while a screen's server work runs (RC-159), inside the shell, so the header and menu stay. It lives in (app),
// not at the app root: a root loading.tsx wraps every layout below it in Suspense, so the shell's session read would
// stream "Loading…" first (RC-214) and a signed-out redirect would turn client-side. tools/web-loading.test.ts keeps
// it out of the root. A <div>, because the shell's <main> already wraps every screen.
import { t } from '../../lib/i18n/index.ts';

export default function Loading() {
  return (
    <div className="page-message" aria-busy="true">
      <p role="status">{t('loading')}</p>
    </div>
  );
}
