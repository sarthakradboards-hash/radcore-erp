import { expect, it } from 'vitest';
import { t } from './index.ts';

it('fills placeholders and leaves an unknown one visible', () => {
  expect(t('error.reference', { id: 'abc123' })).toBe('Reference: abc123');
  expect(t('error.reference')).toBe('Reference: {id}');
  expect(t('notFound.title')).toBe('Page not found');
  expect(t('error.reference', {} as Record<string, string>)).toBe('Reference: {id}');
  expect(t('error.reference', Object.create({ id: 'inherited' }) as Record<string, string>)).toBe('Reference: {id}');
});
