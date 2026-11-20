// One audited value as the audit trail shows it (RAD-57): text as it came, a value the viewer may not see as the
// server's mask (cost(), pii()), for the kit's <Pii> to say "Hidden", and anything else as its JSON. A mask must never
// reach the screen as `{"masked":"••••••"}` (e2e on #230).
import { isMasked, type Masked } from '@radcore/lib-common';

/** `none` is what a missing value reads as (an insert's old side, a delete's new side). */
export function auditValue(v: unknown, none: string): string | Masked {
  if (v === undefined) return none;
  if (typeof v === 'string') return v;
  if (isMasked(v)) return v;
  return JSON.stringify(v);
}
