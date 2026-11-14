// A unary minus turns a unit price into a float (RAD-67).
import { roundRate } from '@radcore/lib-common';

export const flipped = (r: string) => -roundRate(r);
