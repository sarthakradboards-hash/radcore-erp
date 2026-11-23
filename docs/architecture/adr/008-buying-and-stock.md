# ADR-008: Buying and stock documents

- Status: proposed
- Date: 2026-11-22
- Ticket: the M4 plan's ADR-008 (approved by Sarthak, 22 Nov). The design basis for M4-01 (purchase orders), M4-02
  (goods receipt and QC), M4-03 (purchase bills), M4-04 (input credit), M4-05 (supplier returns and debit notes),
  M4-06 (transfers, counts and adjustments) and M4-07 (job work). M4-08 and M4-09 moved to M9 (D-10).
- Builds on: [ADR-005](005-database.md) §6 (business date), §7a (allocations), §7b (posted documents);
  [ADR-006](006-ledger.md) §1 (lock order), §2 (accounts), §4 and §4a (stock, batches), §5 (units), §6 (what each
  document posts), §8 (F2, F3, F4, F13, F14, F16, F21, F22); [ADR-007](007-sales-documents.md) §2 to §4 (guards,
  numbers, dates), whose conventions this ADR follows; [ADR-001](001-layers.md) §6a (record scope), §8b (approvals).
- Source: the register (RC-014, RC-023, RC-028, RC-056, RC-123, RC-124, RC-129, RC-130, RC-172, RC-205); plan flows 5
  and 7; CA-04, CA-51 and CA-52 (docs/source/10-Questions-for-CA-and-Counsel.md); D-10, D-15, D-21.

## Context

In v1 a supplier bill posted the moment it was typed, with no file and no draft (RC-172). It was never held against
the order or the goods received, its tax was recomputed at the order's rate, and a price difference sat in Goods
Received Not Billed for ever (RC-056). Duplicate bills were caught wrongly both ways, and a bill kept neither the
supplier's invoice date nor their GSTIN (RC-023). Batches were a label (RC-028). A supplier return debited the
supplier whether or not the goods were billed, against the latest bill, and couldn't be undone (RC-129). Rejected
stock could walk back to the shelf, transfers couldn't be undone (RC-124), a count that listed an item twice applied
the difference twice (RC-123), and job work could bring in a serialised good with no units (RC-130).

ADR-006 already says what each of these documents posts, with hand-worked figures. This ADR fixes, before M4 builds
them, each buying and stock document's states, approvals, checks, numbers, dates, keys and lock order. Where a rule
waits on the CA, the default here is the stricter reading.

## Decision

### 1. The documents

| Document | Table (lines) | Library | Posts | States |
|---|---|---|---|---|
| Purchase order | `purchase_orders` (`purchase_order_lines`) | lib-purchasing | nothing | draft → placed → closed or cancelled |
| Goods receipt | `goods_receipts` (`goods_receipt_lines`) | lib-purchasing | stock, units, journal | draft → posted → cancelled |
| Purchase bill | `purchase_bills` (`purchase_bill_lines`) | lib-purchasing | journal, and a revaluation (§7) | draft → posted → cancelled |
| Supplier return | `supplier_returns` (`supplier_return_lines`) | lib-purchasing | stock, units, journal | draft → posted → cancelled |
| Stock transfer | `stock_transfers` (`stock_transfer_lines`) | lib-stock | stock, units, journal | draft → posted → cancelled |
| Stock count | `stock_counts` (`stock_count_lines`) | lib-stock | stock, units, journal, when approved | draft → posted → cancelled |
| Stock adjustment | `stock_adjustments` (`stock_adjustment_lines`) | lib-stock | stock, units, journal, when approved | draft → posted → cancelled |
| Job work challan | `job_work_challans` (`job_work_challan_lines`) | lib-stock | stock, units, journal | draft → posted → cancelled |
| Job work receipt | `job_work_receipts` (`job_work_receipt_lines`) | lib-stock | stock, units, journal | draft → posted → cancelled |

- **A purchase order posts nothing,** so it carries no ledger guard; its service moves its states, and a CHECK holds
  the values. It's **closed** when every line is received, or **closed short** with a reason when a person closes it
  with lines still to come. It can be **cancelled** only while nothing has been received against it.
- **A debit note isn't a document of its own.** It's the billed part of a supplier return (§8), with its own number.
- **A supplier's bill for services** (freight, a job worker's charges, §11) is a purchase bill whose lines name no
  goods receipt. Expense bills that aren't purchases are M5-02's.
