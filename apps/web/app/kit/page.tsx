// The UI kit on one page, for the browser tests of RAD-53 and RAD-54 (e2e). There is no screen yet that uses every
// part, and a kit part is only proved in a real browser under the real CSP. Off unless the server starts with
// KIT_PAGE=1, which only development and CI may set (kit-guard.ts). It makes no request: its saves are local fakes.
import { notFound } from 'next/navigation';
import { savedView } from '../../components/ui/table/saved-view-server.ts';
import { kitPageProblem } from '../../kit-guard.ts';
import { Gallery } from './gallery.tsx';
import { Lists } from './lists.tsx';
import { VIEWS } from './views.ts';

export default async function KitPage() {
  // The start-up check already refuses a deployed server with KIT_PAGE set; this keeps the page off if it is bypassed.
  if (process.env['KIT_PAGE'] !== '1' || kitPageProblem(process.env) !== null) notFound();
  return (
    <Gallery>
      <Lists initialView={await savedView('kit', VIEWS, 'list')} />
    </Gallery>
  );
}
