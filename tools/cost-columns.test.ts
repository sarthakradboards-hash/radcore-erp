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
  payment_allocations: { amount: 'money applied to a document (payments:write)' },
  payment_reminders: { outstanding: 'what a party owed when reminded (receivables:read)', overdue: 'what of it was overdue (receivables:read)' },
  credit_applications: { amount: 'a credit applied to a document (payments:write)' },
  // tools/allocations-routes.test.ts's fixture document, there only while that file runs.
  t_route_invoices: { total: 'a test fixture’s document total' },
  payments: { amount: 'money a party paid or was paid (payments:write)', tds: 'tax the party held back (payments:write)' },
  transfers: { amount: 'money moved between our own accounts (payments:write)' },
  parties: { credit_limit: 'a customer’s credit terms (parties:read, set with parties:manage)' },
  leads: { value: 'a lead’s expected deal value, what it might sell for (leads:read)', score: 'a lead’s score, 0 to 100' },
  price_list_rates: { rate: 'a selling price (prices:read)' },
  stock_movements: { qty: 'a quantity' },
  // A purchase order's (RAD-136): the rates agreed with the supplier and their tax. A purchasing document's own rates are
  // its content under purchasing:read, not cost(), which stays on derived figures: averages, stock values and margins
  // (the architect on RAD-136).
  purchase_orders: { approved_total: 'the total a PO was approved for (purchasing:read)', taxable: 'a PO’s value (purchasing:read)',
    cgst: 'tax on a PO (purchasing:read)', sgst: 'tax on a PO (purchasing:read)', igst: 'tax on a PO (purchasing:read)',
    round_off: 'a PO’s round-off (purchasing:read)', total: 'a PO’s total (purchasing:read)' },
  purchase_order_lines: { qty: 'a quantity', rate: 'a rate agreed with the supplier (purchasing:read)', gst_rate: 'a tax rate',
    taxable: 'a line’s value (purchasing:read)', cgst: 'tax on a line (purchasing:read)', sgst: 'tax on a line (purchasing:read)',
    igst: 'tax on a line (purchasing:read)', line_total: 'a line’s total (purchasing:read)' },
  purchase_order_limits: { max_total: 'a role’s PO limit (purchasing:read)' },
  // A goods receipt's (RAD-137): quantities, and the PO rates its goods came in at, a purchasing document's content.
  goods_receipts: { value: 'a receipt’s value at the PO’s rates (purchasing:read)' },
  goods_receipt_lines: { received: 'a quantity', accepted: 'a quantity', rejected: 'a quantity',
    rate: 'the PO line’s rate (purchasing:read)', accepted_value: 'accepted goods at the PO rate (purchasing:read)',
    rejected_value: 'rejected goods at the PO rate (purchasing:read)' },
  // A purchase bill's (RAD-138): what the supplier billed and its tax, the bill's own content under purchasing:read, as a
  // PO's (the architect on RAD-136). cost() stays on what's derived from it: the stock's average and the price difference.
  purchase_bills: { stated_total: 'the total the supplier’s bill states (purchasing:read)', taxable: 'a bill’s value (purchasing:read)',
    cgst: 'tax on a bill (purchasing:read)', sgst: 'tax on a bill (purchasing:read)', igst: 'tax on a bill (purchasing:read)',
    round_off: 'a bill’s round-off (purchasing:read)', total: 'a bill’s total (purchasing:read)' },
  purchase_bill_lines: { qty: 'a quantity', revalued_qty: 'a quantity',
    grni_value: 'what the line cleared of Goods Received Not Billed, as its receipt accrued it (purchasing:read)',
    jwcb_value: 'what the line cleared of Job Work Charges to be Billed, as its job-work receipt accrued it (purchasing:read)', rate: 'a rate the supplier billed (purchasing:read)', amount: 'a charge on the goods (purchasing:read)',
    gst_rate: 'a tax rate', taxable: 'a line’s value (purchasing:read)', cgst: 'tax on a line (purchasing:read)', sgst: 'tax on a line (purchasing:read)',
    igst: 'tax on a line (purchasing:read)', line_total: 'a line’s total (purchasing:read)',
    credit_cgst: 'input credit a line claimed (RAD-139, purchasing:read)', credit_sgst: 'input credit a line claimed (RAD-139, purchasing:read)',
    credit_igst: 'input credit a line claimed (RAD-139, purchasing:read)' },
  // A supplier return's (RAD-140): the rejects sent back at the value Goods Received Not Billed accrued for them, the
  // return's own content under purchasing:read, as a receipt's rejected_value is.
  supplier_returns: { unbilled_value: 'what went back against Goods Received Not Billed (purchasing:read)',
    taxable: 'a debit note’s value at its bills’ rates (purchasing:read)', cgst: 'tax on a debit note (purchasing:read)',
    sgst: 'tax on a debit note (purchasing:read)', igst: 'tax on a debit note (purchasing:read)', round_off: 'a debit note’s round-off (purchasing:read)',
    total: 'a debit note’s total (purchasing:read)' },
  supplier_return_debits: { qty: 'a quantity', rate: 'the bill line’s rate (purchasing:read)', gst_rate: 'a tax rate',
    taxable: 'a billed part’s value at its bill’s rate (purchasing:read)', cgst: 'tax on it (purchasing:read)', sgst: 'tax on it (purchasing:read)',
    igst: 'tax on it (purchasing:read)' },
  supplier_return_lines: { qty: 'a quantity', rate: 'the receipt line’s rate (purchasing:read)', unbilled_qty: 'a quantity',
    unbilled_value: 'the unbilled part’s value, as its receipt accrued it (purchasing:read)' },
  // A quote's and an order's amounts, frozen when sent or confirmed (RAD-112): what was offered, its tax and round-off;
  // a line's, what was offered or ordered, at its selling rate and tax (sales:read).
  sales_quotes: { taxable: 'a selling value (sales:read)', cgst: 'tax quoted (sales:read)', sgst: 'tax quoted (sales:read)',
    igst: 'tax quoted (sales:read)', round_off: 'the round-off to the rupee (sales:read)', total: 'what the party is offered (sales:read)' },
  sales_orders: { taxable: 'a selling value (sales:read)', cgst: 'tax quoted (sales:read)', sgst: 'tax quoted (sales:read)',
    igst: 'tax quoted (sales:read)', round_off: 'the round-off to the rupee (sales:read)', total: 'what the party is offered (sales:read)',
    override_after: 'what the party would owe when its override was approved (sales:override)' },
  sales_quote_lines: { qty: 'a quantity', rate: 'a selling price (sales:read)', discount_percent: 'a discount, a percentage',
    gst_rate: 'a tax rate', taxable: 'a selling value (sales:read)', cgst: 'tax quoted (sales:read)',
    sgst: 'tax quoted (sales:read)', igst: 'tax quoted (sales:read)', line_total: 'a selling value with tax (sales:read)' },
  sales_order_lines: { qty: 'a quantity', rate: 'a selling price (sales:read)', discount_percent: 'a discount, a percentage',
    list_rate: 'a list price (prices:read)', gst_rate: 'a tax rate', taxable: 'a selling value (sales:read)', cgst: 'tax quoted (sales:read)',
    sgst: 'tax quoted (sales:read)', igst: 'tax quoted (sales:read)', line_total: 'a selling value with tax (sales:read)' },
  stock_movement_batches: { qty: 'a quantity' },
  deliveries: { override_after: 'what the party would owe when its override was approved (sales:override)' },
  // A delivery's or return's line (RAD-112): how many went or came back, and what they sold for (sales:read).
  delivery_lines: { qty: 'a quantity', taxable: 'a selling value (sales:read)', gst: 'the GST on a selling value (sales:read)' },
  delivery_return_lines: { qty: 'a quantity', taxable: 'a selling value (sales:read)', gst: 'the GST on a selling value (sales:read)' },
  // An invoice and its lines (RAD-113): what was billed, its tax and round-off (sales:read). Only a line's cost is a cost.
  invoices: { taxable: 'a selling value (sales:read)', cgst: 'tax charged (sales:read)', sgst: 'tax charged (sales:read)',
    igst: 'tax charged (sales:read)', cess: 'tax charged (sales:read)', round_off: 'the round-off to the rupee (sales:read)',
    total: 'what the party owes on it (sales:read)', override_after: 'what the party would owe when its override was approved (sales:override)' },
  invoice_lines: { qty: 'a quantity', rate: 'a selling price (sales:read)', discount_percent: 'a discount, a percentage',
    list_rate: 'a list price (prices:read)',
    gst_rate: 'a tax rate', taxable: 'a selling value (sales:read)', cgst: 'tax charged (sales:read)', sgst: 'tax charged (sales:read)',
    igst: 'tax charged (sales:read)', cess_ad_valorem: 'tax charged (sales:read)', cess_per_unit_amount: 'tax charged (sales:read)',
    line_total: 'a selling value with tax (sales:read)', delivery_taxable: 'a selling value (sales:read)',
    delivery_gst: 'the GST on a selling value (sales:read)' },
  // A credit note and its lines (RAD-114): what was credited and refunded, its tax and round-off (sales:read). Only a
  // line's cost, the goods back at what they went out at, is a cost.
  credit_notes: { refund_amount: 'a refund to the party (sales:read)', taxable: 'a selling value (sales:read)', cgst: 'tax credited (sales:read)',
    sgst: 'tax credited (sales:read)', igst: 'tax credited (sales:read)', round_off: 'the round-off to the rupee (sales:read)',
    total: 'what the party is credited (sales:read)' },
  credit_note_lines: { qty: 'a quantity', taxable: 'a selling value (sales:read)', gst_rate: 'a tax rate', cgst: 'tax credited (sales:read)',
    sgst: 'tax credited (sales:read)', igst: 'tax credited (sales:read)', line_total: 'a selling value with tax (sales:read)' },
  // What marketing spent on a campaign or source (RAD-110): it feeds cost per lead only (campaigns:read), never the books.
  ad_spend: { amount: 'marketing spend (campaigns:read)' },
  // Stock documents' quantities (RAD-141); their values are costs (COST_COLUMNS).
  stock_transfer_lines: { qty: 'a quantity' },
  stock_count_lines: { found: 'a quantity', book: 'a quantity', difference: 'a quantity' },
  stock_adjustment_lines: { qty: 'a quantity' },
  // Job work's quantities, and the job worker's charge (RAD-142): the document's own figures (ADR-008 §11).
  job_work_challan_lines: { qty: 'a quantity' },
  job_work_receipt_lines: { made_qty: 'a quantity', used: 'a quantity', back: 'a quantity', lost: 'a quantity',
    charge_rate: 'the job worker’s charge rate (stock:read)', charge: 'the job worker’s charge (stock:read)' },
  job_work_receipts: { charges: 'the job worker’s charges (stock:read)' },
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