- **Drafts can be deleted;** posted documents are cancelled, never deleted (§2). Deleting a draft with a pending
  approval closes the request first (`withdrawPending`, RAD-114).

### 2. Database guards (ADR-005 §7b, RA004)

Every table above that posts attaches #185's two generic guards in its own migration, and adds its moves to
`state_transitions`, mirrored in lib-common's `STATE_TRANSITIONS`, as ADR-007 §2 does:
- `guard_posted_document(<table>, 'draft', 'cancelled_at,cancelled_by,cancel_reason,cancel_entry_id', '')`, with the
  moves draft → posted and posted → cancelled;
- `guard_document_line(<lines table>, <parent column>, 'draft')` on its lines.

`purchase_orders` has the moves draft → placed, placed → closed, and draft or placed → cancelled, and its lines
change only through its service (§5). While a document is a draft, anything on it changes. Its posting update sets
everything posting writes, and from then on only cancelling changes it.

### 3. Numbers (M2-04)

Each document draws its number from its own series (`defineSeries`), as the last step of the save that posts or
places it (ADR-006 §1). Drafts have none, so drafts thrown away leave no gaps.

| Series | Prefix (a setting) | Drawn when | Digits |
|---|---|---|---|
| `purchasing.order` | PO | placed | 5 |
| `purchasing.receipt` | GRN | posted | 5 |
| `purchasing.bill` | PB | posted | 5 |
| `purchasing.return` | SR | posted | 5 |
| `purchasing.debit_note` | DBN | posted, when the return has a billed part (§8) | 5 |
| `stock.transfer` | ST | posted | 5 |
| `stock.count` | SC | posted | 5 |
| `stock.adjustment` | SA | posted | 5 |
| `stock.job_work_challan` | JWC | posted | 5 |
| `stock.job_work_receipt` | JWR | posted | 5 |

The format is ADR-007 §3's, `PREFIX/YY-YY/NNNNN`. A supplier's own invoice number is a field on the bill (§7), never
one of these.

### 4. Dates (ADR-007 §4's rules)

Every document's `business_date` is in an open financial year after the period lock, not after today, and not before
the document it comes from (`date_before_source`):

| Document | Not before |
|---|---|
| goods receipt | its purchase order's date |
| purchase bill | the date of every receipt it bills |
| supplier return | the receipt its lines came in on; and, for its billed part, that bill's date |
| job work receipt | its challan's date |
| a cancellation | the date of what it cancels |

- **A bill's supplier invoice date** is the supplier's: it may be before the bill's business date, but not after it,
  and not after today (`supplier_date_after_bill`).
- Transfers, counts and adjustments have no source document.

### 5. Purchase orders and their approval (M4-01)

- **The supplier** is a party that can be bought from. **A foreign supplier can't be made yet (D-10):** a party's
  state must be one of lib-common's Indian state codes, and imports and foreign currency (M4-08, M4-09) wait for M9.
  When they come, the party gains a country, and a PO from a foreign party becomes an import then.
