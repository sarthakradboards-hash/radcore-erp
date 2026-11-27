# ADR-009: Accounts rules

- Status: proposed
- Date: 2026-11-27
- Ticket: RAD-150 (M5-00), from the M5 plan Sarthak approved on 27 Nov ("Approve as drafted"). This first part is the
  design basis for M4-04 (input credit, RAD-139, moved into M5), M5-02 (expenses), M5-10 (TDS), M5-08 (the filed-month
  lock) and M5-09 (the period lock and year close). Its second part (§11 to §14) is the basis for M5-11 and M5-13
  (bank statements and matching), M5-14 (reports) and M5-16 to M5-18 (moving from Vyapar).
- Builds on: [ADR-006](006-ledger.md) §1 (lock order), §2 (accounts and posting rules), §3 (entries, the lock under
  the lock), §6 (what each document posts), §7 (books check), §8 (F12, F18, F20); [ADR-008](008-buying-and-stock.md)
  §7 and §7a (bills and the interim input-credit rule), §12 (lock order), whose conventions this ADR follows;
  [ADR-001](001-layers.md) §6a (record scope), §8b (approvals, `lockFirst`).
- Source: the register (RC-012, RC-014, RC-038, RC-039, RC-058, RC-060, RC-087, RC-120, RC-121, RC-135, RC-136,
  RC-145, RC-163, RC-176, RC-210); plan flows 9 and 12 and §6's acceptance lines; CA-03, CA-04, CA-05, CA-11, CA-12,
  CA-18 to CA-22, CA-24 to CA-28 and CA-38 (docs/source/10-Questions-for-CA-and-Counsel.md); the go-live checklist
  §3.1, §3.10 and §4 (docs/source/07-Go-Live-Checklist.md); D-06, D-08, D-16.

## Context

In v1 every bill and expense with GST claimed input credit: from a supplier with no GSTIN, from a composition dealer,
and on costs the law blocks (RC-014, RC-058). An expense category could point at any account. TDS was typed in by
hand at payment, with no thresholds and no higher no-PAN rate (RC-060). The filed-month lock guarded half the doors,
nothing recorded what was filed, and the current month could be marked filed (RC-012). One accountant could move the
period lock back over open months and reopen a closed year alone (RC-039), and neither the close nor a lock move
waited for postings in flight (RC-163).

M2 built the period-lock row and the lock under the lock (ADR-006 §3). This ADR fixes, before M5 builds them, the
rules, tables, keys and lock order for credit, expenses, TDS and the two locks. Where a rule waits on the CA, the
default is the stricter reading, and the figure or choice lives in a dated table or a setting an admin can change,
so the CA's answer changes data, not code (D-08). The CA confirms the figures before any real return is filed. §8
lists each rule with the CA question that confirms it.

## Decision

### 1. Where it lives (ADR-001 §3)

- **lib-gst** holds the input-credit rule (§2) as one pure function, `inputCredit`, that bills and expenses both
  call. It reads no ledger.
- **lib-accounts** holds expenses (§3), TDS (§4) and both locks (§5, §6). The filed-month lock is a books lock, so it
  sits beside the period lock that every posting already reads; lib-gst can't import lib-accounts (ADR-001 §4), and
  lib-accounts can call lib-gst for ADR-010's return figures.
- **lib-purchasing** calls `inputCredit` and lib-accounts' TDS function on its bills.

### 2. Input credit (M4-04, RAD-139; RC-014, RC-058; CA-04, CA-05, CA-12)

This replaces ADR-008 §7a's interim rule. A bill line's or expense line's input GST is claimed only when every test
passes, and otherwise the tax is part of the cost: through the price difference on a goods bill (ADR-008 §7), or on
the line's own account for a service bill's charge or an expense.
- **The supplier's kind (CA-04).** A party is `regular` (a GSTIN, not composition), `composition`, or `unregistered`
  (no GSTIN), read from the columns parties already have. The setting `gst.credit_from` lists the kinds whose bills
  carry credit, by default `['regular']`. A bill's GSTIN as printed must be the party's (ADR-008 §7). An `overseas`
  supplier of services in rupees is reverse charge ([ADR-010](010-gst.md) §4); SEZ, and foreign suppliers of goods, come
  with D-10 in M9.
- **Blocked credit (CA-05).** Each expense category (§3) says `credit: allowed | blocked`, and a blocked one names its
  section 17(5) clause. A new category starts blocked. On a service bill (a bill with no `goods` lines), each `charge`
  line names an expense category too (M5-02 adds the column), so the same rule covers it. `goods` lines aren't blocked,
  and `job_work` lines post to Job Work Charges to be Billed (ADR-008 §11), not to a category.
- **The state and the tax heads.** CGST and SGST are claimed only from a supplier in the company's state, and IGST only
  from one in another state. A hotel in Karnataka that charges its own CGST and SGST gives a Maharashtra GSTIN no
  credit (F28). A purchase bill's tax is always lib-gst's (ADR-008 §7), worked out from the supplier's state, so its
  heads always match. A service taxed where it's used, not where we are (a hotel, an event venue), is entered as an
  expense, where the heads are typed as printed and a mismatch means no credit.
- **What the line records:** the credit claimed by head, and, where none, why (`supplier_kind`, `blocked`, `state`, or
  `time_barred` past section 16(4), [ADR-010](010-gst.md) §10). ADR-010's 3B tables read the claimed and the ineligible
  amounts from here.
- **Not enforced in M5 (CA-12):** section 16(4)'s cut-off, matching to GSTR-2B, Rule 37's 180-day reversal and Rules
  42 and 43. Until the CA says which the software must hold, they're the CA's monthly checklist, and ADR-010 says where
  each would go.
- Bills posted before M4-04 keep what they posted. The CA's answers change `gst.credit_from` or a category's rule,
  never the tables.

### 3. Expenses (M5-02, RC-058)

- **Categories.** `expense_categories` (name, `credit`, the 17(5) clause when blocked, a default TDS section, `active`)
  and `expense_category_accounts (category_id, account_id)`, the accounts each may post to. An allowed account is an
  ordinary expense account: a composite foreign key to `accounts (id, type, control_kind)` (M5-02 adds that unique
  key), with the row's copies held by CHECK to `expense` and `none`, so a category can never point at Bank, a control
  account or an income account. Categories are set up under `accounts:write`, like the chart.
