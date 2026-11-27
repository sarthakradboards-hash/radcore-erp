// The supplier a purchasing document is for (ADR-008 §5, §7): a party we buy from (lib-accounts' BUYS_FROM_KINDS), and
// switched on. Shared by purchase orders and bills.
import { BUYS_FROM_KINDS, getPartyById } from '@radcore/lib-accounts';
import { AppError, type Ctx } from '@radcore/lib-platform';

export type Supplier = { name: string; stateCode: string; gstin: string | null; pan: string | null; composition: boolean; overseas: boolean };

/** An overseas supplier sells us services in rupees only, never goods (ADR-010 §4, RAD-153). */
export const servicesOnly = (name: string) => new AppError('overseas_services_only', `${name} is an overseas supplier of services: it takes no goods`,
  [{ path: ['supplierId'], code: 'overseas_services_only', message: 'An overseas supplier bills services only' }]);

/** The supplier, if it's one we buy from and switched on. Answers its name, state, GSTIN (null if unregistered), PAN,
 * whether it's a composition dealer (no input credit, ADR-009 §2) and whether it's overseas. `goods`: for a document of
 * goods (a purchase order), which an overseas supplier never takes. */
export async function buyingFrom(ctx: Ctx, partyId: string, o: { goods?: boolean } = {}): Promise<Supplier> {
  const party = await getPartyById(ctx, { id: partyId }).catch((e: unknown) => {
    if (e instanceof AppError && e.code === 'not_found') {
      throw new AppError('unknown_party', 'There is no such party', [{ path: ['supplierId'], code: 'unknown', message: 'Choose a supplier' }]);
    }
    throw e;
  });
  if (!party.active || !party.kinds.some((k) => (BUYS_FROM_KINDS as readonly string[]).includes(k))) {
    throw new AppError('not_a_supplier', `${party.name} isn’t a supplier we buy from`,
      [{ path: ['supplierId'], code: 'not_a_supplier', message: party.active ? 'Choose a supplier' : 'This party is switched off' }]);
  }
  if (o.goods === true && party.overseas) throw servicesOnly(party.name);
  return { name: party.name, stateCode: party.stateCode, gstin: party.gstin, pan: party.pan, composition: party.composition, overseas: party.overseas };
}
