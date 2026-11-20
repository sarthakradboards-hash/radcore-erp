// What a setting's box sends (RAD-133).
import type { Setting } from './types.ts';

/** What the server is sent for what the box holds: an integer setting takes a number. A blank or non-numeric box goes
 * as typed, so the server answers invalid_value on the field; Number('') is 0 and Number('x') is NaN (sent as null,
 * which would put the default back), and neither is what the person typed. */
export function sent(s: Pick<Setting, 'input'>, v: string | boolean): string | number | boolean {
  if (s.input.kind !== 'integer' || typeof v !== 'string') return v;
  const n = Number(v);
  return v.trim() === '' || !Number.isFinite(n) ? v : n;
}
