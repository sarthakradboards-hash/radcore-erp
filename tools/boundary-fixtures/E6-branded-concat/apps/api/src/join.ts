// Two rounded amounts joined by +: "10.0020.00", not 30 (RAD-67).
import { roundMoney } from '@radcore/lib-common';

export const both = (a: string, b: string) => roundMoney(a) + roundMoney(b);
