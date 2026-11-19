// RAD-121 (M3-17): declaring a kind of notification. A kind is `<module>.<name>`, about one table, declared once; its
// label stands in when the record can't be described to the viewer.
import { describe, expect, it } from 'vitest';
import { defineNotification } from './notifications.ts';

describe('a kind of notification', () => {
  it('is <module>.<name>, about one table, with a label', () => {
    const k = defineNotification('platform.t_kind_ok', { table: 'users', label: 'A person needs you' });
    expect([k.kind, k.table, k.label]).toEqual(['platform.t_kind_ok', 'users', 'A person needs you']);
  });

  it('refuses a bad name, a bad table, an empty label, or the same kind twice', () => {
    expect(() => defineNotification('Repeat', { table: 'leads', label: 'x' })).toThrow(/<module>\.<name>/);
    expect(() => defineNotification('crm.t_bad_table', { table: 'Leads; drop', label: 'x' })).toThrow(/table/);
    expect(() => defineNotification('crm.t_no_label', { table: 'leads', label: ' ' })).toThrow(/label/);
    defineNotification('crm.t_twice', { table: 'leads', label: 'x' });
    expect(() => defineNotification('crm.t_twice', { table: 'leads', label: 'x' })).toThrow(/twice/);
  });
});
