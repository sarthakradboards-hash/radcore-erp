// RC-149: a form's unsent values survive a reload, per user, and never break the form when storage refuses.
import { afterEach, expect, it, vi } from 'vitest';
import { drafts } from './drafts.ts';

const memoryStorage = (): Storage => {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
  };
};

afterEach(() => vi.unstubAllGlobals());

it('saves, loads and clears a draft per user and form', () => {
  vi.stubGlobal('sessionStorage', memoryStorage());
  drafts.save('u1', 'party', { name: 'Asha' });
  drafts.save('u1', 'invoice', { total: '10.00' });
  drafts.save('u2', 'party', { name: 'Ravi' });
  expect(drafts.load('u1', 'party')).toEqual({ name: 'Asha' });
  expect(drafts.load('u2', 'party')).toEqual({ name: 'Ravi' });
  drafts.clear('u1', 'party');
  expect(drafts.load('u1', 'party')).toBeNull();
  expect(drafts.load('u1', 'invoice')).toEqual({ total: '10.00' });
});

it('never stores a password, secret, token or API key, at any depth', () => {
  vi.stubGlobal('sessionStorage', memoryStorage());
  drafts.save('u1', 'mail-settings', {
    host: 'smtp.example.in', smtpPassword: 'p4ss', clientSecret: 's', shopify: { apiKey: 'k', accessToken: 't', shop: 'x' },
  });
  expect(drafts.load('u1', 'mail-settings')).toEqual({ host: 'smtp.example.in', shopify: { shop: 'x' } });
});

it("clears only that user's drafts at sign-out", () => {
  vi.stubGlobal('sessionStorage', memoryStorage());
  drafts.save('u1', 'party', { name: 'Asha' });
  drafts.save('u1', 'invoice', { total: '10.00' });
  drafts.save('u10', 'party', { name: 'Not u1' }); // a prefix of u1's key must not match
  drafts.clearAll('u1');
  expect([drafts.load('u1', 'party'), drafts.load('u1', 'invoice')]).toEqual([null, null]);
  expect(drafts.load('u10', 'party')).toEqual({ name: 'Not u1' });
});

it('never throws when storage is missing, full or holds junk', () => {
  vi.stubGlobal('sessionStorage', undefined);
  expect(() => drafts.save('u1', 'party', {})).not.toThrow();
  expect(drafts.load('u1', 'party')).toBeNull();
  const full = memoryStorage();
  full.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); };
  vi.stubGlobal('sessionStorage', full);
  expect(() => drafts.save('u1', 'party', {})).not.toThrow();
  vi.stubGlobal('sessionStorage', memoryStorage());
  const cyclic: Record<string, unknown> = {};
  cyclic['self'] = cyclic;
  expect(() => drafts.save('u1', 'party', cyclic)).not.toThrow();
  expect(() => drafts.save('u1', 'party', { n: 1n })).not.toThrow();
  const junk = memoryStorage();
  junk.setItem('radcore:draft:u1:party', '{not json');
  vi.stubGlobal('sessionStorage', junk);
  expect(drafts.load('u1', 'party')).toBeNull();
});
