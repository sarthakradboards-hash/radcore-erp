// The supplier a purchasing document is for (ADR-008 §5, §7): a party we buy from (lib-accounts' BUYS_FROM_KINDS), and
// switched on. Shared by purchase orders and bills.
import { BUYS_FROM_KINDS, getPartyById } from '@radcore/lib-accounts';
import { AppError, type Ctx } from '@radcore/lib-platform';

/** The supplier, if it's one we buy from and switched on. Answers its name, state, GSTIN (null if unregistered) and whether
 * it's a composition dealer (no input credit, ADR-008 §7a). */
export async function buyingFrom(ctx: Ctx, partyId: string): Promise<{ name: string; stateCode: string; gstin: string | null; composition: boolean }> {
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
  return { name: party.name, stateCode: party.stateCode, gstin: party.gstin, composition: party.composition };
}
