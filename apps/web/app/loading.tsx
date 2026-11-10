// Shown while a screen's server work runs (RC-159). The layout stays, so nothing already on screen is lost.
import { t } from '../lib/i18n/index.ts';

export default function Loading() {
  return (
    <main className="page-message" aria-busy="true">
      <p role="status">{t('loading')}</p>
    </main>
  );
}
