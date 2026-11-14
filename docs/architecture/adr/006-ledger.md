# ADR-006: Ledger and posting

- Status: accepted
- Date: proposed 2026-11-07; accepted 2026-11-15, after a re-read against what M1 built, with batches and chassis
  numbers (D-15) added (RAD-102, M2-18).
- Ticket: RAD-60 (M2-01). The design basis for M2-03 (journal), M2-04 (numbers), M2-05 (stock), M2-06 (units) and
  M2-07 (books integrity).
- Builds on: [ADR-001](001-layers.md) (lib-accounts owns the journal engine, lib-stock the stock and units engines;
  lib-stock may call lib-accounts, never the reverse), [ADR-002](002-data-access.md) (one transaction per save),
  [ADR-005](005-database.md) (types, append-only ledgers, business date, allocations, error codes).
- Source: v1 `docs/ARCHITECTURE.md` §6 on `erp/main` (the posting table), corrected by the register; Technical
  report Theme 11 and §5.20 (RC-062); CA questions CA-09, CA-19, CA-25, CA-27 and CA-29 to CA-33.

## Context

v1's posting table was right on the common path (Technical report Theme 11). The register found where it wasn't:
- the moving average counted rejected, job-work and demo stock (RC-205);
- the stock ledger had no business date (RC-025);
- negative-stock mode left a value with no units behind it (RC-062);
- one unit status answered three questions (RC-027), and nothing in the database kept a unit on one shelf
  (RC-026);
- manual journals could post to the GST, TDS, GRNI and payroll accounts (RC-093), and journal numbers had gaps
  (RC-206);
- item locks blocked unrelated saves and could deadlock (RC-053);
- the books check compared one total (RC-063);
- a taken-back credit note was costed as a new return (RC-207), and a returned unit kept its sale (RC-128);
- a batch was a label: stock going out named none, a receipt line held one, and two suppliers' batch numbers were
  merged (RC-028, D-15).

This ADR sets the rules M2's engines build. It gives a hand-worked figure for every document (§8), so the tests
assert numbers worked out away from the code (Technical report Theme 8).

## Decision

### 1. Who posts, in one transaction

A document's service, in its own library, posts inside the save's one transaction (ADR-002 §4):
1. it calls lib-stock's stock engine for the movements, and the units engine for serialised units;
2. it calls lib-accounts's journal engine for the entry;
3. the database checks at commit that the two agree (§4, §7).

lib-stock may call lib-accounts (ADR-001 §4), so the stock engine posts its own revaluations (§4). lib-accounts
never calls lib-stock.

**One company (D-02, option A).** RadCore runs one legal entity. No ledger or document row carries a company id.
The company profile (M2-02), its period lock and its financial years are the company's own rows.

**Ledgers belong to the company, not to a person (E7, ADR-001 §6a).** No permission key lists a ledger table in
its `records`: not `journal_entries`, `journal_lines`, `stock_movements`, `stock_positions`, `batches`,
`stock_movement_batches`, `units` or `unit_events`. The engines read whole positions for whoever posts. Own scope
applies to the documents that post to the ledgers, and a ledger report is gated by its own key.

**Types.** The engines take and return lib-common's branded `Money`, `Rate` and `Quantity` (RAD-67). So E6's typed
half covers every sum and comparison in them, and they round half up, as lib-common does.

**One lock order (RC-053, M2-05).** Every posting takes its locks in this order, and no other:
1. the company's period-lock row, and the filed-month lock row (M5-08), `FOR SHARE`. Moving a lock takes
   `FOR UPDATE`, so it waits for the postings in flight (RC-163, M5-09);
2. the documents being posted, `ORDER BY id FOR UPDATE` (ADR-005 §7a);
3. the stock positions, `ORDER BY item_id, location_id FOR UPDATE` (§4), then any new batch rows, created in
   `(item_id, supplier_id, batch_key)` order (§4a);
4. the units, `ORDER BY id FOR UPDATE` (§5);
5. the numbering series (M2-04), last. A number is drawn only once every check has passed, and the series row is
   held for the shortest time.

The stock lock is a row in `stock_positions (item_id, location_id)`, never the item row. A `FOR UPDATE` on `items`
also blocks every insert that references the item by foreign key, which is how v1 blocked unrelated saves. The
first movement for an item and location creates its row (`INSERT … ON CONFLICT DO NOTHING`), then locks it, so the
row always exists before `FOR UPDATE`. M2-05's
concurrency test runs, on PostgreSQL 16, two saves that touch the same items in opposite order, and expects both to
finish.

### 2. Chart of accounts (M2-03)

The system accounts are seeded by an owner migration. Code refers to them by `system_key`, never by name or id.
People add their own accounts (expense heads, each bank account) under the account groups. A system account can be
renamed, but not removed or re-keyed.

An ordinary account has control kind `none` (shown as "-" below).

| Key | Name | Type | Control |
|---|---|---|---|
| `cash` | Cash | asset | - |
| `bank` | Bank (each bank account is an account in this group) | asset | - |
| `debtors` | Debtors | asset | party |
| `stock` | Stock in Hand | asset | stock |
| `gdni` | Goods Delivered Not Invoiced | asset | gdni |
| `input_cgst`, `input_sgst`, `input_igst`, `input_cess` | Input GST | asset | gst |
| `tds_receivable` | TDS Receivable | asset | tds |
| `staff_advances` | Staff Advances | asset | payroll |
| `creditors` | Creditors | liability | party |
| `grni` | Goods Received Not Billed | liability | grni |
| `jw_accrued` | Job Work Charges to be Billed | liability | grni |
| `output_cgst`, `output_sgst`, `output_igst`, `output_cess` | Output GST | liability | gst |
| `tds_payable`, `tcs_payable` | TDS Payable, TCS Payable | liability | tds |
| `salaries_payable`, `pf_payable`, `esic_payable`, `pt_payable` | Payroll payables | liability | payroll |
| `opening_equity` | Opening Balance Equity | equity | opening |
| `retained_earnings` | Retained Earnings | equity | year_close |
| `sales` | Sales | income | - |
| `fx_difference` | Foreign Exchange Gain / Loss | income | - |
| `cogs` | Cost of Goods Sold | expense | - |
| `stock_adjustment` | Stock Adjustment | expense | - |
| `round_off` | Round Off | expense | - |
| `salaries`, `employer_pf`, `employer_esic` | Salaries, Employer PF, Employer ESIC | expense | - |

Reverse charge (M5-03) and the monthly GST settlement (M5-07) add their own accounts (control `gst`) and entry
kinds in their tickets, with a row in the posting rules below.

