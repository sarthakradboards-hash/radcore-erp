// Two amounts from the wire compared as text: "9.00" > "10.00" (RAD-67). Neither name is a money word.
import { moneyString } from '@radcore/lib-common';

export const over = (a: unknown, b: unknown) => moneyString().parse(a) > moneyString().parse(b);
