// "0", "0.5" and "0.50" are one amount, so a text comparison with '0.00' misses two of them (the architect on #159).
import { roundMoney } from '@radcore/lib-common';

export const isZero = (x: string) => roundMoney(x) === '0.00';
