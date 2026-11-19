// Which purchase-price field an item form shows, and the default it carries (RAD-99 on RAD-89's cost()). The kit's Form
// sends every default it holds except a masked field's, whether or not a box is on screen, so only a price the person
// may edit carries a value; anything else would send a price and be refused (`forbidden`) without cost:read.
import { isMasked, type Masked } from '@radcore/lib-common';

/** 'edit': a box (cost:read). 'masked': shown read-only, never sent. 'none': not on the form at all. */
export type CostField = 'edit' | 'masked' | 'none';

type Choice<D> = { cost: CostField; defaults: { purchasePrice?: D } };

/** `price` is the item's price as the server answered it, or undefined for a new item; the default carries a mask only
 * when the price can be one. */
export function costField<P extends string | null | Masked | undefined>(mayCost: boolean, price: P): Choice<string | Extract<P, Masked>> {
  // A mask is the server's word that this person can't see it, whatever the key list here says.
  if (price !== undefined && price !== null && isMasked(price)) {
    return { cost: 'masked', defaults: { purchasePrice: price as Extract<P, Masked> } };
  }
  if (mayCost) return { cost: 'edit', defaults: { purchasePrice: typeof price === 'string' ? price : '' } };
  return { cost: 'none', defaults: {} };
}
