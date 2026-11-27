# ADR-009: Accounts rules

- Status: proposed
- Date: 2026-11-27
- Ticket: RAD-150 (M5-00), from the M5 plan Sarthak approved on 27 Nov ("Approve as drafted"). This first part is the
  design basis for M4-04 (input credit, RAD-139, moved into M5), M5-02 (expenses), M5-10 (TDS), M5-08 (the filed-month
  lock) and M5-09 (the period lock and year close). A second PR adds bank import and matching (M5-11, M5-13), the
  reports (M5-14) and the Vyapar import (M5-16 to M5-18) as §9 onwards.
- Builds on: [ADR-006](006-ledger.md) §1 (lock order), §2 (accounts and posting rules), §3 (entries, the lock under
  the lock), §6 (what each document posts), §7 (books check), §8 (F12, F18, F20); [ADR-008](008-buying-and-stock.md)
  §7 and §7a (bills and the interim input-credit rule), §12 (lock order), whose conventions this ADR follows;
  [ADR-001](001-layers.md) §6a (record scope), §8b (approvals, `lockFirst`).
- Source: the register (RC-012, RC-014, RC-039, RC-058, RC-060, RC-163); plan flow 9; CA-03, CA-04, CA-05, CA-11,
  CA-12, CA-18 to CA-22, CA-24 and CA-25 (docs/source/10-Questions-for-CA-and-Counsel.md); D-06, D-08.

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
the line's own account for a service bill or an expense.
- **The supplier's kind (CA-04).** A party is `regular` (a GSTIN, not composition), `composition`, or `unregistered`
  (no GSTIN), read from the columns parties already have. The setting `gst.credit_from` lists the kinds whose bills
  carry credit, by default `['regular']`. A bill's GSTIN as printed must be the party's (ADR-008 §7). SEZ and overseas
  kinds come with D-10's foreign suppliers in M9.
- **Blocked credit (CA-05).** Each expense category (§3) says `credit: allowed | blocked`, and a blocked one names its
  section 17(5) clause. A new category starts blocked. A service bill's lines name an expense category too (M5-02 adds
  the column), so the same rule covers them. Goods bought for stock aren't blocked.
- **The state and the tax heads.** CGST and SGST are claimed only from a supplier in the company's state, and IGST only
  from one in another state. A hotel in Karnataka that charges its own CGST and SGST gives a Maharashtra GSTIN no
  credit (F28). Where lib-gst works the tax out (goods bills), the heads always match; where they're typed as printed
  (expenses, service bills), a mismatch means no credit.
- **What the line records:** the credit claimed by head, and, where none, why (`supplier_kind`, `blocked`, `state`).
  ADR-010's 3B tables read the claimed and the ineligible amounts from here.
- **Not enforced in M5 (CA-12):** section 16(4)'s cut-off, matching to GSTR-2B, Rule 37's 180-day reversal and Rules
  42 and 43. Until the CA says which the software must hold, they're the CA's monthly checklist, and ADR-010 says where
  each would go.
- Bills posted before M4-04 keep what they posted. The CA's answers change `gst.credit_from` or a category's rule,
  never the tables.

### 3. Expenses (M5-02, RC-058)

- **Categories.** `expense_categories` (name, `credit`, the 17(5) clause when blocked, a default TDS section, `active`)
  and `expense_category_accounts (category_id, account_id)`, the accounts each may post to. An allowed account is an
  ordinary expense account: a composite foreign key to `accounts (id, type, control_kind)` (M5-02 adds that unique
  key), with the row's copies held by CHECK to `expense` and `none`, so a category can never point at Bank, a control account or an income account.
  Categories are set up under `accounts:write`, like the chart.
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
  lists (contractors, professional and technical fees, rent of building and of machinery, commission, interest,
  purchase of goods), each row naming its source and marked unconfirmed until the CA signs it (D-08).
- **Which section.** A supplier party may name a default section, and so may an expense category. A bill or expense
  line takes the party's, else the category's; the person can change it, and clearing a default needs a reason.
