// Every permission key there is (RAD-36, ADR-001 §6a), with the module and words the permission matrix shows. A key
// not listed here can't be granted (`unknown_permission`). Each module's migration grants its own keys to the roles
// it names; its keys join this list with it. RAD-37's manifest test checks the list against the routes and the seed.

export type Permission = {
  readonly key: string;
  readonly module: string;
  readonly label: string;
  /** Only these roles may hold it, whatever the matrix says (D-20: only admin and owner see pay). */
  readonly onlyRoles?: readonly string[];
  /** A role holding it needs the second sign-in factor, whatever its own setting (D-19, RAD-83): keys that move money
   * or reach payroll, HR or user administration. Each such module's keys join with it. */
  readonly secondFactor?: boolean;
  /** Granted at `all` scope only (RAD-90): a key a piiRecord names as `seenWith` unmasks by key, not scope, so an `own`
   * grant would show every record's personal fields. The database refuses an `own` grant of it. */
  readonly allOnly?: boolean;
  /** A piiRecord names it as `seenWith` (RAD-90, #182): holding it shows that record's personal fields, as pii:read
   * does, so the matrix warns of it. It's all-only too; the manifest test holds the two lists equal. */
  readonly unmasks?: boolean;
  /** The tables holding the records this key reaches, as `<db entry>#<table export>` ('@radcore/db/crm#leads'). Any
   * key may be granted at `own` scope, so a module service reading one of these applies the scope (E7, RAD-85). */
  readonly records?: readonly string[];
};