- **An expense** is a document in lib-accounts, numbered from `accounts.expense` (`EX`): the business date, the
  supplier's invoice number and date, the supplier (required whenever it's on credit or claims credit), the GSTIN as
  printed (`gstin_mismatch` if not the party's), and how it's paid: from a bank or cash account at once, or on credit
  to the supplier. A line names its category, one of that category's accounts (a composite foreign key to
  `expense_category_accounts`, so any other is refused by the database), the taxable amount, the rate, the tax by head
  as printed, and the TDS section (§4).
- **The bill is attached.** A new file kind `expense_bill` (PDF, JPEG or PNG, 10 MB), with the expenses keys. It posts
  only with the file (`bill_file_required`), as ADR-008 §7 does for bills.
- **Checks at posting:** each head equals the rate on the taxable amount within the round-off (`tax_mismatch`); the
  stated total equals the lines' (`total_mismatch`); input credit by §2; TDS by §4. One paid in cash goes through
  ADR-007 §8's payment limit (`accounts.cash_payment_limit`, CA-24).
- **States:** `draft → posted → cancelled`, in `STATE_TRANSITIONS`. Cancelling mirrors the entry, only while nothing is
  applied to it (`guard_applied_cancel`) and its TDS isn't deposited (`tds_deposited`, §4).
- **What posts** is ADR-006 §6's row (F12, F27, F28). On credit, `expenses` is registered in `allocatable_documents`
  as a payable charge, so payments (M3-12) apply to it.
- **No approval** in M5. If Sarthak wants one above an amount, it's a setting and `defineApproval`, as bills have.

### 4. TDS (M5-10, RC-060; CA-18 to CA-22)

