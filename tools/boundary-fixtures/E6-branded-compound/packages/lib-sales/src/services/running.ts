// A compound assignment on a branded value joins text: "10.00" += "5.00" is "10.005.00" (the architect on #159).
import { roundMoney } from '@radcore/lib-common';

export function running(xs: string[]) {
  let acc = roundMoney('0');
  for (const x of xs) acc += roundMoney(x);
  return acc;
}
