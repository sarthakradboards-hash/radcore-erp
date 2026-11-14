// Record scope (RAD-35, M1-17, ADR-001 §6a, RC-042): the one rule behind ctx.can. The feature permission is checked
// at the entry (the route's or job's); inside, a service asks whether this principal may use it on this record.
import { principalId, type Owned, type Principal } from './ctx.ts';

/** May `p` use `permission` on `record` (or at all, without one)? There is no principal that passes every check. */
export function mayUse(p: Principal, permission: string, record?: Owned): boolean {
  if (!p.permissions.includes(permission)) return false;
  if (record === undefined || p.kind === 'system') return true;
  // A key the role holds only over its own records reaches a record the person owns, and nothing else.
  return !(p.ownScope ?? []).includes(permission) || record.owner === principalId(p);
}