- **When (CA-19):** at booking, the earlier of credit and payment. A purchase bill (services, a job worker's bill) or
  an expense deducts when it posts. An advance paid before any bill deducts at the payment (ADR-006 §6), and a bill it's
  applied to deducts that much less.
- **The base (CA-19):** the taxable value before GST, where the bill shows GST separately.
- **How much,** for the payee, section and financial year:
  - if the year's base so far, this booking included, is over the yearly limit: each of the year's bookings at the
    rate in force on its own date, less what's already deducted this year, and never below zero. So the booking that
    crosses the limit catches up the earlier ones (F29), and a rate change mid-year doesn't reprice them;
  - otherwise, if this booking alone is over the single limit: the rate in force on its date, on this booking;
  - otherwise nothing;
  - never more than the booking's amount payable. What's left is deducted at the payee's next booking, by the same sum.
- **No PAN (CA-20):** a payee with no PAN, or one marked inoperative (`parties.pan_inoperative`), is deducted at the
  row's `rate_no_pan`.
- **Rounding (CA-21):** to the nearest rupee, half up, in one function.
- **The record.** Every booking line with a section writes a `tds_deductions` row (the document, payee, section,
  month, base, rate, whether the no-PAN rate applied, amount), with the posting, even when it deducts nothing. So the
  year's base and what's deducted are one indexed sum on `(party_id, section_id, financial_year)`, never a read of
  every bill. The entry credits TDS Payable (F12). A payment made with TDS (an advance, ADR-006 §6) writes its row the
  same way, and M5-10 replaces M3-12's typed TDS on payments made with this sum. A line with a section needs a
  supplier (`tds_needs_party`).
- **Two bookings for one payee take turns:** a line with a section holds the payee's party row (`holdParty`, ADR-006 §1
  step 3), so two bills can't both catch up the same year. This adds a party lock to ADR-008 §12's step 3, for TDS only.
- **Deposits (F18).** A `tds_deposits` document (challan number, BSR code, the date paid, the bank account) names the
  deductions it pays, each in full, under `payments:write`. It posts `tds_deposit`: Dr TDS Payable, Cr Bank. A
  deduction is deposited once (a unique key on the deduction).
- **Cancelling** a booking reverses its deduction, only while it isn't deposited (`tds_deposited`). The correction
  route for a deposited one waits on CA-22, with returns and certificates (RC-181, M7).
- **The books check (ADR-006 §7)** gains a line: TDS Payable equals the deductions less those deposited.
- **Lower-deduction certificates** (a lower rate for one payee) aren't built in M5. If one is needed, it's a dated row
  per party, not a redesign.

### 5. The filed-month lock (M5-08, RC-012; CA-03, CA-11)

- **Monthly (CA-03).** `gst.filing_frequency` is `monthly`, the only value built. If the CA says QRMP, ADR-010 adds
  the quarter, and the snapshot below changes with it.
- **The lock row.** `gst_filed_lock`, one row (id 1): `gstr1_through` and `gstr3b_through`, each the last day of the
  latest month filed. It is ADR-006 §1 step 1's filed-month row: lib-accounts' `lockPeriod` reads it `FOR SHARE` after
  the period lock, and marking or undoing a filing takes it `FOR UPDATE`, so it waits for postings in flight.
- **Every door, in the database.** A trigger on `journal_lines` refuses a line on a `gst` control account whose
  business date is on or before `gstr3b_through`, and, for the outward kinds (`invoice`, `credit_note`), on or before
  `gstr1_through` (`month_filed`). Every GST amount reaches the books on a `gst` line, so this covers invoices, notes,
  bills, debit notes, expenses and, when D-10's imports come, customs IGST, with no door left to add by hand. Manual
  journals can't reach a GST account at all (ADR-006 §2).
