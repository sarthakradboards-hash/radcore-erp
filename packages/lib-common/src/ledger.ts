// The ledger's fixed lists (ADR-006 §2, §3; ADR-005 §4): journal entry kinds, account types and control kinds, which
// entry kinds may post to each control kind, and the system accounts an owner migration seeds. The database holds
// the same lists (CHECKs, `posting_rules`, the seeded `accounts`), and a test checks each equals these, since a SQL
// trigger can't read a TypeScript constant. A ticket that adds an entry kind (M5-03, M5-07) adds it here too.

/** What posted a journal entry: a document's kind, or `manual`, `transfer`, `opening` and `year_close`. */
export const ENTRY_KINDS = [
  'opening', 'goods_receipt', 'purchase_bill', 'supplier_return', 'delivery', 'delivery_return', 'invoice',
  'credit_note', 'payment_in', 'payment_out', 'expense', 'stock_transfer', 'stock_adjustment', 'job_work',
  'revaluation', 'salary_advance', 'payroll', 'payroll_payment', 'statutory_payment', 'tds_deposit', 'transfer',
  'manual', 'year_close',
] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

export const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'income', 'expense'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

/** A control account takes only its own documents (RC-093); an ordinary one is `none`. */
export const CONTROL_KINDS = ['none', 'party', 'stock', 'gdni', 'grni', 'gst', 'tds', 'payroll', 'opening', 'year_close'] as const;
export type ControlKind = (typeof CONTROL_KINDS)[number];

/** The entry kinds that may post to each control kind (ADR-006 §2). Every control kind takes `opening`, for cut-over. */
export const POSTING_RULES: Readonly<Record<Exclude<ControlKind, 'none'>, readonly EntryKind[]>> = {
  party: ['opening', 'invoice', 'credit_note', 'purchase_bill', 'supplier_return', 'expense', 'payment_in', 'payment_out'],
  stock: ['opening', 'goods_receipt', 'purchase_bill', 'supplier_return', 'delivery', 'delivery_return', 'credit_note',
    'stock_transfer', 'stock_adjustment', 'job_work', 'revaluation'],
  gdni: ['opening', 'delivery', 'delivery_return', 'invoice', 'credit_note'],
  grni: ['opening', 'goods_receipt', 'purchase_bill', 'supplier_return', 'job_work'],
  gst: ['opening', 'invoice', 'credit_note', 'purchase_bill', 'supplier_return', 'expense'],
  tds: ['opening', 'invoice', 'purchase_bill', 'expense', 'payment_in', 'payment_out', 'payroll', 'tds_deposit'],
  payroll: ['opening', 'payroll', 'payroll_payment', 'salary_advance', 'statutory_payment'],
  opening: ['opening'],
  year_close: ['year_close'],
};

/** A system account: code refers to it by `key`, never by name or id. It can be renamed, never removed or re-keyed. */
export type SystemAccount = Readonly<{ key: string; name: string; type: AccountType; control: ControlKind }>;
const acc = (key: string, name: string, type: AccountType, control: ControlKind = 'none'): SystemAccount =>
  Object.freeze({ key, name, type, control });

/** The chart of accounts' system accounts (ADR-006 §2), in the order the screen lists them. */
export const SYSTEM_ACCOUNTS: readonly SystemAccount[] = [
  acc('cash', 'Cash', 'asset'),
  acc('bank', 'Bank', 'asset'),
  // Under Bank: the card machine's money until a journal moves it to the bank (RAD-115, Sarthak's card answer).
  acc('card_settlements', 'Card settlements', 'asset'),
  acc('debtors', 'Debtors', 'asset', 'party'),
  acc('stock', 'Stock in Hand', 'asset', 'stock'),
  acc('gdni', 'Goods Delivered Not Invoiced', 'asset', 'gdni'),
  acc('input_cgst', 'Input CGST', 'asset', 'gst'),
  acc('input_sgst', 'Input SGST', 'asset', 'gst'),
  acc('input_igst', 'Input IGST', 'asset', 'gst'),
  acc('input_cess', 'Input Cess', 'asset', 'gst'),
  // Reverse-charge tax booked on a bill or expense, claimed only once it's paid at the month's settlement (ADR-010 §4, F31).
  acc('rcm_credit_pending', 'RCM Credit Pending', 'asset', 'gst'),
  acc('tds_receivable', 'TDS Receivable', 'asset', 'tds'),
  acc('staff_advances', 'Staff Advances', 'asset', 'payroll'),
  acc('creditors', 'Creditors', 'liability', 'party'),
  acc('grni', 'Goods Received Not Billed', 'liability', 'grni'),
  acc('jw_accrued', 'Job Work Charges to be Billed', 'liability', 'grni'),
  acc('output_cgst', 'Output CGST', 'liability', 'gst'),
  acc('output_sgst', 'Output SGST', 'liability', 'gst'),
  acc('output_igst', 'Output IGST', 'liability', 'gst'),
  acc('output_cess', 'Output Cess', 'liability', 'gst'),
  // Reverse-charge tax we owe on what we bought (ADR-010 §4), paid in cash at the month's settlement.
  acc('rcm_cgst', 'RCM CGST Payable', 'liability', 'gst'),
  acc('rcm_sgst', 'RCM SGST Payable', 'liability', 'gst'),
  acc('rcm_igst', 'RCM IGST Payable', 'liability', 'gst'),
  acc('rcm_cess', 'RCM Cess Payable', 'liability', 'gst'),
  acc('tds_payable', 'TDS Payable', 'liability', 'tds'),
  acc('tcs_payable', 'TCS Payable', 'liability', 'tds'),
  acc('salaries_payable', 'Salaries Payable', 'liability', 'payroll'),
  acc('pf_payable', 'PF Payable', 'liability', 'payroll'),
  acc('esic_payable', 'ESIC Payable', 'liability', 'payroll'),
  acc('pt_payable', 'Professional Tax Payable', 'liability', 'payroll'),
  acc('opening_equity', 'Opening Balance Equity', 'equity', 'opening'),
  acc('retained_earnings', 'Retained Earnings', 'equity', 'year_close'),
  acc('sales', 'Sales', 'income'),
  acc('fx_difference', 'Foreign Exchange Gain / Loss', 'income'),
  acc('cogs', 'Cost of Goods Sold', 'expense'),
  acc('stock_adjustment', 'Stock Adjustment', 'expense'),
  acc('round_off', 'Round Off', 'expense'),
  // Output tax a credit note can no longer cut, past section 34's limit (ADR-007 §6, F25, RAD-114).
  acc('late_cn_gst', 'GST Borne on Late Credit Notes', 'expense'),
  acc('salaries', 'Salaries', 'expense'),
  acc('employer_pf', 'Employer PF', 'expense'),
  acc('employer_esic', 'Employer ESIC', 'expense'),
];
