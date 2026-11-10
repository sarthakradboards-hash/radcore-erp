// Shown while a screen's server work runs (RC-159), inside the shell, so the header and menu stay. It lives in (app),
// not at the root: a root loading.tsx would wrap the (app) layout too, so the page would stream "Loading…" before
// the session was read (RC-214), and a signed-out redirect would turn into a client-side one.
import { t } from '../../lib/i18n/index.ts';

export default function Loading() {
  return (
    <div className="page-message" aria-busy="true">
      <p role="status">{t('loading')}</p>
    </div>
  );
}