- **Lines** are an item, a quantity and a rate before tax. The tax figures are worked out by lib-gst as a sale's are
  (place of supply from the supplier's state against ours), computed on read while a draft and stored when placed.
- **Placing.** The PO's total with GST, the figure it shows and what will be paid, is compared with the placer's role
  limit (Sarthak, 22 Nov, "Total with GST"):
  - **within it,** the PO is placed at once and takes its number;
  - **above it,** placing requests approval through `defineApproval`, kind `purchase-order`, under
    `purchasing:approve`. The PO stays a draft while the request is pending, and the approval's `approved` step
    places it.
  - **The limit is dynamic:** `purchase_order_limits (role, max_total)` gives a role its own limit, and a role
    without a row takes `purchasing.order_limit_default`. **Its default is 0, so every PO is approved,** as the
    discount limit's is (D-21, 18 Nov), until one is set. Sarthak confirmed it (22 Nov, "0 — every PO approved").
  - **Setting the limits** (RAD-136): `GET /purchasing/order-limits` lists them under `purchasing:read`, and
    `PUT /purchasing/order-limits` sets one under `purchasing:approve`, with a `reason()`, as the discount limits are
    set. A null role sets the default. A null limit removes a role's own, so it takes the default again; given for
    the default, it resets it to 0.
  - Placing posts nothing, but `approved` checks the PO's date against the open year and the period lock, so the
    spec declares `lockFirst` (`lockPeriod`), as ADR-001 §8b asks of any spec whose `approved` takes the period lock
    (RAD-136). Its version is the PO's own lines and total.
- **A placed PO changes** only through its service. The approved total is recorded by the approval's `approved` step,
  outside the version hash, so an approval holds only for what it approved, as RAD-135 rules for credit:
  - an edit that raises the total above **the higher of the editor's role limit and that approved total** is
    **refused** (`over_approved`, RAD-136), and the PO keeps its lines. It's the editor's limit, not the original
    placer's, since the spend is committed by whoever edits: a role with a low limit can't raise a manager's PO up
    to the manager's limit. There's no pending revision: it would be a second copy of
    the lines, kept in step with receipts posting meanwhile, as sales' `change_over_checks` refuses (ADR-007 §1). The
    message says the way forward: more goods go on a new PO, a higher price is caught at the bill (§7's tolerance),
    and a rework is a close-short and a new PO;
  - a placed PO's supplier and date are fixed (`fixed_once_placed`), and no line goes below what's been received
    against it (`po_received`);
  - lowering a quantity or rate, closing short, and any edit within both limits save at once.
- **Receiving more than ordered is refused** (`over_ordered`). Extra goods need a PO line of their own; there's no
  quantity tolerance.
- The PO prints on A4 through RAD-120's engine (M4-01). It isn't a tax document, so personal fields print as the
  screen shows them.

### 6. Goods receipt and QC (M4-02, RC-028, RC-205)

Flow 5: goods arrive and are counted, but aren't in stock until QC has split them.
- **A receipt names one placed PO,** and each line names a PO line. A free item is a PO line at rate 0.
- **The draft** records what arrived: each line's received quantity, the location the accepted goods go to (of a
  sellable kind), and the rejects location (of kind `rejected`, `not_a_rejects_place` otherwise).
- **QC** fills each line's accepted and rejected quantities, which add up to what was received, with a reason for any
  reject. **Posting the receipt is QC done:** one save posts the accepted goods into their location and the rejects
  into the rejects location, both at the PO line's rate (ADR-006 §6, F2). Rejects never enter the selling average
  (RC-205).
- **Batches (D-15, §4a):** each line names the supplier's batch numbers and how many came in each. A line with none
  takes the receipt's own number as its batch. A batch is the item's from this supplier, so another supplier's same
  number is another batch (RC-028).
- **Serials:** a serialised item's line names each unit's serial at QC, split between accepted and rejected, with its
  chassis number where the item has the flag (F22). Accepted units are `received` as `new`, rejected ones as `damaged`.
  A serial already sold (a unit that's the customer's) is refused by name, `serial_sold`, and one already in our stock
  `serial_in_stock`, both before the database's RA008. A serial that went back to its supplier (`gone`) can come in
  again.
- **Cancelling a posted receipt** mirrors it, at the same values, only while nothing on it has been billed, returned
  or moved on (`receipt_in_use`).

### 7. Purchase bills (M4-03, RC-023, RC-056, RC-172)

- **A bill starts as a draft** with its file attached: a new file kind `purchase_bill` (PDF, JPEG or PNG, 10 MB),
  with the bills keys (`perms`). It posts only with the file (`bill_file_required`), so every posted bill can be shown
  (RC-172).
- **It records what the supplier's bill says:** the supplier's invoice number and date, and the supplier's GSTIN as
  printed, which must be the party's, or none for an unregistered supplier (`gstin_mismatch`).
- **A bill can come before the goods** (flow 5). Its draft lines then name PO lines. It posts only once every goods line
  names a posted receipt line, which the person picks when the goods are in. Until then it waits as a draft, with its
  file.
- **The duplicate check, right both ways (RC-023):**
  - a supplier's invoice number is unique for that supplier within the financial year of its date. Rule 46 makes a
    number unique for a financial year, so the same number from two suppliers, or from one supplier in two years,
    is allowed;
  - the number is compared as written, in upper case and trimmed, with "/" and "-" kept: "INV/1" and "INV-1" are
    different numbers;
  - a partial unique index on `(party_id, supplier_invoice_fy, supplier_invoice_key)` for bills that aren't
    cancelled holds it, mapped through `dbErrors` to `duplicate_bill`. A cancelled bill's number can be entered again.
- **Matched three ways (RC-056).** Each goods line names the receipt line it bills, and through it the PO line:
  - **quantity:** at most what that receipt line received, accepted plus rejected, less what's already billed and
    less rejects returned before they were billed. More is refused (`over_received`), with no tolerance. A line bills
    the receipt line's accepted goods first, and its rejects only beyond them, so billing the 2 accepted of F2's 3
    leaves the reject unbilled (F3, F4);
  - **rate:** a line billed above its PO rate by more than `purchasing.bill_tolerance_pct` (2%, Sarthak, 22 Nov)
    needs approval. A bill at or below the PO rate, or within the tolerance, posts.
  - **Approval** is `defineApproval`, kind `purchase-bill`, under `bills:approve`. The approver sees the lines over
    tolerance and the amounts that will post. Its `approved` step posts the bill, so the spec declares `lockFirst`.
  - The plan named the setting `purchases.bill_tolerance_pct`. Settings are keyed by module (ADR-001 §8c), so it is
    `purchasing.bill_tolerance_pct`.
- **Charges on a goods bill** (freight, packing, insurance) are lines of their own, naming no receipt. They're part of
  the goods' cost (AS-2), so they're spread over the bill's goods lines by value and join the price difference below.
  Charges above the same tolerance, as a share of the bill's goods value, need the same approval. A transporter's own
  bill is a service bill (§1).
- **Tax is the bill's own,** never recomputed at the PO's rate (RC-056). lib-gst works it out from the bill's lines at
  the rates in force on the supplier's invoice date. The person enters the bill's stated total, and a difference of
  more than the round-off is refused (`total_mismatch`), to be put right with the supplier.
- **What posts** is ADR-006 §6's row:
  - Goods Received Not Billed is cleared by exactly what the billed quantities accrued at receipt, so nothing is left
    stranded there (RC-056);
  - the price difference, plus any input GST that can't be claimed (§7a), goes by ADR-006 §4's rule: to stock across
    the sellable locations holding the item, and to Cost of Goods Sold for what's already gone;
  - **a billed reject's** difference goes onto the rejects location instead, so the reject's value is what was
    billed, and its return (§8) clears the supplier exactly.
- **Allocations (ADR-005 §7a):** `purchase_bills` is registered in `allocatable_documents` as a payable charge.
  Payments (M3-12) and debit notes (§8) apply to it.
- **TDS at the bill** (section 194Q or 194C) is M5-10's. Until then a bill carries none.
- **Cancelling a posted bill** mirrors its entry, only while nothing is applied to it (`guard_applied_cancel`) and no
  return has debited it. Its price difference comes back by ADR-006 §4's rule as things stand at the cancel: the part
  that went to Cost of Goods Sold from there, and the part that went to stock from the locations still holding the item,
  in proportion to their quantity, with what's gone since from Cost of Goods Sold (RAD-138).

### 7a. Input credit (M4-04, RC-014, CA-04)

Until CA-04 is answered, the stricter reading: a bill's input GST is claimed only when the supplier is a regular
registered person whose GSTIN is on the bill. A bill from an unregistered or composition supplier carries no input
GST: any tax on it is part of the cost, through the price difference. Foreign suppliers can't exist yet (§5). M4-04
builds this and changes only the rule, not the shape, when CA-04 answers.

### 8. Supplier returns and debit notes (M4-05, RC-129)

- **A return takes rejects back to their supplier,** out of a location of kind `rejected`. Each line names the
  receipt line its goods came in on, so the supplier and the bill are known, never guessed from "the latest bill".
  Sellable stock is returned by moving it to rejects first, which is a transfer with a reason (§9).
- **Each line is split by what was billed.** Since a bill takes a receipt line's accepted goods first (§7), a return
  of rejects counts against the line's unbilled rejects first, and against its billed ones after:
  - **the billed part** of that receipt line is debited against **the bill that billed it:** Dr Creditors, Cr Stock in
    Hand, Cr Input GST at that bill's rates (ADR-006 §6, F4's variant). It draws a debit-note number (§3), is
    registered as a payable credit, and is applied to its own bill in the same save while the bill has anything
    open. What's left stays as credit with the supplier;
  - **the unbilled part** goes back against Goods Received Not Billed (F4), with no debit note.
  - So only billed rejects are ever debited (RC-129).
