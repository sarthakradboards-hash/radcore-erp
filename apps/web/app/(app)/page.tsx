import { t } from '../../lib/i18n/index.ts';

// The shell's <main> wraps every screen, so a screen starts at its heading.
export default function Home() {
  return <h1>{t('nav.home')}</h1>;
}
