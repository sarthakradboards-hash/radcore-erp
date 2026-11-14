// A conversion handed to a branded array's map: each amount becomes a float (the auditor on #159).
import { moneyString } from '@radcore/lib-common';

const parsed = (xs: unknown[]) => xs.map((x) => moneyString().parse(x));
export const heights = (xs: unknown[]) => parsed(xs).map(Number);