- **Units** go out with `returned_to_supplier`, their batches with them.
- **The input GST reversal** posts with the return, the stricter reading. Whether it should wait for the supplier's
  own credit note is CA-52's question, and its answer changes timing, not shape.
- **A return can be undone (RC-129).** Cancelling it reverses its credit application first, then mirrors its entry
  and movements, and its units come back to the rejects location with `received` (allowed from `gone`).
- The debit note prints on A4 (M4-05). It's sent to the supplier, so it prints the supplier's name, address, state and
  GSTIN in full, as RAD-120 rules for documents of that kind.

### 9. Transfers (M4-06, RC-124)

- **A transfer** moves goods from one location to another, with a reason, posted at once (ADR-006 §6, F13). The
  person names the batches and serials going out, and the goods come in under the same batches.
- **Into `demo`,** serialised units take condition `demo` (F13). Out of `demo` they keep it, so an ex-demo unit is
  sold as one.
- **Rejected stock goes back to selling only through QC (RC-124).** A plain transfer out of a `rejected` location
  goes only to another `rejected` one. To any other place, sellable or not, it's refused (`needs_qc`), so a hop
  through a demo or franchisee place can't carry rejects back to selling (RAD-141). Rejects otherwise leave only by
  a supplier return (§8), an approved write-off adjustment (§10), or a **re-inspection**:
  - a transfer marked `requalified`, under `inward:qc`, the key that does QC at receipt, with a reason;
  - its serialised units take the condition the inspection found, `new` or `used`, by `condition_changed`;
  - M4-06 ships the refusal. M4-02, which brings `inward:qc`, adds the re-inspection, so until then rejects can't go
    back at all.
