// ADR-001 §7a (RAD-89, auditor-2 on #224): the audit trail keeps an audited column's values as they are, so a cost
// column there is masked for a viewer without cost:read through lib-platform's COST_COLUMNS. A money column audited
// later must be listed as a cost or, with its reason, as not one: this reads every audit trigger's kept columns from
// the database and fails on a numeric one in neither list, so the next cost can't slip into the trail unmasked.
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { COST_COLUMNS } from '../packages/lib-platform/src/audit-trail.ts';

const url = process.env['TEST_DATABASE_URL'];

/** Audited numeric columns that aren't costs, each with why. */
const NOT_COSTS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  discount_limits: { max_percent: 'a role’s discount limit, a percentage (prices:read)' },
  gst_rates: { rate: 'a tax rate' },
  parties: { credit_limit: 'a customer’s credit terms (parties:read, set with parties:manage)' },
  price_list_rates: { rate: 'a selling price (prices:read)' },
  stock_movements: { qty: 'a quantity' },
  stock_movement_batches: { qty: 'a quantity' },
  // The books: who may read them is journal:read's question, which the architect is ruling on (auditor-2 on #224).
  journal_lines: { debit: 'the books (journal:read)', credit: 'the books (journal:read)' },
};

it.runIf(process.env['CI'] && !url)('has its test database in CI', () => {
  expect.fail('TEST_DATABASE_URL is not set: in CI the cost-columns check must run, not skip');
});

describe.skipIf(!url)('audited money columns', () => {
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  afterAll(() => pool.end());

  it('are each a cost the audit trail masks, or listed as not a cost (ADR-001 §7a)', async () => {
    // Each audit trigger's arguments: its key columns, then the kept ones, comma-separated (radcore.audit_attach).
    const { rows: triggers } = await pool.query<{ table_name: string; args: string }>(`select c.relname as table_name,
      encode(t.tgargs, 'escape') as args from pg_trigger t join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'radcore' and t.tgname = 'audit_row'`);
    const { rows: numeric } = await pool.query<{ table_name: string; column_name: string }>(`select table_name, column_name
      from information_schema.columns where table_schema = 'radcore' and data_type = 'numeric'`);
    const kept = new Map(triggers
      // Other test files make audited fixture tables of their own (t_…) while this one runs.
      .filter((t) => !t.table_name.startsWith('t_'))
      .map((t) => [t.table_name, new Set((t.args.split('\\000')[1] ?? '').split(',').filter((c) => c !== ''))]));
    const unlisted = numeric
      .filter((c) => kept.get(c.table_name)?.has(c.column_name) === true)
      .filter((c) => !(COST_COLUMNS[c.table_name] ?? []).includes(c.column_name) && NOT_COSTS[c.table_name]?.[c.column_name] === undefined)
      .map((c) => `${c.table_name}.${c.column_name}`);
    expect(unlisted).toEqual([]);
    // And the cost columns are audited ones, so the list names nothing that isn't there.
    expect(Object.entries(COST_COLUMNS).flatMap(([t, cs]) => cs.filter((c) => kept.get(t)?.has(c) !== true).map((c) => `${t}.${c}`)))
      .toEqual([]);
  });
});