- **Sections and rates by date (CA-18),** like GST rates (M2-12): `tds_sections` (a code, its name, the section of the
  Income-tax Act 2025 and the 1961 section it replaces, and the payee it's for: `individual` (PAN's fourth letter P or
  H), `other`, or `any`), and `tds_rates (section_id, effective_from, rate, rate_no_pan, single_limit, yearly_limit,
  source, note)`, unique on `(section_id, effective_from)`. Never deleted: a later row supersedes, and a wrong row is
  corrected in place, audited with its reason. Edited under `tds:write`. The migration seeds the payment types CA-18
  lists (contractors, professional and technical fees, rent of building and of machinery, commission, interest), each
  row naming its source and marked unconfirmed until the CA signs it (D-08).
  - **A limit's kind.** Each rate row says `limit_kind`: `whole` (once over the yearly limit, the whole year's base is
    taxed, as for contractors) or `excess` (only the year's base over the yearly limit is taxed). Purchase of goods
    (194Q, 393 in the 2025 Act) is `excess`, and also needs the buyer's turnover last year over Rs 10 crore, so it
    isn't seeded until CA-18 says it applies; then it's a row, not code.
  - **Rent's monthly limit** is `single_limit`, since rent is billed by the month; CA-18 confirms.
- **Which section.** A supplier party may name a default section, and so may an expense category. A bill or expense
  line takes the party's, else the category's; the person can change it, and clearing a default needs a reason.
- **When (CA-19):** at booking, the earlier of credit and payment. A purchase bill (services, a job worker's bill) or
  an expense deducts when it posts. An advance paid before any bill deducts at the payment (ADR-006 §6). A bill posted
  with advances applied records its base less the advances' TDS base, so the year's base counts the money once.
  Applying an advance to a bill already posted changes neither row.
- **The base (CA-19):** the taxable value before GST, where the bill shows GST separately.
- **How much,** for the payee, section and financial year:
  - if the year's base so far, this booking included, is over the yearly limit: each of the year's rows at the rate
    it recorded (see the record, below) on its base (for `excess`, only the year's base over the limit), less what's
    already deducted this year, and never below zero. So the booking that crosses the limit catches up the earlier
    ones (F29), and a later rate or PAN change doesn't reprice them;
  - otherwise, if this booking alone is over the single limit: the rate in force on its date, on this booking;
  - otherwise nothing;
  - never more than the booking's amount payable. What's left is deducted at the payee's next booking, by the same sum.
- **No PAN (CA-20):** a payee with no PAN, or one marked inoperative (`parties.pan_inoperative`), is deducted at the
  row's `rate_no_pan`, judged at each booking: an earlier row keeps the rate it recorded.
- **Rounding (CA-21):** to the nearest rupee, half up, in one function.
- **The record.** Every booking line with a section writes a `tds_deductions` row (the document, payee, section,
  month, base, the rate that applies on its date with the payee's PAN as it stood then, whether that was the no-PAN
  rate, amount), with the posting, even when it deducts nothing. So the
  year's base and what's deducted are one indexed sum on `(party_id, section_id, financial_year)`, never a read of
  every bill. The entry credits TDS Payable (F12). A payment made with TDS (an advance, ADR-006 §6) writes its row the
  same way, and M5-10 replaces M3-12's typed TDS on payments made with this sum. A line with a section needs a
  supplier (`tds_needs_party`).
- **Two bookings for one payee take turns:** a line with a section holds the payee's party row (`holdParty`, ADR-006 §1
  step 3), so two bills can't both catch up the same year. This adds a party lock to ADR-008 §12's step 3, for TDS only.
- **Deposits (F18).** A `tds_deposits` document (challan number, BSR code, the date paid, the bank account) names the
  deductions it pays, each in full, under `payments:write`. It posts `tds_deposit`: Dr TDS Payable, Cr Bank. A
  deduction is deposited once (a unique key on the deduction).
- **Cancelling** a booking writes a reversing `tds_deductions` row (the base and amount negated, naming the row it
  reverses, never deposited), so the year's sums leave the booking out. It's refused while the original is deposited
  (`tds_deposited`). The correction route for a deposited one waits on CA-22, with returns and certificates (RC-181,
  M7).
- **Opening TDS** (M5-16's cut-over balances) comes in as `tds_deductions` rows with the opening entry, so it can be
  deposited like any other.
- **The books check (ADR-006 §7)** gains a line: TDS Payable, less the lines of `payroll` entries, equals the deductions
  (net of reversals) less those deposited or marked `deposited_before_cut_over` (§14). Salary TDS and its deposit are
  M6-08's, which adds its own line. M5-10's migration writes rows for any payment already made with M3-12's typed TDS.
- **Lower-deduction certificates** (a lower rate for one payee) aren't built in M5. If one is needed, it's a dated row
  per party, not a redesign.

### 5. The filed-month lock (M5-08, RC-012; CA-03, CA-11)

- **Monthly (CA-03).** `gst.filing_frequency` is `monthly`, the only value built. If the CA says QRMP, ADR-010 adds
  the quarter, and the snapshot below changes with it.
- **The lock row.** `gst_filed_lock`, one row (id 1): `gstr1_through` and `gstr3b_through`, each the last day of the
  latest month filed. It is ADR-006 §1 step 1's filed-month row: lib-accounts' `lockPeriod` reads it `FOR SHARE` after
  the period lock, and marking or undoing a filing takes it `FOR UPDATE`, so it waits for postings in flight.
- **Every door, in the database, by entry kind.** A trigger on `journal_entries` refuses an entry (`month_filed`):
  - of an outward kind (`invoice`, `credit_note`) dated on or before `gstr1_through`;
  - of a kind 3B reports (the outward kinds, `purchase_bill`, `supplier_return`, `expense`) dated on or before
    `gstr3b_through`.
  It keys on the entry, not its GST lines, because a return reports supplies that carry no GST line: a 0% invoice
  (lib-sales drops zero lines), a composition or unregistered supplier's bill, and a blocked expense (§2). ADR-010 adds
  its reverse-charge and settlement kinds to the list, and M9 customs IGST's. Manual journals can't reach a GST account
  at all (ADR-006 §2).
- **Correcting a filed month (CA-11).** A reversal is dated the day it's made (ADR-006 §3), so it would pass the lock.
  For outward documents that's not allowed: an invoice or credit note whose own date is in a month GSTR-1 has filed
  can't be cancelled (`month_filed`); it's corrected with a credit note (ADR-007 §6) or, once ADR-010 builds them, an
  amendment. The cancel service checks it, and the same trigger refuses a reversing entry of those kinds whose
  original is dated on or before `gstr1_through`. An inward document (a bill, an expense) may still be cancelled, dated
  today: its credit then comes back in the open month's 3B, which is where it belongs (CA-13 confirms the box).
- **Marking a month filed.** `gst_filings` (the return, `gstr1` or `gstr3b`; the month; the ARN as the portal gives it;
  the filing date; the snapshot and its SHA-256; who marked it), with a partial unique index on `(return, month)` for
  filings not undone. Marking is refused unless:
  - the month has ended (`month_not_ended`), so the current month can never be marked;
  - the month before is filed for that return, or this is `gst.filing_start`, the first month RadCore files, set at
    go-live (`filing_gap`, `filing_start_not_set`).
  Marking moves that return's `…_through` to the month's last day.
- **The snapshot** is what the books said when it was filed: the month's `gst` lines summed by document, account and
  entry kind, and, once ADR-010 builds them, the return's own tables. It's kept for good, so a later difference can
  be shown against it (M5-18).
- **Undoing a filing (D-06).** Only the latest live filing for a return can be undone (`not_latest_filing`). Someone
  holding `gst:file` asks, with a reason; someone else holding `books:unlock` approves (`defineApproval`, kind
  `gst-filing-undo`, in `filing_undo_requests`). Approving marks the filing undone (the row and snapshot stay) and
  moves `…_through` back to the month before. The spec's `lockFirst` takes the filed-lock row `FOR UPDATE` (§7).

### 6. The period lock and year close (M5-09, RC-039, RC-163; CA-25)

- **Forward, freely.** Someone holding `books:lock` moves `period_lock.locked_through` to any date before today's
  business date (`lock_in_future`). The move takes the row `FOR UPDATE`, so it waits for postings in flight, and every
  posting after it sees the new date (ADR-006 §1, §3).
- **Back, with a second person (D-06).** A move back is asked for under `books:lock`, with a reason and the date, in
  `period_unlock_requests`, and approved by someone else holding `books:unlock` (`defineApproval`, kind
  `period-unlock`; ADR-001 §8b refuses the requester as `own_request`). The version the approver sees includes the
  lock's current date, so if the lock moved since the request, the decision is refused (`version_changed`). A move
  back into a closed year is refused (`year_closed`): reopen it first.
- **Closing a year (F20).** Under `books:lock`, for a year that has ended, in order (the year before is closed, or this
  is the first: `earlier_year_open`):
  - the lock must already be at or after the year's 31 March (`lock_before_year_end`). Moving it there waited for
    the postings in flight, so nothing dated in the year can change while the close reads it;
  - the close runs at `REPEATABLE READ`, takes the period lock `FOR UPDATE`, runs ADR-006 §7's books check as at 31
    March in its own transaction (`books_check_failed`), and posts F20's `year_close` entry from the balances it reads.
    A lock move committed after its snapshot fails it with a serialization error (SQLSTATE 40001), which the platform
    already answers as `conflict` (409, "Please try again");
  - every item of the year-end checklist is ticked (`checklist_incomplete`). The checklist is the setting
    `accounts.year_end_checklist`, by default CA-25's list (depreciation, provisions, income tax, interest, the stock
    valuation agreed), and the ticks are kept on the close;
  - each close is a `year_closes` row (the year, who, when, the ticks, and whether it was reopened), with a partial
    unique index on the year for closes not reopened. The `year_close` entry names that row as its source, so a year
    reopened and closed again posts a new entry under ADR-006 §3's one-entry-per-document key.
- **The close passes the lock.** The period-lock trigger lets a `year_close` entry and its reversal through, dated 31
  March of their year, though the lock is past it. Only the close and the reopen write that kind (ADR-006 §2's
  `year_close` control kind; one live close per year).
- **Reopening a year (D-06)** is a `period_unlock_requests` request of kind `reopen_year`, with the date the lock goes
  back to inside that year, approved as a move back is. Only the latest closed year can be reopened
  (`later_year_closed`). Approving reverses the `year_close` entry, dated the same 31 March (the one reversal not
  dated the day it's made, ADR-006 §3; lib-accounts' `reverseEntry` takes the date for this kind only), marks the
  close reopened, and moves the lock back. A filed month stays filed: the two locks are separate.
- **Reports** read a closed year's profit and loss without its `year_close` entry and that entry's reversal (ADR-006
  §3, M5-14).

### 7. Lock order (ADR-006 §1)

Every save here takes ADR-006 §1's one order. Step 1's three rows are always taken in the same order (the company
profile, the period lock, the filed-month lock), each `FOR SHARE` except the one being moved, which is `FOR UPDATE`:
- **a posting** (bill, expense, deposit): all three `FOR SHARE` (`lockPeriod`); then its documents, by table then id;
  then the payee's party row, when a line has a TDS section (§4); then the series, the journal's first, then the rest
  by key (ADR-006 §1 step 6). A bill's documents go in ADR-008 §12's table order; an expense or deposit locks only
  itself;
- **moving the period lock, closing or reopening a year:** the profile `FOR SHARE`, the period lock `FOR UPDATE`, the
  filed-month row `FOR SHARE`; then the request or `year_closes` row; then the journal series;
- **marking or undoing a filing:** the profile and the period lock `FOR SHARE`, the filed-month row `FOR UPDATE`; then
  the filing or request row.

```
ask (books:lock)            decide (books:unlock, not the asker)
  request row, pending  ->   lockFirst: profile SHARE, period lock UPDATE, filed row SHARE
                             lock the request row (ADR-001 §8b), check version (lock date unchanged)
                             approved: move the lock back, or reverse the close dated 31 March
```

**Approvals keep the order.** A move back, a reopen and an undo each `approved` a change to a lock, so their specs
declare `lockFirst` with lib-accounts' `lockPeriodForMove('period' | 'filed')`, which takes step 1 with the right row
`FOR UPDATE`. Taking it `FOR SHARE` first and upgrading later would let two decisions each hold the share and wait on
the other. Like `lockPeriod`, it only takes locks and refuses nothing (ADR-001 §8b), so a rejection waits for postings
in flight too, which is harmless.

`year_closes` and `gst_filings` are written, never locked by a posting, so they can't meet one. `financial_years` is
never locked: ledger rows reference it by key, and a lock on it would block them.

### 8. The CA questions each rule waits on

| Rule | Default now | Confirmed by | When the answer comes |
|---|---|---|---|
| Credit by supplier kind (§2) | regular suppliers only | CA-04 | `gst.credit_from` |
| Blocked credit (§2, §3) | a new category is blocked | CA-05 | each category's `credit` |
| Credit timing and 2B matching (§2) | not enforced; the CA's monthly checklist | CA-12 | ADR-010, if the CA wants it in software |
| TDS sections, rates, limits (§4) | the 2025 Act's published rows, unconfirmed; goods (194Q) not seeded | CA-18 | `tds_rates` rows |
| TDS timing and base (§4) | at booking; before GST | CA-19 | code, in the one TDS function |
| No-PAN rate (§4) | `rate_no_pan`, inoperative PAN included | CA-20 | `tds_rates` rows |
| TDS rounding (§4) | nearest rupee | CA-21 | the one rounding function |
| A deposited deduction's correction (§4) | refused | CA-22 | RC-181 (M7) |
| Cash limit on expenses (§3) | `accounts.cash_payment_limit` | CA-24 | the setting |
| Filing frequency (§5) | monthly | CA-03 | `gst.filing_frequency`, with ADR-010 |
| Correcting a filed outward document (§5) | cancel refused; credit note | CA-11 | ADR-010's amendments |
| Where an inward cancel lands (§5) | the open month's 3B | CA-13 | ADR-010's box mapping |
| Year-end checklist (§6) | CA-25's list, all ticked | CA-25 | `accounts.year_end_checklist` |
| GST on bank charges (§12) | no credit from the statement alone | CA-38 | an expense with the bank's tax invoice |
| A mid-year cut-over (§14) | the year's income and expense balances so far come in at step 4 | CA-26 | step 4's rows |
| Opening stock value (§14) | the import's agreed value per item and location | CA-27 | the import file |
| Old invoices (§14) | unpaid ones one by one, a summary line per rate | CA-28 | step 5 |

### New hand-worked figures (ADR-006 §8's conventions; rates and limits are examples)

**F27. An expense with blocked credit** (M5-02). Staff lunch, 1,000.00 plus 5% GST from a Maharashtra restaurant,
paid in cash. Category "Staff welfare", blocked under 17(5)(b).
- Entry `expense`: Dr Staff Welfare 1,050.00; Cr Cash 1,050.00. The line records 50.00 not claimed, `blocked`.

**F28. An out-of-state hotel** (M5-02). A hotel in Karnataka: 2,000.00 plus CGST 120.00 and SGST 120.00, paid by bank.
- Entry `expense`: Dr Travel 2,240.00; Cr Bank 2,240.00. The line records 240.00 not claimed, `state`.
- Variant: an Indian cloud supplier in Karnataka charging IGST 360.00 on 2,000.00: Dr Software 2,000.00; Dr Input
  IGST 360.00; Cr Bank 2,360.00.

**F29. A contractor crossing the yearly limit** (M5-10). Section "contractor, individual" at 1%, single limit
30,000.00, yearly limit 1,00,000.00. Contractor K, unregistered, has a PAN. Service bills on credit:
- 10 April, 25,000.00, and 10 May, 28,000.00: no TDS (the year's base 53,000.00; neither over 30,000.00).
- 10 June, 50,000.00: the year's base 1,03,000.00 is over the limit, so 1% of it, 1,030.00, less 0.00 deducted.
  Entry `purchase_bill`: Dr Contract Labour 50,000.00; Cr Creditors 48,970.00; Cr TDS Payable 1,030.00.
- 10 July, 10,000.00: 1% of 1,13,000.00 is 1,130.00, less 1,030.00: deducts 100.00.
- Variant: K has no PAN, `rate_no_pan` 20%: the June bill deducts 20,600.00; Cr Creditors 29,400.00.

### 9. Keys and their default grants

| Key | What it allows | Default grants |
|---|---|---|
| `expenses:read` | see expenses | admin, owner, accounts |
| `expenses:write` | enter, post and cancel expenses (second factor: it pays) | admin, accounts |
| `tds:read` | see TDS sections, rates and deductions | admin, owner, accounts |
| `tds:write` | add and correct TDS sections and rates (second factor, like `gst:write`) | admin |
| `gst:file` | mark a month's return filed, and ask to undo it | admin, accounts |
| `books:lock` | move the period lock forward, close a year, and ask to move the lock back or reopen a year | admin, accounts |
| `books:unlock` | approve moving the lock back, reopening a year, and undoing a filing (D-06; second factor) | admin, owner |
| `bank:read` | see statement lines, matches and the reconciliation statement (§11, §12) | admin, owner, accounts |
| `bank:reconcile` | import statements (with `statement_files:write` for the upload itself), match and unmatch, book bank charges (second factor: it posts to Bank) | admin, accounts |
| `reports:read` | see the accounts reports (§13) | admin, owner, accounts |
| `migration:write` | run the Vyapar import steps and the daily compare, and mark a day reconciled (§14) | admin, accounts |
| `migration:approve` | approve opening balances, close the opening import, sign the parallel month's weeks (§14; second factor: it posts every opening balance) | admin, owner |

- **Record scope (E7):** `expenses:read` names `expenses` in its `records`, owned by `created_by`. `tds:read`,
  `gst:file`, `books:lock`, `books:unlock` and the five keys of §11 to §14 act on company rows, not owned records,
  so each is `allOnly`. Each
  ticket that adds one rewrites the role-scope CHECK whole, and the last migration sets the list.
- **Deposits** are recorded under `payments:write`, which already moves money with the second factor.
- **No one approves their own unlock:** `books:unlock` is checked by `defineApproval`, which refuses the requester.
  An admin's own request needs the owner or another admin.
- Every new error code is declared on each route it can reach (RAD-134's guard), and every new GET joins the read sweep
  (RAD-149).

### 10. Who builds what, and the tests each owes

| Ticket | Session | Tables, settings and rows its migration adds |
|---|---|---|
| M4-04 | backend | `gst.credit_from`; the credit columns on bill lines; lib-gst's `inputCredit` |
| M5-02 | backend | `expense_categories`, `expense_category_accounts`, `expenses` and lines; the category column on service bills' `charge` lines; the `expense_bill` file kind; the `accounts.expense` series; the `allocatable_documents` row; `expenses:read`, `expenses:write` |
| M5-10 | backend | `tds_sections`, `tds_rates` (seeded), `tds_deductions`, `tds_deposits` and lines; the default-section columns on parties and categories; `parties.pan_inoperative`; the `accounts.tds_deposit` series; `tds:read`, `tds:write` |
| M5-08 | backend | `gst_filed_lock`, `gst_filings`, `filing_undo_requests`; the entry-kind trigger on `journal_entries`; `gst.filing_frequency`, `gst.filing_start`; `gst:file`, `books:unlock` |
| M5-09 | backend-3 | `period_unlock_requests`, `year_closes`; the `year_close` exemption in the period-lock trigger; `accounts.year_end_checklist`; `books:lock` (and `books:unlock` if it lands before M5-08) |
| M5-11 | backend-3 | `statement_formats`, `statement_imports`, `bank_statement_lines`; the PDF reader in the worker; `bank:read`, `bank:reconcile` |
| M5-13 | backend-3 | `bank_matches` and its two link tables; the `bank_charge` entry kind; `bank.match_days`; the `bank_matched` check on cancels |
| M5-14 | backend-3 | the report views and indexes; `reports:read` |
| M5-16 | backend-3 | lib-platform's `defineImport` and `import_runs`; `opening_balances` and the `accounts.opening` series; `accounts.cut_over_date`, `accounts.opening_closed_on`; `migration:write`, `migration:approve`; `tools/mask-vyapar` |
| M5-17 | backend | `opening_invoices`, `opening_bills` and their lines, `opening_receipts`, `opening_payments`; their `allocatable_documents` rows |
| M5-18 | backend-3 | `reconciliation_runs`; the daily compare |

- lib-accounts' tables split by family: `tables-expenses.ts`, `tables-tds.ts`, `tables-filings.ts`,
  `tables-close.ts`, each in `TABLE_FILES`. M5-08 owns the change to `lockPeriod`; M5-09 adds `lockPeriodForMove` in
  its own file, and whichever lands second merges dev in.
- Migration numbers come from the coordinator. The shared registries stay append-only (ADR-008 §14).

**Tests**, beyond each document's happy path:
- **M4-04:** a composition and an unregistered supplier's bill claim nothing, and the tax lands in the price
  difference; adding `composition` to `gst.credit_from` changes that with no other change.
- **M5-02:** F12 (without TDS until M5-10), F27, F28 and its variant; a line on an account not in its category, and a
  category pointed at Bank or Debtors, are refused by the database; `bill_file_required`, `tax_mismatch`,
  `gstin_mismatch`; a cash expense over the limit; cancel restores the payable.
- **M5-10:** F12, F18 and F29 with its variant; an `excess` rate row (a test row, not seeded) deducts only on the year's
  base over the limit; a cancelled booking leaves the year's base; an advance applied at the bill isn't counted twice in
  the base, and one applied after it changes nothing; two bills for one payee saved at once deduct the catch-up once; a
  rate row dated 1 July applies to a 1 July bill and not a 30 June one, and a catch-up after it keeps the earlier bills
  at the old rate; a booking under both limits still writes its zero row; a payee whose PAN arrives mid-year is never
  refunded below zero; `tds_needs_party`, `tds_deposited`; the books check fails when a deduction's row is missing.
- **M5-08:** an entry dated in a 3B-filed month is refused through each door (invoice, credit note, bill, supplier
  return, expense), including a 0% invoice, a composition supplier's bill and a blocked expense; a payment in that month
  posts; cancelling an invoice of a GSTR-1-filed month is refused, and a bill's cancel posts in the open month; the
  current month and a gap are refused; an undo by its asker is refused, by another `books:unlock` holder succeeds, and
  only for the latest filing; marking waits for a posting in flight.
- **M5-09:** F20 exactly; the close waits on a posting in flight dated 30 March (through the lock move) and includes
  it; a move back by its asker is refused, and by another holder succeeds; a request made stale by a later move is
  refused `version_changed`; a move back into a closed year is refused; reopen, post, close again; two decisions on
  move-back requests at once don't deadlock; P&L of a closed year reads without the close.
- **M5-11:** an .xlsx, a tab-separated CSV, a Windows-1252 file and a 5 MB file each import (GL-052); a header under
  title lines is found; an in and an out of the same amount on one day are both kept; importing an overlapping file
  again adds nothing; an earlier month filled in after a later one chains and imports, while a hole is refused;
  `balance_chain_broken` and `balance_gap` name their rows, and a refused row inserts nothing; a PDF over the page limit
  is refused in the worker, never the api; an unknown PDF layout is refused; undoing an import is refused once a line is
  matched.
- **M5-13:** a payment matched by reference, and one by party; the same amount and date with no reference or party is
  only a suggestion; one entry matched over two bank lines, and two entries over one; a bank charge booked from a match,
  then unmatched, reverses it, and unmatching succeeds in a locked period with the reversal dated today; a cancel and a
  match on one payment run at once and only one wins; a receipt cancelled and entered again offers only the live line; a
  one-word party hit is only a suggestion; two people matching one line get `already_matched`; cancelling a matched
  payment gets `bank_matched`; a newest-first statement checks its chain; a year of 20,000 lines auto-matches in batches
  without a long transaction.
- **M5-14:** each report's first page and totals under 1 second at 50,000 journal lines; the trial balance and balance
  sheet agree with the books check; a ledger's second page opens at the first page's closing balance; a closed year's
  P&L; the ageing's "not on a bill" column; costs masked without `cost:read`.
- **M5-16:** a masked fixture's dry run lists every problem by row and column and writes nothing; a commit of a changed
  file is refused `import_not_dry_run`; steps out of order are refused; opening balances approved by their maker are
  refused; a commit re-checks a row whose party was changed after the dry run; units in stock come in at step 3 and the
  books check's units-equal-quantity line holds; a mid-year cut-over's TDS rows keep the catch-up right;
  `opening_totals_differ`; after `accounts.opening_closed_on` every step answers `opening_closed`; the books check
  passes after the last step (GL-062).
- **M5-17:** an opening invoice is paid, chased and credited up to its summary line, and goods back come in at the
  current average; it isn't in RadCore's GSTR-1, while its credit note is; a second invoice with the same Vyapar number
  in that year is refused; a party with an open invoice and an advance ties out, then the advance is applied.
- **M5-18:** a day with a difference can't be marked reconciled until the difference has a reason; a ₹1 gap passes only
  when it is the day's round-off; a stock value gap is logged as "stock valuation"; a document in only one system is
  listed.

### 11. Bank statements (M5-11; RC-135, RC-136)

- **One account per statement.** Each bank account is an account in the Bank group (ADR-006 §2). The person picks it
  when uploading, and anything else is refused (`not_a_bank_account`). Statements by mail, and their routing rules, are
  M7's (M5-12 moved there, 27 Nov).
- **The file** is the existing `statement` file kind, under `statement_files:write`. CSV and Excel are read by
  lib-platform's `readTable` in its isolate. A PDF is read only in the worker, by unpdf, within ADR-003 §7's limits (15
  MB, 200 pages, 30 seconds), never in the api (RC-135). A password-protected PDF uses the bank account's stored
  statement password (`secrets`, RAD-65).
- **Layouts.** Each bank account has one `statement_formats` row: the columns holding the date, narration, reference,
  withdrawal, deposit and balance, the date format, whether the newest row comes first, and the header's column names,
  by which the header is found below any title lines (GL-053). It's set at the first upload and reused. A PDF is read by
  a layout written in code for that bank, one per bank the company uses; an unknown layout is refused
  (`statement_layout_unknown`), and the person uploads the bank's CSV or Excel instead.
- **Lines.** `bank_statement_lines`: the account, the import (`statement_imports`), the row number, the value date, the
  narration and the reference as given (bounded text), the direction, the amount and the running balance (`Money`). A
  row with both or neither of withdrawal and deposit is refused, with its row number.
- **The running balance is required and checked (RC-136).** A file without one is refused (`balance_required`). Each
  row's balance is the previous row's plus or minus its amount (`balance_chain_broken`, with the row). Rows that overlap
  lines already stored for the account must agree with them. New rows must chain to the stored lines on either side of
  them: so an earlier month may be filled in after a later one, as long as its last balance leads into the next stored
  line, and a hole between files is refused (`balance_gap`).
- **Duplicates (RC-136).** A line is already present when the account, value date, direction, amount, running balance
  and reference (empty when none) all equal a stored line's: a unique index on those columns. Two genuine payments of
  the same amount on one day, or an in and an out, have different balances, so both are kept. The import reports what
  was new, what was already present, and what was refused.
- **In the worker, all or nothing.** The upload stores the file, then a job (through the outbox) parses, checks and
  inserts the lines in one transaction. A file with any refused row inserts nothing, and the person sees every refused
  row. Nothing posts at import: statement lines aren't ledger rows.
- **Undoing an import** deletes its lines, only while none is matched (`statement_in_use`), and is audited.

### 12. Reconciliation (M5-13; RC-087, RC-145, RC-210; CA-38)

- **A match** (`bank_matches`) joins one or more statement lines to one or more journal lines on the same bank account
  (`bank_match_statement_lines`, `bank_match_journal_lines`). So one book entry can cover several bank lines, and one
  bank line several entries (RC-210). A statement line and a journal line are each in at most one live match (partial
  unique indexes), and the two sides' signed totals are equal, checked at commit (`match_unbalanced`).
- **What can match (RC-145).** A candidate is an unmatched journal line on that account, of the same amount, dated
  within `bank.match_days` of the value date (5 by default), whose entry is neither reversed nor a reversal: a match on
  such a line is refused (`entry_reversed`), so a document cancelled and entered again offers only its live entry.
  Candidates are ranked by:
  - **reference:** the line's reference, or a UTR, cheque or transaction number in its narration, equals the posting
    document's reference (a payment's `reference`, M3-12);
  - **party:** the narration holds the posting document's party's whole normalised name; one word of it (five letters
    or more) only ranks a suggestion higher;
  - then the nearest date.
  Amount and date alone never make a match.
- **Auto-match** runs in the worker after each import (RC-087). It matches only a line with exactly one candidate that
  agrees on amount and reference, or on amount and the party's whole name with no other candidate in the window, and
  marks the match `auto`. Auto-match is one to one; a split is the person's. Everything else is a suggestion the person
  confirms. A line's candidates come from one indexed read (M5-13 adds a generated `signed_amount`, debit less credit,
  and an index on `journal_lines (account_id, signed_amount, business_date)`), so a year of statements takes linear
  work, and the job works in batches of 500 lines, each its own short transaction.
- **Bank charges and interest** with no book entry are booked from the match: a `bank_charge` entry, a new ADR-006 §3
  kind on ordinary accounts only (Dr the charges account, Cr Bank; or Dr Bank, Cr the interest account), matched to the
  line in the same save. Its source is its `bank_matches` row, so matching again after an unmatch posts a new entry
  under ADR-006 §3's one-entry-per-document key. No input credit is claimed from a statement alone (CA-38). When the
  bank's tax invoice arrives, the person unmatches (which reverses the charge), enters the expense paid from that bank
  account (§3), and matches the expense to the line, so the charge is booked once.
- **Unmatching** removes the match, at any time, and is audited. A charge it booked is reversed in the same save, dated
  that day (RC-210). A match touches no ledger row, so the period lock doesn't stop it; the reversal of a charge is
  dated in the open period.
- **Cancelling a matched document** (a payment or receipt, an expense, a TDS deposit, a transfer) is refused
  (`bank_matched`): unmatch first. M5-13 adds the check to those cancels.
- **The reconciliation statement** for an account and a date: the book balance, the statement balance, and between them
  the unmatched book lines and the unmatched statement lines, each listed (GL-132).
- **Lock order (§7):** step 1 (`lockPeriod`); then each matched journal line's posting document `FOR SHARE`, by table
  then id (ADR-006 §1 step 2, as drafts lock their sources, ADR-008 §12); then the statement lines by id, `FOR UPDATE`;
  then the journal series when a charge posts. A cancel takes its document `FOR UPDATE`, so a match and a cancel of the
  same document take turns: whichever is second sees the other (`bank_matched` or `entry_reversed`). Journal lines
  themselves aren't locked: the unique indexes refuse a second match (`already_matched`).

### 13. Reports (M5-14, RC-176)

- **The list:** the day book; account and party ledgers; receivables and payables ageing by due date, with a "not on a
  bill" column for receipts and payments not yet applied (ADR-005 §7a); the trial balance; profit and loss; the balance
  sheet; the cash book and the bank book; stock valuation as at a date; profit by bill and by customer; the HSN summary.
  Each is a GET under `reports:read`, paged, with an export (`defineExport`, csv-stringify's `escape_formulas`).
- **Added up in the database (RC-176).** No report reads a whole ledger to show a page. Totals are SQL aggregates. A
  page is a keyset page on `(business_date, id)`: a date and a tie-break, so no timestamp cursor is involved. A ledger's
  running balance is a window over the page, started from one indexed aggregate of everything before the page's first
  row. Where Drizzle can't express a window or a grouping, a view in packages/db does (ADR-002 §3).
- **Indexes** M5-14 adds: `journal_lines (account_id, business_date, id)`, `journal_lines (party_id, business_date, id)`
  where the party is set, and any other a report's query plan shows it needs.
- **One snapshot.** A report of several figures (trial balance, balance sheet, P&L, ageing) reads in one read-only
  `REPEATABLE READ` transaction, as the books check does (ADR-006 §7).
- **Closed years** read without their `year_close` entry (§6). Stock valuation and profit by bill and customer show
  costs as `cost()`, masked without `cost:read`.
- **Speed (the plan's p.7 targets):** each report's first page and totals answer in under 1 second with 50,000 journal
  lines, on PostgreSQL 16. M5-14's test seeds that many lines and times each report.
- **The books check's Goods Delivered Not Invoiced piece** (RAD-95) folds in here, and every report total the books
  check also computes must agree with it.

### 14. Moving from Vyapar (M5-16 to M5-18; RC-038, RC-120, RC-121; CA-26 to CA-28; D-16)

**Real files only after Gate 0 (D-16, GL-228).** M5 builds the import and rehearses it on masked files; the repo holds
only made-up fixtures. `tools/mask-vyapar` masks a real export on the owner's machine (names, phones, emails, GSTINs,
PANs, addresses and narrations, each replaced the same way wherever it appears, so totals and links still tie), and only
its output is shared. The cut-over date is set at go-live (M8), in `accounts.cut_over_date`.

- **The import engine** (M5-16 builds it) is lib-platform's `defineImport`, ADR-001 §8b's line. An upload (file kind
  `import`) is read by `readTable` in its isolate; the header is found among the first 20 rows by its column names
  (GL-053); each row is checked by the module's row function. A **dry run** lists every problem by row and column and
  writes nothing. A commit is allowed only for a file whose hash matches a dry run with no problems
  (`import_not_dry_run`), and runs in one transaction, in the worker, under the job's own statement timeout. The hash
  only proves it's the same file: the commit runs every row check again inside its own transaction, since the data may
  have changed since the dry run (a party added by hand), and any failure commits nothing. Each run is an `import_runs`
  row (the step, file, hash, counts, who, when, dry or committed).
- **The steps, in order** (GL-055 to GL-058), each refused until the one before is committed (`import_step_order`):
  1. **parties:** customers, dealers and suppliers, with GSTIN, state, phone, credit terms and each
     supplier's kind (§2);
  2. **items:** HSN (4 to 8 digits), GST rate, unit and prices; and, if the owner decides so (GL-059), serial numbers
     of units sold before the cut-over, as sold units;
  3. **opening stock:** quantity and agreed value per item and location (F1), with the serial numbers of the units in
     stock, which come in with the movement that brings them (ADR-006 §5, RA007);
  4. **account balances:** cash, each bank account, loans, capital, TDS (as `tds_deductions` rows, §4) and the
     GST credit brought forward by head (GL-057);
  5. **open documents** (M5-17): each unpaid invoice and unpaid purchase bill, and each party's money not yet
     applied to one (an advance, a booking deposit, a payment on account, a credit or debit note not yet applied).
- **Dated the day before the cut-over.** Every opening entry is kind `opening`, dated the day before
  `accounts.cut_over_date`, in an open year. If the cut-over is mid-year (CA-26), step 4 also brings the year's income
  and expense balances so far, so the year's P&L is whole, and the year's TDS so far as `tds_deductions` rows per payee
  and section (base and amount), so §4's yearly limits and catch-up still hold. Rows already deposited before the
  cut-over are marked `deposited_before_cut_over`: they count in the year's sums, can't be deposited again, and aren't
  in TDS Payable's opening balance, which is the undeposited rows only.
- **Opening balances are approved by someone else (RC-038, GL-056).** Steps 3 and 4 make a draft `opening_balances`
  document, which posts only when someone other than its maker approves it (`defineApproval`, kind `opening-balances`,
  under `migration:approve`; its spec declares `lockFirst`). Stock comes in at the import's agreed value, which the CA
  confirms (CA-27). It's numbered from `accounts.opening` (`OB`), and each item and location's batch is named by that
  number (ADR-006 §1, §4a).
- **It ties out.** Opening Balance Equity takes the difference. The dry run refuses a step whose party balances don't
  add up to the file's Debtors or Creditors total (`opening_totals_differ`), and the books check runs after the last
  step (GL-062).
- **Open documents one by one (M5-17, RC-120, GL-058).** `opening_invoices` and `opening_bills`: the party, Vyapar's
  number and date, the due date, the place of supply, the amount still unpaid, and one summary line per GST rate
  (taxable value, rate, tax) as Vyapar billed it. Each keeps Vyapar's number and draws from no series of ours: an
  invoice's is unique for its year, a bill's for its supplier and year, as ADR-008 §7's check. It posts Dr Debtors (or
  Cr Creditors) against Opening Balance Equity for the unpaid amount only. Each is in `allocatable_documents`, so
  payments apply to it, reminders chase it (ADR-007 §10), and a credit note can be raised against it (ADR-007 §6), up to
  its summary line's value; goods taken back on one come in at the item's current average (CA-28). Neither is in
  RadCore's GSTR-1 or 3B; a credit note against one is, in its own month (ADR-010).
- **Money not yet applied (GL-058).** Each party's unapplied amount comes in as an `opening_receipts` row (a customer's:
  Dr Opening Balance Equity, Cr Debtors) or an `opening_payments` row (a supplier's: Dr Creditors, Cr Opening Balance
  Equity), with Vyapar's reference and date. Each is registered in `allocatable_documents` as a credit, so it's applied
  to an opening or new invoice or bill like any advance (ADR-005 §7a), or refunded (ADR-007 §5). A booking deposit is a
  customer's opening receipt, applied when the booking's invoice is raised. The tie-out counts these: a party's balance
  is its open documents less its unapplied money, and that's what `opening_totals_differ` compares.
- **Closed after use (RC-038, GL-063).** Once the owner signs the tie-out, someone holding `migration:approve` sets
  `accounts.opening_closed_on`, and the period lock moves to at least the day before the cut-over, so nothing else posts
  before it. From then every step answers `opening_closed` (409), and nothing in the app reopens it. A later fix is an
  ordinary document: an adjustment, a journal or a credit note.
- **The parallel month (M5-18, RC-121, GL-118 to GL-139).** Each working day Accounts uploads that day's Vyapar exports
  (GL-119), read by the same engine. RadCore compares each of GL-123 to GL-136's figures with its own, from §13's
  queries, and lists each document found in one system only, or differing in amount, party, tax head or date (GL-138).
  Each figure is a `reconciliation_runs` row (the date, the figure, Vyapar's value, RadCore's, the difference, the
  reason, who signed).
  - The tolerance is 0, or ₹1 where the whole gap is the day's round-off (GL-136). Stock value has none until CA-27; a
    value gap is logged with the reason "stock valuation" (GL-134).
  - Accounts marks the day reconciled under `migration:write` once every difference has a reason, and the owner signs
    the week under `migration:approve`. RadCore's own tie-outs (GL-137) are the books check and §13's totals.

## Consequences

- Each Wave B ticket has its tables, checks, keys and lock order fixed before it starts. The CA's answers change
  settings, categories and table rows, not tables (D-08); only CA-19's base and timing would touch code, in one
  function.
- Strict defaults cost money until the CA answers: a new category claims no credit, and TDS is deducted at booking.
  That's deliberate, and each is one admin edit to change.
- Undoing a filing, moving the lock back and reopening a year each need two people (D-06). With only one admin and the
  owner, the owner must approve the admin's requests.
- An outward document of a filed month can't be cancelled; until ADR-010's amendments, it's put right with a credit
  note.
- A statement must carry its running balance, so a bank file without one is refused. That's what makes duplicates
  safe to drop (RC-136).
- Auto-match only takes the sure cases, so the person still confirms most matches in the first months. The window and
  the rules are settings and code in one place, to widen once real statements show what's safe.
- The Vyapar import runs once, for real, after Gate 0. M5 proves it on masked files and fixtures only.

## Alternatives considered

- **One filed-month date for every door.** It would lock purchase bills when GSTR-1 is filed, a week before 3B, when
  the month's late bills are still being booked. Two dates, by return, follow what each return reports.
- **The filed-month lock in each document's service.** That's v1's way, and it missed half the doors (RC-012). One
  trigger on the entry kinds a return reports covers every door at once, including ones not built yet.
- **TDS at payment, as v1.** Simpler, but wrong where the section says "credit or payment, whichever is earlier"
  (CA-19), which is every section here.
- **Match on amount and date, then let the person correct it.** v1's way (RC-145); it matched the wrong one of two
  equal payments. A reference or party must agree too.
- **Bring Vyapar's open balances in as one figure per party.** Simpler, but an old invoice then can't be credited,
  returned against or chased (RC-120, CA-28).
- **A per-expense override of blocked credit, with a reason** (CA-05's suggestion). It would let a claim through with
  one typed line. Changing the category is audited and admin-only, and it's the same for every later expense.
- **Close the year without requiring the lock first.** The close would have to take a snapshot after waiting for
  postings, which `REPEATABLE READ` can't do: its snapshot is taken before the wait.
