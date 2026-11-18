// Items (RAD-99 on RAD-89's contracts): the saved list-or-cards choice is read here on the server, so the page draws,
// and fetches, that view first (RC-218); the list itself is a client screen.
import { savedView } from '../../../../components/ui/table/saved-view-server.ts';
import { Items } from './items.tsx';
import { ITEM_VIEWS } from './views.ts';

export default async function ItemsPage() {
  return <Items initialView={await savedView('items', ITEM_VIEWS, 'list')} />;
}
