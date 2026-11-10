// Shown while a screen's server work runs (RC-159). The layout stays, so nothing already on screen is lost.
// It lives in (app), not at the app root: a root loading.tsx wraps every layout below it in Suspense, so the shell's
// session read (RAD-50 part 2) would stream "Loading…" first (RC-214) and a signed-out redirect would turn
// client-side. tools/web-loading.test.ts keeps it out of the root.
import { t } from '../../lib/i18n/index.ts';

export default function Loading() {
  return (
    <main className="page-message" aria-busy="true">
      <p role="status">{t('loading')}</p>
    </main>
  );
}
