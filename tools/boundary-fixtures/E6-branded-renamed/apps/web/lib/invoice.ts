// A line amount under a name the word list doesn't know: its type is still Money (RAD-67).
import { lineAmount } from '@radcore/lib-common';

export const doubled = (q: string, r: string) => {
  const x = lineAmount(q, r);
  return Number(x) * 2;
};
