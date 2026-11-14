// Math.round on a branded rate turns it into a float (the architect on #159).
import { roundRate } from '@radcore/lib-common';

export const whole = (r: string) => Math.round(roundRate(r));
