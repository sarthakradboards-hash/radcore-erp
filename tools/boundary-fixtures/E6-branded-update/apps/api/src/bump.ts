// ++ on a branded quantity turns it into a float (the architect on #159).
import { roundQty } from '@radcore/lib-common';

export function bump(x: string) {
  let q = roundQty(x, 0);
  q++;
  return q;
}