- **Correcting a filed month (CA-11).** A reversal is dated the day it's made (ADR-006 §3), so it would pass the lock.
  For outward documents that's not allowed: an invoice or credit note whose own date is in a month GSTR-1 has filed
  can't be cancelled (`month_filed`); it's corrected with a credit note (ADR-007 §6) or, once ADR-010 builds them, an
  amendment. The cancel service checks it, and the trigger refuses a reversing entry of those kinds whose original is
  dated on or before `gstr1_through`. An inward document (a bill, an expense) may still be cancelled, dated today: its
  credit then comes back in the open month's 3B, which is where it belongs (CA-13 confirms the box).
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
    A lock move committed after its snapshot fails it with a serialization error, mapped through `dbErrors` to
    `try_again`;
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
  then the payee's party row, when a line has a TDS section (§4); then the series, `accounts.journal` before
  `accounts.expense` (ascending key, ADR-006 §1);
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
| TDS sections, rates, limits (§4) | the 2025 Act's published rows, unconfirmed | CA-18 | `tds_rates` rows |
| TDS timing and base (§4) | at booking; before GST | CA-19 | code, in the one TDS function |
| No-PAN rate (§4) | `rate_no_pan`, inoperative PAN included | CA-20 | `tds_rates` rows |
| TDS rounding (§4) | nearest rupee | CA-21 | the one rounding function |
| A deposited deduction's correction (§4) | refused | CA-22 | RC-181 (M7) |
| Cash limit on expenses (§3) | `accounts.cash_payment_limit` | CA-24 | the setting |
| Filing frequency (§5) | monthly | CA-03 | `gst.filing_frequency`, with ADR-010 |
| Correcting a filed outward document (§5) | cancel refused; credit note | CA-11 | ADR-010's amendments |
| Where an inward cancel lands (§5) | the open month's 3B | CA-13 | ADR-010's box mapping |
| Year-end checklist (§6) | CA-25's list, all ticked | CA-25 | `accounts.year_end_checklist` |

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

- **Record scope (E7):** `expenses:read` names `expenses` in its `records`, owned by `created_by`. `tds:read`,
  `gst:file`, `books:lock` and `books:unlock` act on company rows, not owned records, so each is `allOnly`. Each
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
| M5-02 | backend | `expense_categories`, `expense_category_accounts`, `expenses` and lines; the category column on service bill lines; the `expense_bill` file kind; the `accounts.expense` series; the `allocatable_documents` row; `expenses:read`, `expenses:write` |
| M5-10 | backend | `tds_sections`, `tds_rates` (seeded), `tds_deductions`, `tds_deposits` and lines; the default-section columns on parties and categories; `parties.pan_inoperative`; the `accounts.tds_deposit` series; `tds:read`, `tds:write` |
| M5-08 | backend | `gst_filed_lock`, `gst_filings`, `filing_undo_requests`; the `gst` line trigger; `gst.filing_frequency`, `gst.filing_start`; `gst:file`, `books:unlock` |
| M5-09 | backend-3 | `period_unlock_requests`, `year_closes`; the `year_close` exemption in the period-lock trigger; `accounts.year_end_checklist`; `books:lock` (and `books:unlock` if it lands before M5-08) |

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
- **M5-10:** F12, F18 and F29 with its variant; two bills for one payee saved at once deduct the catch-up once; an
  advance applied to a bill isn't deducted twice; a rate row dated 1 July applies to a 1 July bill and not a 30 June
  one, and a catch-up after it keeps the earlier bills at the old rate; a booking under both limits still writes its
  zero row; a payee whose PAN arrives mid-year is never refunded below zero; `tds_needs_party`, `tds_deposited`; the
  books check fails when a deduction's row is missing.
- **M5-08:** a line on Input GST dated in a 3B-filed month is refused, through each door (invoice, credit note, bill,
  supplier return, expense); a payment in that month posts; cancelling an invoice of a GSTR-1-filed month is refused,
  and a bill's cancel posts in the open month; the current month and a gap are refused; an undo by its asker is
  refused, by another `books:unlock` holder succeeds, and only for the latest filing; marking waits for a posting in
  flight.
- **M5-09:** F20 exactly; the close waits on a posting in flight dated 30 March (through the lock move) and includes
  it; a move back by its asker is refused, and by another holder succeeds; a request made stale by a later move is
  refused `version_changed`; a move back into a closed year is refused; reopen, post, close again; two decisions on
  move-back requests at once don't deadlock; P&L of a closed year reads without the close.

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

## Alternatives considered

- **One filed-month date for every door.** It would lock purchase bills when GSTR-1 is filed, a week before 3B, when
  the month's late bills are still being booked. Two dates, by return, follow what each return reports.
- **The filed-month lock in each document's service.** That's v1's way, and it missed half the doors (RC-012). The
  trigger on `gst` lines covers every door at once, including ones not built yet.
- **TDS at payment, as v1.** Simpler, but wrong where the section says "credit or payment, whichever is earlier"
  (CA-19), which is every section here.
- **A per-expense override of blocked credit, with a reason** (CA-05's suggestion). It would let a claim through with
  one typed line. Changing the category is audited and admin-only, and it's the same for every later expense.
- **Close the year without requiring the lock first.** The close would have to take a snapshot after waiting for
  postings, which `REPEATABLE READ` can't do: its snapshot is taken before the wait.
