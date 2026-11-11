// RAD-38 (RC-037): what the maker-checker engine decides without a database. tools/approvals.test.ts runs the rules
// on PostgreSQL over HTTP.
import { describe, expect, it } from 'vitest';
import { defineApproval, versionHash, type ApprovalSpec } from './approvals.ts';
import { approvalContracts } from './contract.ts';

const spec = (kind: string): ApprovalSpec => ({
  kind, version: async () => null, approved: async () => undefined, rejected: async () => undefined,
});

describe('versionHash', () => {
  it('hashes the same figures the same, whatever order their keys were built in', () => {
    const a = versionHash({ amount: '1500.00', lines: [{ qty: '2', item: 'pump' }], supplier: { id: 's-1', name: 'Asha' } });
    const b = versionHash({ supplier: { name: 'Asha', id: 's-1' }, lines: [{ item: 'pump', qty: '2' }], amount: '1500.00' });
    expect([a, b.length]).toEqual([b, 64]);
  });

  it('changes when any figure, or the order of lines, changes', () => {
    const base = { amount: '1500.00', lines: ['a', 'b'] };
    expect(new Set([base, { ...base, amount: '1500.01' }, { ...base, lines: ['b', 'a'] }, { ...base, extra: null }]
      .map(versionHash)).size).toBe(4);
  });
});

describe('approvalContracts', () => {
  it('gives a kind three routes under one static permission, and only the decision writes', () => {
    const c = approvalContracts('purchase-order', 'purchasing:approve');
    expect([c.listPending, c.getApproval, c.decide].map((x) => `${x.method} ${x.path} ${x.perm} ${String(x.tx.readOnly)}`)).toEqual([
      'GET /approvals/purchase-order purchasing:approve true',
      'GET /approvals/purchase-order/:id purchasing:approve true',
      'POST /approvals/purchase-order/:id/decision purchasing:approve false',
    ]);
    expect(c.decide.errors).toEqual(['own_request', 'approver_too_new', 'version_changed', 'not_pending']);
  });

  it('takes an approval only with the version seen, and a rejection only with a reason', () => {
    const { decide } = approvalContracts('purchase-order', 'purchasing:approve');
    const id = '3f2b8c9e-1d4a-4f6b-9c2e-7a1b5d3e9f01';
    expect([
      { id, decision: 'approve', versionHash: 'a'.repeat(64) },
      { id, decision: 'approve' },
      { id, decision: 'approve', versionHash: 'not a hash' },
      { id, decision: 'reject', reason: 'Wrong supplier' },
      { id, decision: 'reject' },
      { id, decision: 'reject', reason: '   ' },
    ].map((input) => decide.input.safeParse(input).success)).toEqual([true, false, false, true, false, false]);
  });
});

describe('defineApproval', () => {
  it('mounts the three routes for its kind, and refuses contracts of another kind', () => {
    const contracts = approvalContracts('purchase-order', 'purchasing:approve');
    expect(defineApproval(contracts, spec('purchase-order')).map((r) => r.contract)).toEqual(
      [contracts.listPending, contracts.getApproval, contracts.decide]);
    expect(() => defineApproval(contracts, spec('stock-adjustment'))).toThrow(/contracts are for purchase-order/);
  });
});
