// RAD-35 (RC-042, ADR-001 §6a): the record-scope rule behind ctx.can.
import { describe, expect, it } from 'vitest';
import type { Principal } from './ctx.ts';
import { mayUse } from './scope.ts';

const asha: Principal = { kind: 'user', userId: 'u-asha', permissions: ['leads:read', 'audit:read'], ownScope: ['leads:read'] };
const job: Principal = { kind: 'system', name: 'nightly', permissions: ['leads:read'] };

describe('record scope', () => {
  it('lets a key held over own records reach only what the person owns', () => {
    expect(mayUse(asha, 'leads:read', { owner: 'user:u-asha' })).toBe(true);
    expect(mayUse(asha, 'leads:read', { owner: 'user:u-ravi' })).toBe(false);
    expect(mayUse(asha, 'leads:read', { owner: 'system:shopify' })).toBe(false);
  });

  it('lets a key held over every record reach any record, and a missing key reach none', () => {
    expect(mayUse(asha, 'audit:read', { owner: 'user:u-ravi' })).toBe(true);
    expect(mayUse(asha, 'users:write', { owner: 'user:u-asha' })).toBe(false);
    expect(mayUse(asha, 'users:write')).toBe(false);
  });

  it('gives a system principal every record, but only for the keys its contract lists', () => {
    expect(mayUse(job, 'leads:read', { owner: 'user:u-ravi' })).toBe(true);
    expect(mayUse(job, 'audit:read')).toBe(false);
  });

  it('treats a person with no own-scope list as holding every key over every record', () => {
    expect(mayUse({ kind: 'user', userId: 'u-ravi', permissions: ['leads:read'] }, 'leads:read', { owner: 'user:u-asha' })).toBe(true);
  });
});