- **Job work locations** are reached only by job work's own documents (§11): a plain transfer to or from one is
  refused (`use_job_work`).
- **A transfer can be undone (RC-124).** Cancelling it mirrors it at the same values, dated the cancellation's day.
  It's refused if the goods are no longer where it put them, or a unit on it has moved since (`goods_moved_on`).
- **No approval, except into a franchisee's store when an admin turns it on.** Plan flow 7 asks a reason of a transfer
  and an approval of counts and adjustments only. `stock.franchisee_transfer_approval` (yes or no, **default no**,
  Sarthak, 22 Nov, "Setting, default no"):
  - **off:** every transfer posts at once;
  - **on:** a transfer into a location of kind `franchisee` waits as a draft for `defineApproval`, kind
    `stock-transfer`, under `stock:approve`, from someone other than its maker. The approver sees the lines and their
    values. Its `approved` step posts, so the spec declares `lockFirst`, and deleting the pending draft closes the
    request (`withdrawPending`);
  - the setting is read when the transfer is sent, so turning it on doesn't catch transfers already posted.
- **What posts** is one `stock_transfer` entry with a Stock in Hand line for each location (ADR-006 §6, F13). It's one
  account, but its lines carry the location, so books by place agree with stock by place (ADR-006 §7). The total
  doesn't move.

### 10. Counts and adjustments (M4-06, RC-123)