**A control account takes only its own documents (RC-093).**
- Each control kind lists the entry kinds that may post to it, in `posting_rules (control_kind, entry_kind)`.
  An owner migration seeds it, the runtime login can only read it, and a test checks it equals the lib-common
  constant (like ADR-005's `state_transitions`).
- **No guard column can be left out.** `accounts.control_kind`, and the line's `account_control_kind`,
  `entry_kind` and `business_date`, are all `NOT NULL`. PostgreSQL's default `MATCH SIMPLE` skips a composite
  foreign key when any of its columns is null, so a nullable copy would let a careless insert skip every check
  below.
- Each journal line copies its account's control kind, through a composite foreign key to
  `accounts (id, control_kind)`, and its entry's kind and date, through one to
  `journal_entries (id, kind, business_date)`.
- The line has a generated column, `rule_kind generated always as (nullif(account_control_kind, 'none')) stored`.
  A composite foreign key from `(rule_kind, entry_kind)` to `posting_rules` then refuses any other pair. It's
  skipped only when the account really is ordinary.

So the database, not only the screen, refuses a manual journal (`kind = 'manual'`) on any control account. It also
refuses, for example, a payment that touches Stock in Hand. **Proof (M2-03):** a manual-journal line on Debtors
that leaves `account_control_kind` out fails (`NOT NULL`); one that gives `none` fails the foreign key to
`accounts`; one that gives `party` fails the posting rule.

| Control | Entry kinds that may post to it |
|---|---|
| party | opening, invoice, credit_note, purchase_bill, supplier_return, expense, payment_in, payment_out |
| stock | opening, goods_receipt, purchase_bill, supplier_return, delivery, delivery_return, credit_note, stock_transfer, stock_adjustment, job_work, revaluation |
| gdni | opening, delivery, delivery_return, invoice, credit_note |
| grni | opening, goods_receipt, purchase_bill, supplier_return, job_work |
| gst | opening, invoice, credit_note, purchase_bill, supplier_return, expense |
| tds | opening, invoice, purchase_bill, expense, payment_in, payment_out, payroll, tds_deposit |
| payroll | opening, payroll, payroll_payment, salary_advance, statutory_payment |
| opening | opening |
| year_close | year_close |

Every control kind accepts `opening`, so cut-over can bring in GST credit and dues, TDS, payroll payables and
advances (M5-16). Opening Goods Received Not Billed and Goods Delivered Not Invoiced come in with the receipt or
delivery they belong to (M5-17), so §7's per-line check still holds.

**Party and stock lines.**
- `CHECK ((account_control_kind = 'party') = (party_id is not null))`: every Debtors or Creditors line names its
  party (M2-11), and only those lines do. A party's balance is the sum of its lines.
- `CHECK ((account_control_kind = 'stock') = (item_id is not null and location_id is not null))`, with
  `item_id` and `location_id` both set or both null: every Stock in Hand line names its item and location (§4).

### 3. Journal entries (M2-03, M2-04)

- **Kinds** are a fixed list in lib-common (ADR-005 §4): `opening`, `goods_receipt`, `purchase_bill`,
  `supplier_return`, `delivery`, `delivery_return`, `invoice`, `credit_note`, `payment_in`, `payment_out`,
  `expense`, `stock_transfer`, `stock_adjustment`, `job_work`, `revaluation`, `salary_advance`, `payroll`,
  `payroll_payment`, `statutory_payment`, `tds_deposit`, `transfer` (between own accounts), `manual` and
  `year_close`. A ticket that adds a kind (M5-03, M5-07) adds it here and in the posting rules.
- **One entry per document and kind.** An entry names its document (`source_table`, `source_id`). A unique key on
  `(source_table, source_id, kind, reverses_entry_id)` with `NULLS NOT DISTINCT` refuses posting a document twice.
- **Corrections are reversals** (ADR-005 §7). Cancelling writes a new entry with `reverses_entry_id` set:
  - `reverses_entry_id` is unique, so an entry is reversed at most once;
  - a composite foreign key `(reverses_entry_id, kind)` to `(id, kind)` keeps the original's kind;
  - its lines are the original's with debit and credit swapped, line for line, which the commit check confirms;
  - it is dated with the cancellation's business date (ADR-005 §7b), so the period lock applies to the day of the
    cancellation.
- **Balanced at commit:** each entry's debits equal its credits (RA002, ADR-005 §2).
- **Business date and posting time** are on the entry and on every line (ADR-005 §6). The lines' composite foreign
  key keeps their date equal to the entry's.
- **The lock is checked under the lock** (RC-163). The engine reads the period-lock row `FOR SHARE` before writing
  any line (§1), and the line trigger refuses a business date on or before the lock date (RA003). M2-03 creates
  the financial-year and period-lock rows; M5-09 builds moving the lock and the year close.
- **Gap-free numbers** (RC-206, M2-04). The entry's number comes from its financial year's series, under the series
  row lock, as the last step (§1). There's no database sequence. A save that fails rolls the number back with
  everything else.
- **A manual journal** carries a reason (bounded text, ADR-005 §1) and only ordinary accounts (§2).
- **A closed year's profit and loss** is read without its `year_close` entry, which would otherwise show every
  income and expense account at zero (M5-09, M5-14).

### 4. Stock ledger and valuation (M2-05)

**Movements.** `stock_movements` is append-only (ADR-005 §7). Each row has:
- an item, a location, and the document line it came from;
- `direction`: `in`, `out` or `revalue`. `qty >= 0`, and `qty = 0` exactly when the direction is `revalue`;
- `value` in rupees: at least 0 for `in` and `out`, signed for `revalue`;
- `rate`, to 6 places, on an `in`: what one unit cost;
- `business_date` and `posted_at` (ADR-005 §6);
- on a cancellation's mirror, `reverses_movement_id` (unique), at the same value as the original.

The movements trigger checks the period lock itself (RA003), the same way the journal-line trigger does. A movement
of value 0, such as a free receipt, has no Stock in Hand line, so the line trigger alone would never see its date.

Quantity and value on hand are sums of movements, never stored, so they can't drift from the ledger. This was v1's
strength, and it stays. An index on `(item_id, location_id)` that includes direction, quantity and value serves the
sums.

**One average per item and location.** The moving average is kept per item **and per location**.
- Rejected, job-work and demo stock sit in their own locations (M2-14's location kinds). So they never enter the
  average of the stock that is sold (RC-205).
- **Location kinds** are a fixed list in lib-common, each marked sellable or not:
  - **sellable:** `store`, `stores`, `service_bay` (parts held for fitting, sold on the job's bill) and
    `franchisee` (a franchisee's store is a location of ours, CA-30);
  - **not sellable:** `rejected`, `demo`, `job_work` (one per job worker, F16) and `in_transit`.

  "Sellable" decides where a bill's price difference goes (below).
- A transfer takes value out of the source at the source's average, and puts the same value into the destination.
- Each location's value is the sum of its own movements. Stock by place and books by place therefore agree (§7).

**An issue** of q from a location holding Q units at value V, with Q > 0:
- if q = Q, it takes V exactly, so a location left empty holds no value;
- if q < Q, it takes round(V × q / Q, 2).

**Cost is fixed at posting, in posting order. Reports cut by business date (RC-025).**
- An issue's value is fixed when it posts, from the location's position at that moment. A back-dated receipt
  changes the average from then on. It doesn't re-cost issues already posted, which are append-only.
- A stock report as at a date sums the movements with a business date on or before it. The books as at a date sum
  journal lines the same way. Every movement has its Stock in Hand line with the same business date (below), so
  the two agree at any date.
- An as-at report can show value at zero quantity, because costs follow posting order. For example: a receipt of
  1 at 100.00 dated the 1st; a receipt of 1 at 300.00 dated the 5th, posted second; then an issue dated the 3rd,
  costed from the position at posting (2 at 400.00), takes 200.00. As at the 3rd, the location shows 0 units and
  −100.00. Books and stock still agree. "Zero quantity holds zero value" is a rule of the current position only
  (below, and §7).
- With negative stock off, an issue dated D is refused (RA007) unless the lowest running quantity of its item and
  location, from D onward in business-date order, is at least q. A back-dated issue therefore can't make a later
  day negative. Held stock (M3-13) counts as unavailable to any other order.

**Negative stock (RC-062).** When the company allows it:
- Only a delivery may take a location below zero: that's the case of selling before the goods are entered. A
  transfer, adjustment or job-work challan beyond what's on hand is refused (RA007).
- An issue beyond what's on hand takes what is there at its value, and the rest at an estimate: the location's last
  `in` rate for the item, else the item's purchase price. With neither, the issue is refused.
- A receipt of q at rate r, into a location at quantity Q < 0 and value V, also posts a `revalue` movement and its
  journal, so that afterwards:
  - if Q + q ≤ 0, the units still missing keep their estimate: value = round(V × (Q + q) / Q, 2);
  - if Q + q > 0, the units on hand are at r: value = (Q + q) × r.

  The revaluation is that value minus (V + q × r). A negative revaluation is Dr Cost of Goods Sold, Cr Stock in
  Hand; a positive one is the other way round. So a quantity of zero always carries zero value, and the units sold
  end up at what they really cost (F15).
- **An accepted approximation.** If over-sold goods come back later (a credit note, or a delivery taken back),
  they return at the value they went out at, which includes the estimate. The revaluation is already in Cost of
  Goods Sold, so stock is under by that difference until those units sell again, when their cost is lower by the
  same amount. It needs a return of over-sold goods, and it's bounded by the estimate's error.

**A bill's price difference (M4-03).** A bill's goods amount can differ from what the receipt accrued at the order
rate. The difference d, plus any input GST that can't be claimed (M4-04), is split by what is still on hand: Q is
the item's quantity across the locations of a sellable kind (M2-14), which is where received goods are moved to.
- On hand Q ≥ billed b: all of d goes to stock.
- 0 < Q < b: round(d × Q / b, 2) goes to stock, and the rest to Cost of Goods Sold.
- Q ≤ 0: all of d goes to Cost of Goods Sold.

The stock share is spread over those locations in proportion to their quantity, one `revalue` movement each,
rounded to 2 places, with the last location taking what's left so the shares add up exactly.

**Goods come back at the value they went out at (RC-207).** A credit note that restocks, a delivery taken back
before invoicing, and every cancellation put stock back at the value of the movement they undo, not at today's
average:
- a serialised unit returns at its own value;
- other goods return at the line's unit value, and the last return from a line clears what is left of it exactly.

A later re-delivery is costed afresh.

**Part of a delivery line** (M3-08, M3-09). A delivery line of Q units at value V can be invoiced, or taken back,
a part at a time:
- an invoice for q of them moves round(V × q / Q, 2) from Goods Delivered Not Invoiced to Cost of Goods Sold;
- a take-back of q is a document of its own, a delivery return (entry kind `delivery_return`), which puts q back
  at the same share and releases the same amount from Goods Delivered Not Invoiced;
- whichever comes last clears what's left of the line exactly.

Cancelling the delivery itself is a reversal: it mirrors the whole entry, once, and only while nothing on it has
been invoiced or taken back.

**Checked at commit (RA007).**
- For each document, per item and location, the sum of its movements (in minus out plus revalue) equals the net
  Stock in Hand amount of the lines of **all** its entries for that item and location. A receipt into negative
  stock, for example, has a `goods_receipt` entry and a `revaluation` entry (F15).
- After the save, the **current** position of every touched item and location has value 0 when its quantity is 0,
  and a quantity below 0 only in negative-stock mode.
- The batch checks in §4a.

### 4a. Batches (D-15, M2-05, M4-02)

Every stock item is tracked by batch, with no per-item switch (D-15). A batch carries quantity only: it never has a
value or an average of its own, and §4's valuation runs per item and location as above. This is traceability, not
batch costing.

**A batch is its item's, from one supplier (RC-028).**
- `batches (id, item_id, supplier_id, batch_no, batch_key)`. `supplier_id` is a party, or null for goods that came
  from no supplier. `batch_no` is bounded text (ADR-005 §1), and `batch_key` is generated: the number in upper case,
  without spaces or hyphens, as `chassis_key` is (§5). So "B-17" and "b17" are one batch.
- A unique key on `(item_id, supplier_id, batch_key)` `NULLS NOT DISTINCT`. Two suppliers' "B-17" are two batches,
  where v1 merged them.
- `batches` is append-only (ADR-005 §7). A batch number entered wrongly is put right by moving the quantity to the
  right batch (below), never by an edit, so the history stays as it happened.
- Goods that carry no batch number take the receiving document's own number as their batch, with its supplier: a
  goods receipt, opening stock, a job-work receipt or a count. So every unit of stock can still be traced to the
  document that brought it in.

**A movement's quantity, split by batch.**
- `stock_movement_batches (id, movement_id, item_id, batch_id, qty)`, append-only, with `qty > 0`. `batch_id` is
  null only for "batch unknown" (below).
- `item_id` is the movement's, through a composite foreign key to `stock_movements (id, item_id)`, and a second one
  to `batches (id, item_id)` keeps the batch the same item's. "Batch unknown" has no batch row, so only the first
  applies to it.
- A unique key on `(movement_id, batch_id)` `NULLS NOT DISTINCT`, so a movement names each batch once. One receipt
  line can hold several lots, where v1 held one.
- Kept apart from `stock_movements`, so a movement stays one row per document line. Splitting a line into a
  movement per batch would round each issue on its own (§4) and break the line-share rules for part invoices and
  take-backs.

**Which batch moves.**
- **Out:** the person picking names the batches from the goods. The engine never chooses: there's no first-in,
  first-out or expiry order.
- **Goods coming back** (a credit note that restocks, a delivery return, any cancellation's mirror) return to the
  batches they left with. The engine takes them from the movement being undone, and a part return names which of
  those batches, up to what each sent out less what has come back.
- **A transfer's** `in` carries its `out`'s batches, and a job-work challan's likewise. A job-work receipt's goods
  come in under the receipt's own number, as above.
- **A serialised unit** keeps the batch it was received in (`units.batch_id`, §5), and a movement of serialised
  units carries their batches.

**Negative stock.** A delivery that takes a location below zero (§4) may leave the part beyond what's on hand with
`batch_id` null: the goods' batch has not been received yet, so there's no batch row to name. That part shows as
"batch unknown", below zero. When the goods arrive, their receipt names their real batch, which then holds the
units that were already sold. A count (M4-06) puts it right: an `out` of the real batch and an `in` to "batch
unknown", at one location and at the same value. The Stock in Hand lines would net to zero, so it posts no journal
entry. A wrongly entered batch is moved to the right one the same way.

**Checked at commit (RA007).**
- Each `in` and `out` movement's batch rows add up to its quantity. A `revalue` has none. It's checked for every
  movement the save wrote or gave batch rows to, so rows can't be added later to a movement already complete.
- After the save, no touched batch, at its item and location, is below zero. "Batch unknown" is never above zero,
  and below zero only in negative-stock mode, so an `in` can name it only to bring it back towards zero.
- A movement of serialised units carries, for each batch, as many units as its batch row says. This is counted with
  §5's unit events.

**Locks (RC-053).** The checks need no lock of their own: a batch's quantity at a location is read under that
location's `stock_positions` lock (§1). New batch rows are the one shared key a save writes outside its positions,
because a batch spans locations. A save creates them with `INSERT … ON CONFLICT DO NOTHING`, after its position
locks, in `(item_id, supplier_id, batch_key)` order, with a null `supplier_id` first. Two saves bringing in the same
new lots then wait on their unique keys in the same order, so the waits can't form a cycle. **Proof (M2-05):** two
saves that bring the same two new lots, in opposite order and into different locations, both finish.

**Reading it.**
- `v_batch_on_hand` gives each item, location and batch: `in` rows minus `out` rows. An index on
  `stock_movement_batches (batch_id)` serves it, the checks above and the recall query.
- A recall query follows a batch's `out` rows to their movements' document lines, which are the deliveries, and
  on to the invoices that bill them.
- **Proof (M2-05, GL-021):** two lots received, 100 of lot 1 delivered. The view shows lot 1 as received minus 100,
  and the recall query by lot 1 returns the delivery and its invoice.

### 5. Units by serial (M2-06)

An item is serialised by its flag (M2-10); only serialised items have units. v1's one status column becomes
separate columns (RC-027):

| Column | Answers | Values |
|---|---|---|
| `ownership` | Whose is it? | `ours`, `customer`, `gone` (returned to the supplier, or scrapped) |
| `condition` | What state is it in? | `new`, `demo`, `used`, `damaged` |
| `promised_to` | Is it promised? | an order line, or null |
| `location_id` | Where is it? | a location, or null while it's with a customer |
| `sale_line_id` | Which sale is it on? | the delivery line it left on, or null |
| `batch_id` | Which batch did it come in? | the batch it was received in (§4a), or null for a customer's own unit |
| `chassis_no` | Which vehicle is it? | its chassis number, when its item has one (below), or null |

So a customer's own scooter in the service bay (`customer`, at the service bay) is never counted as stock and can't
be sold. A returned unit's sale is cleared (RC-128), which ends the customer warranty that came from it.

- **One row per serial.** A unique key on `(item_id, serial_key)`, where `serial_key` is a generated column: the
  serial in upper case without spaces. A unit has one `location_id`, so it can't be on two shelves.
- **Events are the only way in.** `unit_events` is append-only (ADR-005 §7). A trigger applies each event to its
  `units` row, and the runtime login has no `INSERT` or `UPDATE` on `units` (M1-06). So every path goes through
  the units engine (RC-026).
- **Event kinds** are a fixed list in lib-common: `received`, `moved`, `reserved`, `released`, `delivered`,
  `delivery_returned`, `returned` (on a credit note), `returned_to_supplier`, `sent_to_job_work`,
  `received_from_job_work`, `condition_changed`, `chassis_recorded`, `taken_in`, `handed_back` and `scrapped`.
- **Each event is allowed only from certain states.** `unit_event_rules (kind, from_ownership)` is seeded by an
  owner migration, read-only to the runtime login, and checked against lib-common, like the posting rules. A refused event raises RA008. For example:
  - `received` needs no row yet, or `gone`, so a sold serial can't be received again at goods-receipt QC (RC-128);
  - `delivered` needs `ours`, and no promise to another order line;
  - `taken_in`, for service, needs no row yet (a scooter we never sold) or `customer`.
- **Units agree with stock** (RAD-64). An event names up to two stock movements: `out_movement_id`, the movement
  that takes the unit out of where it was, and `in_movement_id`, the one that puts it where it goes.
  - Which ones a kind needs is fixed:
    - **both**: `moved`, `sent_to_job_work`, `received_from_job_work`;
    - **in only**: `received`, `returned`, `delivery_returned`;
    - **out only**: `delivered`, `returned_to_supplier`, `scrapped`;
    - **neither**: `reserved`, `released`, `condition_changed`, `chassis_recorded`, `taken_in`, `handed_back`.

    A CHECK on the kind holds this.
  - Each reference points at a movement of the right direction: a composite foreign key from
    `(out_movement_id, 'out')` and `(in_movement_id, 'in')`, through generated constant columns, to
    `stock_movements (id, direction)`. The trigger also checks that the out movement is at the unit's old location
    and the in movement at its new one (RA008).
  - At commit, each `out` movement of a serialised item has as many events naming it as `out_movement_id` as its
    quantity, and each `in` movement as many naming it as `in_movement_id` (RA007). So a transfer of one unit is one
    event, counted once on each of its two movements.
  - The books check (§7) also compares, per item and location, the units we own there with the quantity on hand.
- **A unit's batch** is named by its `received` event, which must be one of the batches on its `in` movement, and
  it never changes (§4a). A composite foreign key to `batches (id, item_id)` keeps it the unit's own item's. A unit
  taken in for service (`taken_in`) isn't our stock and has none.

**Chassis numbers (D-15, M2-06, M2-10).** Some vehicles need a chassis number for their registration. Which ones
is data, not code: each item has `has_chassis` (`boolean NOT NULL DEFAULT false`), set by an admin, so a new
product can take chassis numbers without a code change (Sarthak, 14 Nov). `CHECK (not has_chassis or
serialised)`: only a serialised item can have it.
- `units.chassis_no` is bounded text, and `chassis_key` a generated column: the number in upper case, without
  spaces or hyphens. A unique key on `chassis_key` across all items, where it's set: a chassis number names one
  vehicle.
- **`received`** must carry a chassis number when its item has the flag, and the trigger refuses one without it
  (RA008). On `taken_in`, for a customer's vehicle in for service, it's optional.
- **`chassis_recorded`**, from `ours` only and with a reason (`reason()`, RAD-36), records a number that's missing,
  such as on a unit received before its item was flagged, or corrects one entered wrongly. The units audit trigger
  keeps the old value and the new.
- **`delivered`** is refused for a unit whose item has the flag and which has no chassis number (RA008), so every
  such vehicle leaves with one for its papers.
- **Turning the flag on** applies from then on: every later `received` needs a number, and so does every later
  `delivered`. Units already in stock get theirs through `chassis_recorded` before they can leave. Units already
  with customers are untouched.
- **Turning it off** is refused while any unit of the item, in stock or sold, has a chassis number. The item
  service answers `chassis_numbers_recorded`, and a trigger on `items` refuses it too (RA008). Once a vehicle has
  its number, the product is a registered vehicle, and turning the flag off would let the next one leave without
  one. A flag set by mistake can still be turned off before any number is entered.

### 6. What each document posts

"Built by" names the document's own ticket. The engines it calls are M2-03 (journal), M2-05 (stock) and M2-06
(units). GST is CGST and SGST within the state, and IGST between states: the company's state comes from its
profile (M2-02), and the place of supply decides (CA-08). A line's rate is the one in force on its business date
(M2-12).

| Document | Stock ledger | Books | Built by |
|---|---|---|---|
| Opening stock | in, at the agreed cut-over value | Dr Stock in Hand, Cr Opening Balance Equity | M5-16 |
| Opening party and account balances | - | Dr or Cr the party or account, against Opening Balance Equity | M5-16, M5-17 |
| Goods receipt, after QC | accepted goods into their location, rejects into Rejected, at the order rate | Dr Stock in Hand, Cr Goods Received Not Billed | M4-02 |
| Purchase bill for goods | the price difference, as a revaluation (§4) | Dr Goods Received Not Billed (what was accrued), Dr Input GST (where claimable, M4-04), the difference (§4), Cr Creditors, Cr TDS Payable (where due at the bill, M5-10) | M4-03 |
| Purchase bill for services, or an expense | - | Dr the expense, Dr Input GST (where claimable, M5-02), Cr Creditors, Bank or Cash, Cr TDS Payable | M4-03, M5-02 |
| Supplier return, not yet billed | out of Rejected, at its value | Dr Goods Received Not Billed, Cr Stock in Hand | M4-05 |
| Supplier return, billed (a debit note) | out of Rejected, at its value | Dr Creditors, Cr Stock in Hand, Cr Input GST | M4-05 |
| Delivery | out, at the location's average | Dr Goods Delivered Not Invoiced, Cr Stock in Hand | M3-08 |
| Delivery return (taken back before invoicing, all or part) | in, at the line's share of the value it went out at (§4) | Dr Stock in Hand, Cr Goods Delivered Not Invoiced | M3-08 |
| Invoice | - | Dr Debtors, Cr Sales, Cr Output GST and cess, Cr TCS Payable (if due), Dr or Cr Round Off; and, for the delivered lines it bills, Dr Cost of Goods Sold, Cr Goods Delivered Not Invoiced | M3-09 |
| Quick bill at the counter | the delivery's | the delivery's and the invoice's, and the payment's | M3-11 |
| Credit note, value only (price or discount) | - | Dr Sales, Dr Output GST, Cr Debtors | M3-10 |
| Credit note with goods back | in, at the value they went out at (§4) | the invoice lines in reverse; Dr Stock in Hand, Cr Cost of Goods Sold | M3-10 |
| Payment received | - | Dr Bank or Cash, Dr TDS Receivable (if the customer held some back), Cr Debtors; allocations (ADR-005 §7a) | M3-12 |
| Payment made | - | Dr Creditors, Cr Bank or Cash, Cr TDS Payable (only on an advance paid before any bill) | M3-12 |
| Foreign bill paid at another rate | - | the difference, to Foreign Exchange Gain / Loss | M4-09 |
| Stock transfer | out of one location at its average, into another at the same value | Dr Stock in Hand (to), Cr Stock in Hand (from), by item and location | M4-06 |
| Stock count or adjustment | in or out, at the location's average | Dr or Cr Stock in Hand, against Stock Adjustment | M4-06 |
| Job work challan | from Stores to the job worker's location, at the same value | Dr Stock in Hand (job worker), Cr Stock in Hand (Stores) | M4-07 |
| Job work receipt | inputs out of the job worker's location; goods made, in at the inputs used plus the charge; unused inputs back at their value | the charge: Dr Stock in Hand, Cr Job Work Charges to be Billed; lost inputs: Dr Stock Adjustment, Cr Stock in Hand | M4-07 |
| Job worker's bill | any difference over the accrual, as a revaluation (§4) | Dr Job Work Charges to be Billed (what was accrued), the difference (§4), Dr Input GST, Cr Creditors, Cr TDS Payable | M4-07 |
| Receipt into negative stock | a revaluation (§4) | Dr Cost of Goods Sold, Cr Stock in Hand, or the reverse | M2-05 |
| Salary advance | - | Dr Staff Advances, Cr Bank or Cash | M6-07 |
| Salaries approved | - | Dr Salaries, Dr Employer PF and ESIC, Cr Salaries Payable, Cr PF, ESIC, PT and TDS Payable, Cr Staff Advances (recovered) | M6-06, M6-08 |
| Salaries paid | - | Dr Salaries Payable, Cr Bank | M6-07 |
| PF, ESIC or PT paid over | - | Dr the payable, Cr Bank | M6-08, M6-09 |
| TDS paid over | - | Dr TDS Payable, Cr Bank | M5-10 |
| Transfer between own accounts | - | Dr the account it went to, Cr the account it came from | M5-19 |
| Manual journal | - | ordinary accounts only (§2), with a reason | M2-03 |
| Year-end close | - | every income and expense account's balance for the year, emptied into Retained Earnings, dated 31 March | M5-09 |
| Cancelling any of these | the mirror of its movements, at the same values | the mirror of its entry, dated the cancellation's business date | each document's ticket |

**Changes from v1's table:**
- **Cost of goods sold moves at the invoice, not at the delivery.** v1 posted it at delivery. Goods can leave
  before the invoice (CA-09, M3-01), so across a month or year end the cost fell in one period and the sale in the
  next. The delivery now parks the cost in Goods Delivered Not Invoiced, and the invoice moves it to Cost of Goods
  Sold, the same way Goods Received Not Billed works when buying. If M3-01 makes invoice-at-delivery the rule, both
  happen in one save and nothing changes for the person at the counter.
- **An unbilled reject goes back against Goods Received Not Billed**, not Creditors: there's no bill to debit
  (M4-05 debits only billed rejects).
- **TDS is deducted at the bill** where the section says "on credit or payment, whichever is earlier" (RC-060,
  CA-19), not at payment.
- **Employer PF and ESIC** are expense lines of their own. v1's entry had none.
- **Stock transfers and job-work challans post** a Stock in Hand line per location, so books by place agree with
  stock by place (§7). The total doesn't move.

### 7. Books integrity (M2-07)

The check runs in one read-only transaction at `REPEATABLE READ`, so every figure comes from the same snapshot
(RC-063). It compares, as at a business date:
- the trial balance: debits equal credits;
- Stock in Hand, per item and location: the books equal the stock ledger;
- Goods Received Not Billed, per receipt line: accrued, minus billed, minus returned unbilled, equals the books;
- Goods Delivered Not Invoiced, per delivery line: delivered, minus invoiced, minus taken back;
- Job Work Charges to be Billed, per job-work receipt;
- Debtors and Creditors, per party: the ledger equals the documents, minus allocations and credit applications
  (ADR-005 §7a).

And, on the **current** position only (costs follow posting order, so an as-at position can hold a residue, §4):
- every location at quantity 0 holds value 0;
- serialised items: the units we own at each location equal the quantity there (`units` holds the current state);
- batches: at each item and location, the batches' quantities add up to the quantity there (§4a).

Every journey test ends with this check, and the parallel month compares against it (M5-18).

### 8. Hand-worked figures

Each figure starts from the position it states, so its test runs on its own (RC-222). M2-08's mutation tests and
M2-09's fault injection use the same figures. The items are:
- **SCOOTER:** an electric scooter, serialised, unit Nos, GST 5% (CGST 2.5%, SGST 2.5%);
- **PAD:** a brake-pad set, not serialised, unit Nos, GST 18%;
- **KIT** and **FRAME:** a frame kit, and the painted frame a job worker makes from one.

The company and every party are in Maharashtra, so the tax is CGST and SGST. The tax rates, TDS sections and
payroll figures are examples for the arithmetic; M2-12, M5-10 and M6-08 pin the real ones. "Dr" and "Cr" amounts
are in rupees; quantities are units.

**F1. Opening stock** (M5-16). Start: nothing. 2 SCOOTER at 60,000.00 each, into Stores.
- Movement: Stores in 2, value 120,000.00, rate 60,000.00.
- Entry `opening`: Dr Stock in Hand (SCOOTER, Stores) 120,000.00; Cr Opening Balance Equity 120,000.00.
- Units S-0001 and S-0002: a `received` event each; ownership `ours`, condition `new`, location Stores.
- After: Stores 2 at 120,000.00; average 60,000.00.
- Variant, a customer owing 5,000.00 at cut-over: Dr Debtors (customer) 5,000.00; Cr Opening Balance Equity
  5,000.00. (If the invoice itself must exist, CA-28, M5-17 brings it in instead.)
- Variant, input GST carried forward and TDS not yet paid over at cut-over: Dr Input CGST 1,500.00; Dr Input SGST
  1,500.00; Cr TDS Payable 2,000.00; Cr Opening Balance Equity 1,000.00. Allowed, because every control kind
  accepts `opening` (§2).

**F2. Goods receipt with a reject** (M4-02). Start: SCOOTER at Stores, 2 at 120,000.00. 3 come in at the order
rate of 62,000.00. QC accepts 2 and rejects 1.
- Movements: Stores in 2, 124,000.00; Rejected in 1, 62,000.00.
- Entry `goods_receipt`: Dr Stock in Hand (Stores) 124,000.00; Dr Stock in Hand (Rejected) 62,000.00; Cr Goods
  Received Not Billed 186,000.00.
- Units: S-0003 and S-0004 `received`, ownership `ours`, condition `new`, location Stores; S-0005 `received`,
  ownership `ours`, condition `damaged`, location Rejected. Three events for three units moved in (RA007).
- After: Stores 4 at 244,000.00, average 61,000.00; Rejected 1 at 62,000.00. Counting the reject, as v1 did, the
  average would be 306,000.00 / 5 = 61,200.00 (RC-205).

**F3. A bill above the order rate** (M4-03). Start: as after F2. The supplier bills the 2 accepted at 62,500.00
each, plus GST.
- Goods 125,000.00; accrued 124,000.00; difference 1,000.00. Stores is the only sellable location holding SCOOTER,
  with 4, at least the 2 billed, so all of it goes to stock there.
- Movement: Stores revalue +1,000.00.
- Entry `purchase_bill`: Dr Goods Received Not Billed 124,000.00; Dr Stock in Hand (Stores) 1,000.00; Dr Input
  CGST 3,125.00; Dr Input SGST 3,125.00; Cr Creditors (supplier) 131,250.00.
- After: Stores 4 at 245,000.00, average 61,250.00. Goods Received Not Billed is 62,000.00, the reject.
- Variant: had the sellable locations held only 1 between them, 500.00 would go to stock and 500.00 to Cost of
  Goods Sold.
- Variant: had Stores held 1 and Showroom 3, all 1,000.00 would go to stock: 250.00 at Stores and 750.00 at
  Showroom, one `revalue` movement and one Stock in Hand line each.

**F4. Supplier return** (M4-05). Start: Rejected 1 at 62,000.00, not billed.
- Movement: Rejected out 1, 62,000.00.
- Entry `supplier_return`: Dr Goods Received Not Billed 62,000.00; Cr Stock in Hand (Rejected) 62,000.00.
- Unit S-0005: a `returned_to_supplier` event; ownership `gone`, no location.
- After: Rejected 0 at 0.00; Goods Received Not Billed 0.00.
- Variant, the reject billed at 62,000.00 plus GST: Dr Creditors 65,100.00; Cr Stock in Hand (Rejected)
  62,000.00; Cr Input CGST 1,550.00; Cr Input SGST 1,550.00.

**F5. Delivery** (M3-08). Start: SCOOTER at Showroom, 4 at 245,000.00 (average 61,250.00). Unit S-0003 is
delivered.
- Movement: Showroom out 1, round(245,000.00 × 1 / 4, 2) = 61,250.00.
- Entry `delivery`: Dr Goods Delivered Not Invoiced 61,250.00; Cr Stock in Hand (Showroom) 61,250.00.
- Unit S-0003: a `delivered` event; ownership `customer`, no location, `sale_line_id` the delivery line.
- After: Showroom 3 at 183,750.00, average still 61,250.00.
- Variant, taken back before invoicing: a delivery return. Showroom in 1 at 61,250.00. Entry `delivery_return`: Dr
  Stock in Hand (Showroom) 61,250.00; Cr Goods Delivered Not Invoiced 61,250.00. Unit S-0003: `delivery_returned`;
  ownership `ours`, location Showroom, sale cleared.

**F6. Invoice** (M3-09). Start: F5's delivery, not yet invoiced. Taxable 80,000.00 at 5%.
- No movement.
- Entry `invoice`: Dr Debtors (customer) 84,000.00; Cr Sales 80,000.00; Cr Output CGST 2,000.00; Cr Output SGST
  2,000.00; Dr Cost of Goods Sold 61,250.00; Cr Goods Delivered Not Invoiced 61,250.00. Debits and credits are
  both 145,250.00.
- After: Goods Delivered Not Invoiced 0.00; the customer owes 84,000.00.

**F7. Counter sale with a round-off** (M3-11). Start: PAD at Showroom, 10 at 2,000.00. 3 sold at 345.00, delivered
and invoiced in one save.
- Movement: Showroom out 3, 600.00.
- Entry `delivery`: Dr Goods Delivered Not Invoiced 600.00; Cr Stock in Hand (Showroom) 600.00.
- Invoice figures: taxable 1,035.00; CGST at 9%, 93.15; SGST at 9%, 93.15; lines 1,221.30; round-off −0.30; total
  1,221.00. The header equals the lines plus the round-off, and the round-off is under 1 (ADR-005 §2).
- Entry `invoice`: Dr Debtors 1,221.00; Dr Round Off 0.30; Cr Sales 1,035.00; Cr Output CGST 93.15; Cr Output
  SGST 93.15; Dr Cost of Goods Sold 600.00; Cr Goods Delivered Not Invoiced 600.00. Debits and credits are both
  1,821.30.
- After: Showroom 7 at 1,400.00.

**F8. Payment received** (M3-12). Start: F6's invoice, 84,000.00 owed.
- Entry `payment_in`: Dr Bank 84,000.00; Cr Debtors (customer) 84,000.00.
- Allocation: apply 84,000.00 to the invoice, which is then paid.
- Variant, the customer holds back TDS of 0.1% on 80,000.00 (section 194Q): Dr Bank 83,920.00; Dr TDS Receivable
  80.00; Cr Debtors 84,000.00; allocation 84,000.00.

**F9. Credit note with the scooter back** (M3-10). Start: F6's invoice, unpaid; S-0003 went out at 61,250.00.
Stores holds 3 SCOOTER at 186,000.00 (average 62,000.00). The customer returns S-0003 unused, to Stores.
- Movement: Stores in 1 at 61,250.00, the value it went out at, not 62,000.00.
- Entry `credit_note`: Dr Sales 80,000.00; Dr Output CGST 2,000.00; Dr Output SGST 2,000.00; Cr Debtors
  (customer) 84,000.00; Dr Stock in Hand (Stores) 61,250.00; Cr Cost of Goods Sold 61,250.00.
- Credit application: 84,000.00 against the invoice.
- Unit S-0003: `returned`; ownership `ours`, condition `new` (from its return QC), location Stores, sale cleared
  (RC-128).
- After: Stores 4 at 247,250.00, average 61,812.50. The credit note settles the invoice.
- Variant, a discount of 1,000.00 on the taxable value, as a value-only credit note: Dr Sales 1,000.00; Dr Output
  CGST 25.00; Dr Output SGST 25.00; Cr Debtors 1,050.00. No movement.

**F10. Invoice cancelled on a later day** (M3-10). Start: F6's invoice dated 5 June 2026, unpaid. It's cancelled
on 10 June 2026.
- Entry `invoice`, with `reverses_entry_id` set to F6's entry, dated 10 June 2026: Dr Sales 80,000.00; Dr Output
  CGST 2,000.00; Dr Output SGST 2,000.00; Cr Debtors 84,000.00; Dr Goods Delivered Not Invoiced 61,250.00; Cr Cost
  of Goods Sold 61,250.00.
- After: the delivery is open again (Goods Delivered Not Invoiced 61,250.00), to be invoiced again or taken back.
- A period lock up to 5 June doesn't stop the cancellation. A lock up to 10 June does (RA003).

**F11. A foreign bill paid at another rate** (M4-09). Start: Creditors (foreign supplier) 83,000.00, from a bill
of USD 1,000.0000 at 83.00000000. It's paid when the rate is 84.00000000.
- Entry `payment_out`: Dr Creditors 83,000.00; Dr Foreign Exchange Gain / Loss 1,000.00; Cr Bank 84,000.00.
- After: the supplier's balance is 0 in rupees and in dollars.

**F12. An expense with TDS** (M5-02, M5-10). A professional fee of 60,000.00 plus 18% GST, paid by bank, with TDS
of 10% under section 194J on the fee before GST.
- Entry `expense`: Dr Professional Fees 60,000.00; Dr Input CGST 5,400.00; Dr Input SGST 5,400.00; Cr Bank
  64,800.00; Cr TDS Payable 6,000.00. Debits and credits are both 70,800.00.

**F13. Transfer to demo** (M4-06). Start: SCOOTER at Stores, 4 at 245,000.00 (average 61,250.00); Demo empty.
- Movements: Stores out 1, 61,250.00; Demo in 1, 61,250.00.
- Entry `stock_transfer`: Dr Stock in Hand (Demo) 61,250.00; Cr Stock in Hand (Stores) 61,250.00.
- Unit S-0004: one `moved` event, with `out_movement_id` the Stores movement and `in_movement_id` the Demo one;
  location Demo, condition `demo`, ownership still `ours`. Each movement has quantity 1 and one event naming it
  (RA007).
- After: Stores 3 at 183,750.00; Demo 1 at 61,250.00.
- A receipt of 1 at 63,000.00 into Stores then makes Stores' average (183,750.00 + 63,000.00) / 4 = 61,687.50.
  The demo unit stays at 61,250.00 (RC-205).

**F14. A count with a shortage** (M4-06). Start: PAD at Showroom, 7 at 1,400.00. The count finds 6.
- Movement: Showroom out 1, 200.00.
- Entry `stock_adjustment`: Dr Stock Adjustment 200.00; Cr Stock in Hand (Showroom) 200.00.
- After: Showroom 6 at 1,200.00.

**F15. Negative stock, then the goods arrive** (M2-05). Start: PAD at Showroom, 7 at 1,400.00; last `in` rate
200.00; negative stock allowed.
- A sale of 10: Showroom out 10 at 2,000.00, which is the 7 on hand at 1,400.00 plus 3 at the estimate of 200.00.
  Entry `delivery`: Dr Goods Delivered Not Invoiced 2,000.00; Cr Stock in Hand (Showroom) 2,000.00. Showroom is
  then −3 at −600.00.
- A receipt of 5 at 240.00: Showroom in 5, 1,200.00. Q + q = 2, above 0, so the target value is 2 × 240.00 =
  480.00, and the revaluation is 480.00 − (−600.00 + 1,200.00) = −120.00.
  - Movement: Showroom revalue −120.00.
  - Entry `goods_receipt`: Dr Stock in Hand (Showroom) 1,200.00; Cr Goods Received Not Billed 1,200.00.
  - Entry `revaluation`: Dr Cost of Goods Sold 120.00; Cr Stock in Hand (Showroom) 120.00.
- After: Showroom 2 at 480.00. Once the sale is invoiced, the ten pads have cost 2,000.00 + 120.00 = 2,120.00,
  which is 1,400.00 + 3 × 240.00: what they really cost.
- Variant, a receipt of exactly 3: the target is 0.00; the revaluation is 0.00 − (−600.00 + 720.00) = −120.00;
  Showroom ends at 0 and 0.00.
- Variant, a receipt of 2: Q + q = −1; the target is round(−600.00 × −1 / −3, 2) = −200.00; the revaluation is
  −200.00 − (−600.00 + 480.00) = −80.00. The one pad still missing keeps its estimate of 200.00.

**F16. Job work** (M4-07). Start: KIT at Stores, 5 at 5,000.00; no FRAME.
- Challan, 4 KIT to the job worker:
  - Movements: Stores out 4, 4,000.00; Job worker in 4, 4,000.00.
  - Entry `job_work`: Dr Stock in Hand (KIT, job worker) 4,000.00; Cr Stock in Hand (KIT, Stores) 4,000.00.
- Receipt: 3 FRAME made from 3 KIT; 1 KIT lost; a charge of 150.00 a frame.
  - Movements: job worker out 4 KIT, 4,000.00; Stores in 3 FRAME, 3,450.00 (3,000.00 of kits used plus the 450.00
    charge, so 1,150.00 a frame).
  - Entry `job_work`: Dr Stock in Hand (FRAME, Stores) 3,450.00; Dr Stock Adjustment 1,000.00; Cr Stock in Hand
    (KIT, job worker) 4,000.00; Cr Job Work Charges to be Billed 450.00. Debits and credits are both 4,450.00.
- The job worker's bill: 450.00 plus 18% GST, with TDS of 1% under section 194C (the year's threshold is already
  crossed).
  - Entry `purchase_bill`: Dr Job Work Charges to be Billed 450.00; Dr Input CGST 40.50; Dr Input SGST 40.50; Cr
    Creditors 526.50; Cr TDS Payable 4.50. Debits and credits are both 531.00.
- After: KIT at Stores, 1 at 1,000.00; FRAME at Stores, 3 at 3,450.00; Job Work Charges to be Billed 0.00.

**F17. Payroll** (M6-06 to M6-08). One employee: gross 30,000.00, of which basic is 15,000.00. Employee PF is 12%
of basic, 1,800.00, and employer PF is the same. Professional tax is 200.00 and salary TDS 500.00. An advance of
1,000.00 is recovered. ESIC doesn't apply above its wage ceiling.
- The advance, earlier: entry `salary_advance`: Dr Staff Advances 1,000.00; Cr Bank 1,000.00.
- Approval: entry `payroll`: Dr Salaries 30,000.00; Dr Employer PF 1,800.00; Cr Salaries Payable 26,500.00; Cr PF
  Payable 3,600.00; Cr PT Payable 200.00; Cr TDS Payable 500.00; Cr Staff Advances 1,000.00. Debits and credits
  are both 31,800.00.
- Payment: entry `payroll_payment`: Dr Salaries Payable 26,500.00; Cr Bank 26,500.00.
- PF paid over: entry `statutory_payment`: Dr PF Payable 3,600.00; Cr Bank 3,600.00.

**F18. TDS paid over** (M5-10). Start: TDS Payable 6,000.00, from F12.
- Entry `tds_deposit`: Dr TDS Payable 6,000.00; Cr Bank 6,000.00.

**F19. Cash paid into the bank** (M5-19).
- Entry `transfer`: Dr Bank 10,000.00; Cr Cash 10,000.00.

**F20. Year-end close** (M5-09). Start, for the year to 31 March 2027: Sales Cr 1,035.00; Cost of Goods Sold Dr
600.00; Round Off Dr 0.30; Professional Fees Dr 60,000.00.
- Entry `year_close`, dated 31 March 2027: Dr Sales 1,035.00; Cr Cost of Goods Sold 600.00; Cr Round Off 0.30; Cr
  Professional Fees 60,000.00; Dr Retained Earnings 59,565.30. Debits and credits are both 60,600.30.
- After: every income and expense account is 0.00 for that year, and Retained Earnings carries the loss of
  59,565.30. Balance-sheet accounts aren't touched. A balance is a sum of lines, so the new year needs no opening
  entry.

**F21. Batches** (M2-05, M4-02, M3-08). Start: no PAD at Stores. A receipt from supplier A of 10 PAD at 200.00:
6 from lot L1 and 4 from lot L2. Supplier B's own lot L1 is already in another location.
- Movement: Stores in 10, 2,000.00. Its batch rows: (A, L1) 6; (A, L2) 4. B's L1 is another batch, unique on
  item, supplier and number.
- Entry `goods_receipt`: Dr Stock in Hand (Stores) 2,000.00; Cr Goods Received Not Billed 2,000.00. The batches
  don't change it.
- A delivery of 7, picked as 6 of L1 and 1 of L2: Stores out 7, round(2,000.00 × 7 / 10, 2) = 1,400.00, one
  movement with batch rows (A, L1) 6 and (A, L2) 1. The value is the item's average, whatever the batches.
- After: Stores 3 at 600.00. `v_batch_on_hand`: (A, L1) 0, (A, L2) 3. A recall of (A, L1) returns this delivery,
  then the invoice that bills it.
- Variant, a pick of 7 from L1: refused (RA007), since L1 holds 6.
- Variant, a delivery return of 2 of the 7: it names (A, L1) or (A, L2), up to 6 and 1, and nothing else.
- Variant, an `in` of 1 to "batch unknown" while it's at 0: refused (RA007), since it would go above zero.
- Variant, negative stock allowed and, instead of the 7, a delivery of 12 from the 10 on hand, the 2 extra not yet
  received: the batch rows are
  (A, L1) 6, (A, L2) 4, and unknown 2, so unknown is −2. A receipt of 5 of lot L3 comes in later, and the count
  finds 3 of L3 on the shelf: it moves 2 out of (A, L3) and into unknown, at the same value, with no entry. After:
  (A, L3) 3, unknown 0.

**F22. A unit with a chassis number** (M2-06). SCOOTER's item has `has_chassis` set.
- S-0006's `received` event without a chassis number: refused (RA008).
- With `MA1EXAMPLE0000001`: accepted, and `chassis_key` is the same. Another unit, of any item, received with
  `ma1-example-0000001` is refused, since its key is the same.
- S-0002 came in before the flag was set and has none. Its `delivered` event is refused (RA008) until a
  `chassis_recorded` event, with a reason, gives it one.
- Turning SCOOTER's flag off now is refused (`chassis_numbers_recorded`, RA008): S-0006 has a number.

## Consequences

- Each document's ticket (M3 to M6) builds its row of §6 and asserts its figure from §8. A document that isn't here
  adds a row and a figure to this ADR in its own PR.
- The database refuses a manual journal on a control account, a document posted twice, unbalanced entries, stock
  that disagrees with the books for a document, a batch taken below zero, a unit event its state doesn't allow,
  and a flagged vehicle received or delivered without its chassis number. The error codes are ADR-005 §9's RA007
  (stock and batches) and RA008 (units).
- Stock value is per location, so Cost of Goods Sold depends on which location a sale ships from. Goods normally
  reach the showroom by transfer from Stores, at Stores' average, so the difference is small.
- Sums over movements are read on every posting. At a dealership's volumes that's one indexed range read per item
  and location [estimated]. If it gets slow, a per-day closing snapshot can be added without changing a rule.

**Questions for the CA** (docs/source/10-Questions-for-CA-and-Counsel.md). The design works either way, but these
fix figures:
- CA-09: whether goods may leave before the invoice, which decides how long Goods Delivered Not Invoiced stays open.
- CA-25 and CA-27: that a moving average per location is acceptable for the audit, and against Vyapar's basis at
  cut-over.
- CA-29: whether demo units are stock (as here: a Demo location) or a fixed asset.
- CA-30 and CA-31: job work and franchisee stock. A franchisee's store is a location of ours here.
- CA-19: TDS at the bill, and CA-05: input GST that can't be claimed goes into the cost.

## Alternatives considered

- **One average per item across all locations.** That's v1's way. Rejected, demo and job-work stock then have to be
  kept out by special cases (RC-205), and a location's value can't be compared with the books. Rejected.
- **FIFO.** It's more work for every issue, and the client's books (Vyapar, CA-27) and v1 both used an average. A
  FIFO option stays open if the CA asks for it (CA-25).
- **Cost of goods sold at delivery, as v1.** It mismatches cost and sale across a period end whenever goods leave
  before the invoice. Goods Delivered Not Invoiced costs one account and one control kind.
- **Stored stock balances.** They're faster to read, but they can drift from the ledger, which is the problem the
  books check exists to find. Sums stay the source; a snapshot can be added later as a cache.
- **Control accounts guarded by the service only.** That's v1's way, and a manual journal still reached them
  (RC-093). The composite key puts the rule in the database.
- **Batch costing,** where each batch keeps its own value. D-15 chose traceability only, so a batch carries
  quantity and the average stays per item and location.
- **A batch column on `stock_movements`, one movement per batch.** It's one table fewer, but a line spread over
  two batches would be two issues, each rounded on its own (§4), and the part-invoice and take-back shares would
  have to be worked across several movements.
- **A list of chassis variants in code.** Each new product would need a release. The item's flag is data (D-15).
