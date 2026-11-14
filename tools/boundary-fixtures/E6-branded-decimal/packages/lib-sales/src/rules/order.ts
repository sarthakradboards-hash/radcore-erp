// Decimals compared with < turn into strings first, so "9" < "10" is false (RAD-67).
import { dec } from '@radcore/lib-common';

export const before = (a: string, b: string) => dec(a) < dec(b);