- **A count** names a location, and its lines name an item, a batch (or "batch unknown") and the quantity found, with
  the serials found for a serialised item.
  - **An item listed twice is merged (RC-123):** lines for the same item and batch are summed into one, so two people
    counting two shelves add up. A unique key on `(count_id, item_id, batch_id)` `NULLS NOT DISTINCT` holds it.
  - **The count says when it was taken** (`counted_at`, not after it's submitted and not in the future). Each line's
    book quantity is the sum of the movements posted up to that moment, and the difference is what was found less
    that. The difference is what posts, so a sale made after the counting, whether before or after the approval, is
    neither missed nor counted twice.
  - **A serial found here but booked at another location** is refused (`serial_elsewhere`): it's a transfer, not a
    gain here and a loss there.
  - **A serial the books don't know** is refused (`serial_unknown`). It comes in through its goods receipt, or through
    an approved adjustment that names its serial and, where the item needs one, its chassis number, so no unit
    skips those checks.
- **An adjustment** is a one-off in or out with a reason: goods damaged, lost or found.
- **Both change nothing until approved (flow 7):** `defineApproval`, kinds `stock-count` and `stock-adjustment`, under
  `stock:approve`, by someone other than the person who counted. The approver sees the differences and their values.
  Its `approved` step posts, so the spec declares `lockFirst`.
- **What posts** is ADR-006 §6's row and F14:
  - a shortage goes out at the location's average, and a gain comes in at it, or at the item's last `in` rate where
    the location holds none, against ADR-006 §2's existing `stock_adjustment` account;
  - a serialised shortage is written off as lost, `scrapped`. An adjustment's own serialised gain is `received`, with
    the adjustment's number as its batch;
  - a difference between batches alone moves the quantity between them, at the same value, with no entry (F21).
- **Cancelling** a posted count or adjustment mirrors it, under `stock:approve`, with a reason.

### 11. Job work (M4-07, RC-130)

- **Each job worker has one location of kind `job_work`** (ADR-006 §4, F16). M4-07's migration adds
  `locations.party_id`, required exactly when the kind is `job_work`, and unique, so a challan finds its job worker's
  location.
- **The challan** sends inputs from a location of ours to the job worker's (ADR-006 §6, F16). Serialised inputs go with
  `sent_to_job_work`, and batches go with them. It's the delivery challan Rule 55 asks for goods sent for job work, so
  it prints the job worker's name, address, state and GSTIN in full.
- **No challan sends from a `rejected` place** (`needs_qc`, as a plain transfer is refused, §9; RAD-141). What a job
  worker makes or sends back comes into our stock, so rejects sent out would come back sellable without QC.
- **The receipt** names the challan lines it answers, and says, for each:
  - **goods made:** the output item and quantity, and its charge rate. They come in at the inputs used plus the charge
    (F16). A serialised output names each serial, and each becomes a unit `received` with the receipt's number as its
    batch (RC-130). Without its serials, the receipt is refused (`units_mismatch`);
  - **inputs used:** out of the job worker's location. A serialised input used is `scrapped`, since it's now part of
    the output;
  - **inputs back unused:** returned to a location of ours, `received_from_job_work`;
  - **inputs lost:** to Stock Adjustment (F16), units `scrapped`.
  - **What it accounts for** is at most what each challan line sent, less what earlier receipts accounted for
    (`over_challan`). A challan is closed when everything it sent is accounted for, and can be cancelled only while no
    receipt answers it.
- **The charge** accrues to Job Work Charges to be Billed. **The job worker's bill** is a purchase bill (§7) whose
  lines name the receipt's charges. It clears the accrual, with any difference by ADR-006 §4's rule, under the same
  tolerance.
- **Section 143:** inputs not back within a year are a deemed supply. The job work list shows each open challan's age
  and flags those past `stock.job_work_return_days` (365). What tax then falls due is CA-51's question.
- **Costs stay masked for operations.** Job work screens show the documents' own quantities and charges. Stock values
  (the inputs' and outputs' worth at average) are `cost()`, masked without `cost:read`, as any cost is (RC-164).

### 12. Lock order (ADR-006 §1)

Every save here takes ADR-006 §1's one order:
1. the company profile and period lock rows, `FOR SHARE` (a posting approval's `lockFirst`);
2. the documents, in **one order by table whichever is being saved:** `purchase_orders`, `goods_receipts`,
   `supplier_returns`, `purchase_bills`; then `job_work_challans`, `job_work_receipts`; each table's rows by id
   (ADR-005 §7a: by table, never by id across tables).
   - **Returns before bills** is ADR-005 §7a's credits-first rule: a return's billed part is a payable credit applied
     to its bill (§8), and the credit-application trigger locks the credit, then the charge. So the return's own
     posting, a later credit application, and the reversal before a return is cancelled all take the return, then
     the bill.
   - The service reads the draft unlocked to learn its sources, locks them all in that order, then checks the
     draft's status again. So a receipt locks its PO, then itself; a bill its POs and receipts, then itself; a
     return its receipts, itself, then their bills. No two saves wait on each other in a circle.
   - **Transfers, counts and adjustments** touch no other document, so each locks only itself, after these.
3. no party lock: no check here counts a supplier's balance. A payment to one takes its own, at payment (ADR-007 §8);
4. the stock positions, then new batch rows, in §4a's order;
5. the units, by id;
6. the numbering series, last.

**Approvals keep the order.** A decision locks its record's row before `approved` runs (ADR-001 §8b), so a bill
approval's `lockFirst` takes step 1 and then the bill's POs and receipts from step 2. The engine's lock on the bill
itself then comes after them, in its place. Counts and adjustments have no sources, so theirs takes step 1 only.

The duplicate-bill check is held by its unique index, not by a lock, so two saves of one number can't both post.

### 13. Keys and their default grants

| Key | What it allows | Default grants |
|---|---|---|
| `purchasing:read` | see purchase orders, receipts, bills and returns | admin, owner, stores, accounts |
| `purchasing:write` | draft, place, change, close short and cancel purchase orders | admin, stores |
| `purchasing:approve` | approve a purchase order above its placer's limit, and set the limits (§5) | admin, owner |
| `inward:write` | record goods that arrived (`inward`, not `receipts`, which are payments: `receipts:print`) | admin, stores |
| `inward:qc` | inspect and post a receipt; re-inspect rejects (§9) | admin, stores |
| `bills:write` | enter, post and cancel supplier bills | admin, accounts |
| `bills:approve` | approve a bill over the tolerance | admin, owner |
| `supplier_returns:write` | return rejects, raise debit notes, undo a return | admin, stores, accounts |
| `stock:move` | transfer stock and undo a transfer | admin, stores |
| `stock:count` | count stock and propose adjustments | admin, stores |
| `stock:approve` | approve counts and adjustments (and franchisee transfers, when §9's setting is on), and cancel them | admin, owner |
| `job_work:write` | send and receive job work | admin, stores, operations |

- **Record scope (E7):** `purchasing:read` names `purchase_orders`, `goods_receipts`, `purchase_bills` and
  `supplier_returns` in its `records`, owned by `created_by`. `stock:read` gains the stock documents
  (`stock_transfers`, `stock_counts`, `stock_adjustments`, `job_work_challans`, `job_work_receipts`). The ledgers stay
  out of every `records` (ADR-006 §1).
- **Who reads stock documents, on purpose:** `stock:read` is already granted to the counter and sales, for picking
  stock, so they can read transfers, counts, adjustments and job work too. That's intended: where stock went is
  useful to them. The documents' values are `cost()`, masked without `cost:read`. An admin who wants counts kept to
  stores narrows `stock:read` on the roles screen.
- **A purchasing document's own figures are content, not `cost()`** (RAD-136). A PO's, receipt's, bill's and
  return's rates, amounts and tax are what the document says: shown to whoever holds `purchasing:read`, and printed
  on it. `cost()` stays on what's worked out from them: an item's moving average, stock values and margins (ADR-001's
  cost fields, RC-164). So `purchasing:read` is the key that keeps what we pay suppliers from a role.
- **None needs the second factor:** none moves money (D-19). A bill creates a payable, and paying it is M3-12's.
- **None is `allOnly`,** so the role-scope CHECK doesn't change.
- **The owner** reads and approves, and makes no day-to-day documents, as the role says.
- Every new error code is declared on each route it can reach (RAD-134's guard).

### 14. Who builds what, and the migrations

| Ticket | Session | Tables, settings and rows its migration adds |
|---|---|---|
| M4-01 | backend | `purchase_orders`, lines, `purchase_order_limits`; `purchasing.order_limit_default`; the `purchasing.order` series; the purchasing keys |
| M4-02 | backend-3 | `goods_receipts`, lines; the `purchasing.receipt` series; `inward:write`, `inward:qc`; the re-inspection transfer (§9) |
| M4-03 | backend | `purchase_bills`, lines, the duplicate index; the `purchase_bill` file kind; `purchasing.bill_tolerance_pct`; the `purchasing.bill` series; the `allocatable_documents` row; `bills:write`, `bills:approve` |
| M4-05 | backend-3 | `supplier_returns`, lines; the `purchasing.return` and `purchasing.debit_note` series; the `allocatable_documents` row; `supplier_returns:write` |
| M4-06 | backend-3 | `stock_transfers`, `stock_counts`, `stock_adjustments` and their lines; their three series; `stock.franchisee_transfer_approval`; `stock:move`, `stock:count`, `stock:approve`; `stock:read`'s new records |
| M4-07 | backend-2 | `job_work_challans`, `job_work_receipts` and their lines; `locations.party_id`; `stock.job_work_return_days`; the two job work series; `job_work:write` |

- **Two writers never share a tables file.** Purchasing's tables split by family (`tables-orders.ts`,
  `tables-receipts.ts`, `tables-bills.ts`, `tables-returns.ts`), and stock's add `tables-moves.ts` (M4-06) and
  `tables-job-work.ts` (M4-07). Each is named in `TABLE_FILES` and the rest of the list in RAD-92's ruling.
- **Contracts and services split the same way,** as lib-sales does. lib-purchasing gets `contract/orders.ts`,
  `contract/receipts.ts`, `contract/bills.ts` and `contract/returns.ts`, and `services/` files to match. lib-stock
  gets `contract/moves.ts` (M4-06) and `contract/job-work.ts` (M4-07). Each ticket writes only its own files.
  `contract.ts` and `index.ts` only gain that ticket's export lines.
- **The shared registries are append-only lists:** lib-platform's `permissions.ts` and the permission manifest,
  lib-common's `STATE_TRANSITIONS`, `TABLE_FILES`, and E7's options. Each ticket only adds its own rows. When two
  PRs both add, the later one merges dev in and keeps both sides, as the merges since #294 have done. No ticket
  edits or reorders another's rows.
- **Migration numbers** come from the coordinator.
- **ADR-006's rows stay as they are.** Where this ADR adds a rule, the ticket that builds it adds its test against
  ADR-006's figures.

### 15. The tests each ticket owes

Beyond each document's own happy path and ADR-006's figures:
- **M4-01:**
  - a PO within the placer's limit is placed at once;
  - one above it waits for `purchasing:approve`, from someone other than its maker;
  - with no limit row, the default of 0 sends every PO for approval;
  - raising a placed PO's total above what was approved asks again;
  - deleting a pending draft closes its request.
- **M4-02:**
  - F2 exactly, accepted and rejected in one save;
  - a sold serial is refused `serial_sold`, and one in stock `serial_in_stock`;
  - batches: F21's receipt, and two suppliers' same lot as two batches;
  - receiving more than ordered is refused `over_ordered`;
  - a receipt in use can't be cancelled.
- **M4-03:**
  - F3 and both its variants;
  - the duplicate check: same supplier and number in one year refused; another supplier, or another year, allowed; a
    cancelled bill's number reusable;
  - a line 2.01% over its PO rate waits for `bills:approve`, while 2.00% posts;
  - the reject stays unbilled when only the accepted are billed;
  - a bill before the goods stays a draft until they're received;
  - a freight line is spread over the goods;
  - `total_mismatch` and `bill_file_required` are refused;
  - Goods Received Not Billed ends at exactly the unbilled amount.
- **M4-05:**
  - F4 and its billed variant;
  - a return splits unbilled first, then billed, against that receipt's own bill and not the latest;
  - the debit note is applied to its bill;
  - cancelling a return restores the rejects, the units and the bill's open amount.
- **M4-06:**
  - F13 and F14;
  - rejects to any place but another rejects place, a demo place included, are refused `needs_qc`, and pass to a
    sellable one as a re-inspection under `inward:qc`;
  - a transfer undone, and refused once the goods have moved on;
  - with `stock.franchisee_transfer_approval` on, a transfer into a franchisee's store waits for another person,
    while one to any other place posts at once; with it off, both post;
  - a count listing an item twice merges into one line (RC-123);
  - a sale between `counted_at` and the approval is neither missed nor counted twice;
  - nothing posts until another person approves;
  - `serial_elsewhere` is refused.
- **M4-07:**
  - F16 exactly;
  - a serialised output with no serials is refused, and with them creates its units (RC-130);
  - `over_challan` is refused, and so is a challan from a rejects place (`needs_qc`);
  - a challan past `stock.job_work_return_days` is flagged;
  - an operations role sees charges but not stock values.

## Consequences

- Each M4 ticket has its states, guards, checks and keys fixed before it starts. The CA's answers to CA-04, CA-51 and
  CA-52 change rules or timing, not tables.
- A bill entered before its goods arrive stays a draft, with its file, until the receipt is posted: its lines have
  nothing to match yet. Flow 5's order (the bill recorded, then the goods) still works.
- Every PO is approved until a limit is set (§5). That's deliberate, and it's one admin edit to change.
- Counts post the difference taken at submission, so a count approved a day later is still right. A count submitted
  and never approved changes nothing.
- No quantity tolerance anywhere: extra goods need their own PO line. If that proves heavy, a tolerance is a setting
  to add, not a redesign.

## Alternatives considered

- **Post the bill at once, and correct later.** v1's way (RC-172). Rejected: a bill with no file and no match is what
  stranded the differences.
- **Match bills on the total only.** Simpler, but a high rate on one line hides under a low one on another. Per-line
  rates catch it, and the total check still catches a typo.
- **A debit note as a document of its own.** It would duplicate the return's lines and leave the two able to disagree.
  The billed part of the return is the debit note, with its own number.
- **Let a transfer move rejects back, with approval.** Approval checks who, not whether the goods are good. A
  re-inspection under the QC key records that someone looked.
- **Recompute a count's difference at approval.** It double-counts every sale made between counting and approving.
