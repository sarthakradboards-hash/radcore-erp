// The UI kit on one page, for the browser tests of RAD-53 and RAD-54 (e2e). There is no screen yet that uses every
// part, and a kit part is only proved in a real browser under the real CSP. Off unless the server starts with KIT_PAGE=1.
import { notFound } from 'next/navigation';
import { Gallery } from './gallery.tsx';

export default function KitPage() {
  if (process.env['KIT_PAGE'] !== '1') notFound();
  return <Gallery />;
}