/** In the order the matrix shows them: by module, then by key. */
export const PERMISSIONS: readonly Permission[] = Object.freeze([
  { key: 'session:read', module: 'My work', label: 'Their own account: profile, password and sessions' },
  { key: 'users:read', module: 'Admin', label: 'See people and their sessions' },
  { key: 'users:write', module: 'Admin', label: 'Invite people, change their role, deactivate them', secondFactor: true },
  { key: 'roles:read', module: 'Admin', label: 'See roles and what each may do' },
  { key: 'roles:write', module: 'Admin', label: 'Change what each role may do', secondFactor: true },
  { key: 'audit:read', module: 'Admin', label: 'Read the audit trail and security events' },
  { key: 'settings:read', module: 'Admin', label: 'See the business’s settings and its number-series prefixes' },
  { key: 'settings:write', module: 'Admin', label: 'Change the business’s settings and its number-series prefixes', secondFactor: true },
  { key: 'company:read', module: 'Company', label: 'See the company’s name, GSTIN and address' },
  { key: 'company:write', module: 'Company', label: 'Set the company’s name, GSTIN and address, which every invoice prints', secondFactor: true },
  { key: 'gst:read', module: 'GST', label: 'See GST rates by HSN and date' },
  { key: 'gst:write', module: 'GST', label: 'Add and correct GST rates, which every invoice uses', secondFactor: true },
  { key: 'items:read', module: 'Items', label: 'See items, their categories and units' },
  { key: 'items:write', module: 'Items', label: 'Add and change items and their categories' },
  { key: 'parties:read', module: 'Parties', label: 'See customers, dealers, franchisees and suppliers' },
  { key: 'parties:write', module: 'Parties', label: 'Add and change parties' },
  { key: 'parties:contact', module: 'Parties', label: 'See customers’ and suppliers’ contact details', allOnly: true, unmasks: true },
  { key: 'parties:manage', module: 'Parties', label: 'Set a party’s credit days and credit limit', secondFactor: true },
  { key: 'accounts:write', module: 'Journal', label: 'Change the chart of accounts: codes, and switching accounts off and on' },
  { key: 'payments:write', module: 'Payments', label: 'Record and cancel receipts, payments and refunds', secondFactor: true },
  { key: 'payments:approve', module: 'Payments', label: 'Approve another person’s cash past the day’s limit', secondFactor: true },
  { key: 'receivables:read', module: 'Payments', label: 'See what each party owes: statements and the To collect list',
    records: ['@radcore/db/accounts#partyManagers'] },
  { key: 'receivables:remind', module: 'Payments', label: 'Record a reminder to a party of what they owe (with receivables:read)',
    records: ['@radcore/db/accounts#partyManagers'] },
  { key: 'journal:read', module: 'Journal', label: 'See the chart of accounts and the journal' },
  { key: 'journal:post', module: 'Journal', label: 'Post a manual journal', secondFactor: true },
  { key: 'journal:reverse', module: 'Journal', label: 'Reverse a journal entry', secondFactor: true },
  { key: 'prices:read', module: 'Prices', label: 'See price lists and discount limits' },
  { key: 'prices:write', module: 'Prices', label: 'Draft price lists, which price nothing until approved' },
  { key: 'prices:approve', module: 'Prices', label: 'Approve another person’s price list, and set discount limits', secondFactor: true },
  { key: 'sales:read', module: 'Sales', label: 'See quotes, orders, deliveries, delivery returns, invoices and credit notes',
    records: ['@radcore/db/sales#salesQuotes', '@radcore/db/sales#salesOrders', '@radcore/db/sales#deliveries',
      '@radcore/db/sales#deliveryReturns', '@radcore/db/sales#invoices', '@radcore/db/sales#creditNotes'] },
  { key: 'sales:write', module: 'Sales', label: 'Draft and send quotes, and draft, confirm and close orders',
    records: ['@radcore/db/sales#salesQuotes', '@radcore/db/sales#salesOrders'] },
  { key: 'deliveries:write', module: 'Sales', label: 'Draft and post deliveries, and take delivered goods back before invoicing',
    records: ['@radcore/db/sales#deliveries', '@radcore/db/sales#deliveryReturns'] },
  // Cancelling a posted delivery or return mirrors its stock and books (RAD-114, the architect's ruling): its own key.
  { key: 'deliveries:cancel', module: 'Sales', label: 'Cancel a posted delivery or delivery return',
    records: ['@radcore/db/sales#deliveries', '@radcore/db/sales#deliveryReturns'] },
  { key: 'invoices:write', module: 'Sales', label: 'Draft and post invoices of delivered goods',
    records: ['@radcore/db/sales#invoices'] },
  // Its own key, so cancelling can be kept from the counter (the architect on RAD-113), without the second factor
  // (Sarthak, 20 Nov). Its route is RAD-114's.
  { key: 'invoices:cancel', module: 'Sales', label: 'Cancel a posted invoice', records: ['@radcore/db/sales#invoices'] },
  // A link shows the invoice outside the app to whoever holds it, so sharing is its own key (the architect on RAD-118),
  // without the second factor: it moves no money.
  { key: 'invoices:share', module: 'Sales', label: 'Send a customer a link to a posted invoice, and revoke one',
    records: ['@radcore/db/sales#invoices'] },
  // Credit notes (RAD-114, the architect's ruling): drafted at the counter too; every one approved by someone else, with
  // the second factor since it moves money (Sarthak, 20 Nov); cancelling is its own key.
  { key: 'credit_notes:write', module: 'Sales', label: 'Draft credit notes and send them for approval', records: ['@radcore/db/sales#creditNotes'] },
  { key: 'credit_notes:approve', module: 'Sales', label: 'Approve another person’s credit note, which posts it and pays its refund',
    secondFactor: true, records: ['@radcore/db/sales#creditNotes'] },
  { key: 'credit_notes:cancel', module: 'Sales', label: 'Cancel a posted credit note', records: ['@radcore/db/sales#creditNotes'] },
  { key: 'sales:override', module: 'Sales', label: 'Approve another person’s sale over a credit limit, below cost or over a discount limit',
    secondFactor: true },
  // Vehicle bookings (M3-13, RAD-117; ADR-007 §5): a booking holds a unit and takes its advance. Scoped by who made it.
  // Refunding a cancelled booking's advance is keyed by how much of what's left (Sarthak, 20 Nov): all of it needs
  // refund_full, a part refund_part; each moves money out, so each needs the second factor (D-19).
  { key: 'bookings:read', module: 'Bookings', label: 'See vehicle bookings and test rides',
    records: ['@radcore/db/sales#vehicleBookings', '@radcore/db/sales#testRides'] },
  { key: 'bookings:write', module: 'Bookings', label: 'Book a vehicle and take its advance, cancel a booking, and schedule test rides',
    records: ['@radcore/db/sales#vehicleBookings', '@radcore/db/sales#testRides'] },
  { key: 'bookings:refund_full', module: 'Bookings', label: 'Refund all of what’s left of a cancelled booking’s advance', secondFactor: true },
  { key: 'bookings:refund_part', module: 'Bookings', label: 'Refund part of what’s left of a cancelled booking’s advance', secondFactor: true },
  { key: 'pii:read', module: 'Personal data', label: 'See personal details unmasked' },
  { key: 'pay:read', module: 'Personal data', label: 'See salaries and bank details', onlyRoles: ['admin', 'owner'], secondFactor: true },
  { key: 'photo_files:read', module: 'Files', label: 'See job photos' },
  { key: 'photo_files:write', module: 'Files', label: 'Upload job photos' },
  { key: 'resume_files:read', module: 'Files', label: 'See applicants’ résumés', secondFactor: true },
  { key: 'resume_files:write', module: 'Files', label: 'Upload applicants’ résumés', secondFactor: true },
  { key: 'statement_files:read', module: 'Files', label: 'See bank statements', secondFactor: true },
  { key: 'statement_files:write', module: 'Files', label: 'Upload bank statements', secondFactor: true },
  { key: 'import_files:read', module: 'Files', label: 'See import files' },
  { key: 'import_files:write', module: 'Files', label: 'Upload import files' },
  // Stock (M2-14, RAD-92): the places stock can be. A location has no owner, so the keys name no records.
  { key: 'locations:read', module: 'Stock', label: 'See locations' },
  { key: 'stock:read', module: 'Stock', label: 'See stock on hand, by place, batch and serial' },
  { key: 'locations:write', module: 'Stock', label: 'Add and change locations, switch them off' },
  // HR (M2-14, RAD-92): the employee master. Writing it reaches HR, so it needs the second factor (D-19); reading is a
  // directory whose contact details stay masked without pii:read. Any role may be granted either (Sarthak, 15 Nov).
  { key: 'employees:read', module: 'HR', label: 'See the employee list' },
  { key: 'employees:write', module: 'HR', label: 'Add and change employees, switch them off', secondFactor: true },
  // Cost prices (RC-164): a field marked cost() is masked whole without it, on screens and in exports. Any role may be
  // granted it; admin, owner, accounts and stores start with it (the architect on RAD-92; Sarthak, 15 Nov).
  { key: 'cost:read', module: 'Costs', label: 'See cost prices' },
  // The masters workbook (M2-14, RAD-92): one file of every master the person may read, a sheet each. Any role may be
  // granted it; admin and owner start with it.
  { key: 'masters:export', module: 'Masters', label: 'Export the masters workbook' },
  // Leads (M3-02, RAD-106): granted at `own`, a person sees and captures into their own leads only (E7). A lead's phone
  // and email show with pii:read or leads:contact, which reaches only the leads leads:read lets them open (the architect).
  { key: 'leads:read', module: 'Leads', label: 'See leads and their enquiries', records: ['@radcore/db/crm#leads', '@radcore/db/crm#leadEnquiries', '@radcore/db/crm#leadActivities'] },
  { key: 'leads:write', module: 'Leads', label: 'Add and work leads', records: ['@radcore/db/crm#leads', '@radcore/db/crm#leadEnquiries', '@radcore/db/crm#leadActivities'] },
  { key: 'leads:contact', module: 'Leads', label: 'See the phone and email of the leads they may open', allOnly: true, unmasks: true },
  // D-11 (Sarthak, 20 Nov; the architect on RAD-109): with leads:read and leads:write at `own`, also the leads no one
  // owns, and acting on one takes it. A scope on it means nothing, so it's all-only.
  { key: 'leads:unassigned', module: 'Leads', label: 'See and take unassigned leads', allOnly: true },
  // The CRM's own lists (the architect on RAD-109): kept up by marketing as they work, so no second factor.
  { key: 'leads:setup', module: 'Leads', label: 'Set up lost reasons, follow-up plans and quick replies' },
].map((p) => Object.freeze(p)));

/**
 * The signed-in basics: every role keeps these, so nobody loses their own account, password and sessions to a
 * matrix edit. Every key comes only from a role's grants (RAD-35), so the matrix refuses to drop one. `session:write`
 * and My work's other keys join this list as they're declared.
 */
export const SIGNED_IN_BASICS: readonly string[] = Object.freeze(['session:read']);

/** The keys whose holder needs the second sign-in factor (D-19, RAD-83). */
export const SECOND_FACTOR_KEYS: readonly string[] = Object.freeze(PERMISSIONS.filter((p) => p.secondFactor).map((p) => p.key));

/** Every table some key's records live in: a module service reads one only with the record scope applied (E7). */
export const SCOPED_TABLES: readonly string[] = Object.freeze([...new Set(PERMISSIONS.flatMap((p) => p.records ?? []))].toSorted());
