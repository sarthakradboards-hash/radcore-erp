import { expect, it } from 'vitest';
import { admin } from './admin.ts';
import { core, t } from './index.ts';
import { kit } from './kit.ts';

it('fills placeholders and leaves an unknown one visible', () => {
  expect(t('error.reference', { id: 'abc123' })).toBe('Reference: abc123');
  expect(t('error.reference')).toBe('Reference: {id}');
  expect(t('notFound.title')).toBe('Page not found');
  expect(t('error.reference', {} as Record<string, string>)).toBe('Reference: {id}');
  expect(t('error.reference', Object.create({ id: 'inherited' }) as Record<string, string>)).toBe('Reference: {id}');
});

it('keeps each catalogue under its own prefix, so no key replaces another', () => {
  const catalogues = { core, admin, kit };
  const seen = new Map<string, string>();
  for (const [name, catalogue] of Object.entries(catalogues)) {
    for (const key of Object.keys(catalogue)) {
      expect(seen.get(key), `"${key}" is in both ${seen.get(key) ?? ''} and ${name}`).toBeUndefined();
      seen.set(key, name);
    }
  }
  expect(Object.keys(admin).every((k) => k.startsWith('admin.'))).toBe(true);
  expect(Object.keys(kit).every((k) => k.startsWith('kit.'))).toBe(true);
  expect(Object.keys(core).some((k) => k.startsWith('admin.') || k.startsWith('kit.'))).toBe(false);
});
