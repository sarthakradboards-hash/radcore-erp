# ADR-007: Sales documents and their dates

- Status: proposed
- Date: 2026-11-19
- Ticket: RAD-105 (M3-01). The design basis for M3-07 (credit and price checks), M3-08 (quotes, orders,
  deliveries), M3-09 (invoices), M3-10 (credit notes, cancellations, refunds), M3-11 (quick bill), M3-12 (payments)
  and M3-13 (bookings).
- Builds on: [ADR-005](005-database.md) §6 (business date), §7a (allocations), §7b (posted documents);
  [ADR-006](006-ledger.md) §1 (lock order), §3 (entries and numbers), §4 to §6 (stock, units, postings), §8
  (figures); [ADR-001](001-layers.md) §8b (approvals).
- Source: the register (RC-022, RC-061, RC-110, RC-111, RC-113, RC-125, RC-126, RC-127, RC-131, RC-207); CA
  questions CA-08 to CA-11, CA-24, CA-33, CA-35, CA-43, CA-44 and CA-47
  (docs/source/10-Questions-for-CA-and-Counsel.md).

## Context

In v1 the dates on invoices, credit notes and receipts were unbounded, goods left before they were invoiced,
advances had no GST rule, and the financial year followed whatever date was typed (RC-111). An issued invoice
reprinted with today's company details (RC-022), a credit note could cut output tax at any age (RC-110), and
cancelling an invoice deleted its receipts (RC-126).

This ADR fixes, before M3 builds them, each sales document's states, numbers, dates and database guards, and how
advances, credit notes, cancellations and refunds post. Where a rule waits on the CA, the default here is the
stricter reading, and the setting that changes it is named. The CA's answers change figures and settings, not shape.

## Decision

### 1. The documents

| Document | Table (lines) | Library | Posts | States |
|---|---|---|---|---|
| Quote | `sales_quotes` (`sales_quote_lines`) | lib-sales | nothing | draft → sent → accepted, declined or expired |
| Order | `sales_orders` (`sales_order_lines`) | lib-sales | nothing | draft → confirmed → closed or cancelled |
| Delivery (challan) | `deliveries` (`delivery_lines`) | lib-sales | stock, units, journal | draft → posted → cancelled |
| Delivery return | `delivery_returns` (`delivery_return_lines`) | lib-sales | stock, units, journal | draft → posted → cancelled |
| Invoice | `invoices` (`invoice_lines`) | lib-sales | journal | draft → posted → cancelled |
| Credit note | `credit_notes` (`credit_note_lines`) | lib-sales | journal, and stock and units when goods come back | draft → posted → cancelled |
| Receipt or payment | `payments` | lib-accounts | journal, allocations | draft → posted → cancelled |

- **Quotes and orders post nothing,** so they carry no ledger guard. Their services move their states, and a CHECK
  holds the status values. A confirmed order's lines change only through the order service, which runs M3-07's
  checks again. An order is **closed** when every line is delivered, or **closed short** when a person closes it
  with lines still undelivered. The undelivered quantities are released, and a reason is kept (RC-125). A posted
  delivery return that brings a line back below what was ordered reopens an order its deliveries closed
  (`closed → confirmed`), so the goods can go again; an order a person closed short stays closed (RAD-112).
- **A delivery** comes from a sellable place only (`place_not_sellable`, ADR-006 §4). Selling a demo or rejected
  unit is a transfer to a sellable place first (M4-06). A delivery made against an order is owned, for record
  scope (ADR-001 §6a), by the order's owner, copied when it's made; one with no order by its maker; and a return
  by its delivery's owner. So a salesperson sees the delivery of their own order, whoever made it.
- **A credit note is approved before it posts**, through `defineApproval` (RAD-38). It stays a draft while its
  request is pending. The approval's version hash means the approver approves exactly what was sent, and the
  approval's `approved` step posts it (ADR-001 §8b). Every credit note is approved, whatever its amount (Sarthak,
  19 Nov).
- **A refund** is a payment out to the customer (lib-accounts, §6), not a document of its own.
- **A vehicle booking** (M3-13) posts nothing itself. Its advance is a receipt (§5).

### 2. Database guards (ADR-005 §7b, RA004)

Every table above that posts attaches #185's two generic guards in its own migration, and adds its moves to
`state_transitions`, mirrored in lib-common's `STATE_TRANSITIONS`:

| Table | `guard_posted_document` arguments | Moves | Lines |
|---|---|---|---|
| `deliveries`, `delivery_returns` | `('draft', 'cancelled_at,cancelled_by,cancel_reason,cancel_entry_id', '')` | draft → posted, posted → cancelled | `guard_document_line(<table>, <parent column>, 'draft')` |
| `invoices`, `credit_notes` | the same cancel columns; write-once none until M5 adds `irn,ack_no,ack_date,signed_qr` | draft → posted, posted → cancelled | the same |
| `payments` | the same cancel columns | draft → posted, posted → cancelled | (no lines) |

While a document is a draft, anything on it changes. Its posting update sets everything posting writes: the number,
the posted entry's id, and an invoice's frozen issuer details (§7). From then on, only cancelling or a write-once
column changes it, and it's never deleted.

### 3. Numbers (M2-04)

Each posted or sent document draws its number from its own series (`defineSeries`), as the **last step** of the save
that posts it (ADR-006 §1). A draft has no number, so drafts thrown away leave no gaps.

| Series | Prefix (a setting) | Drawn when | Digits |
|---|---|---|---|
| `sales.quote` | QT | sent | 5 |
| `sales.order` | SO | confirmed | 5 |
| `sales.delivery` | DC | posted | 5 |
| `sales.delivery_return` | DR | posted | 5 |
| `sales.invoice` | INV | posted | 5 (Rule 46's 16 characters) |
| `sales.credit_note` | CN | posted | 5 |
| `accounts.receipt` | RV | posted | 5 |
| `accounts.payment` | PV | posted | 5 |

- **The financial year is the business date's.** That date is bounded (§4), so the year is always an open one.
- **The format** is `PREFIX/YY-YY/NNNNN`, for example `INV/26-27/00042`. A year keeps the prefix its first number
  took (RAD-87). The characters and length allowed wait on CA-44.
- **One series per document.** A second invoice series, such as counter and dealer, would be a new decision, not a
  setting.

### 4. Dates (RC-111)

Every document's `business_date` (ADR-005 §6) must be:
- **in an open financial year, and after the period lock.** The ledger rows refuse it otherwise (RA003, and the
  `fy_start` foreign key), and the service says so first (`year_not_open`, `period_locked`);
- **not after today**, today being the India date of the server's clock (`date_in_future`);
- **not before the document it comes from** (`date_before_source`):

| Document | Not before |
|---|---|
| order | its quote's date |
| delivery | its order's date |
| delivery return | its delivery's date |
| invoice | the date of every delivery it bills |
| credit note | its invoice's date |
| refund | the receipt or credit note it pays out |
| a cancellation | the date of what it cancels (ADR-006 §6: the mirror is dated the cancellation's day) |

A receipt has no source: an advance comes before the invoice.

**Goods leave with their invoice (CA-09).** Under section 31, a tax invoice for goods is issued at or before their
removal, so a delivery for a sale is invoiced the same day by default:
- an invoice's date may be at most `sales.invoice_lag_days` after the **earliest** delivery it bills, so every
  delivery on it is within the lag. An old challan can't slip through by being billed with today's. The setting is
  0 until CA-09 says otherwise (`invoice_too_late`);
- the To-invoice list shows every posted delivery not yet fully invoiced, oldest first;
- Goods Delivered Not Invoiced (ADR-006 §6) still carries a delivery's cost from its posting to its invoice, so the
  books stay right whatever CA-09 allows;
- a delivery that isn't a sale (goods on approval, job work, demo) is a stock transfer (M4-06), not a delivery, and
  isn't invoiced.

### 5. Advances and GST (CA-09)

- **An advance for goods** (a booking, a dealer's prepayment) is a receipt with no invoice yet. It posts Dr Bank or
  Cash, Cr Debtors (the party), so the party's balance turns credit. No GST is charged on it: for goods, tax isn't
  due on an advance. CA-09 is to confirm. It prints as a **receipt voucher** (Rule 50), numbered in `accounts.receipt`.
- **At the invoice, the advance is applied by an allocation** (ADR-005 §7a), with no new entry: both sides are
  already on the party's Debtors account. Figure F23.
- **An advance for services** (M6 job cards) owes GST when it's received. It isn't taken until CA-09 is answered, and
  M6 adds its row.
- **A refunded advance** is a payment out to the customer: Dr Debtors, Cr Bank or Cash. The refund names the receipt
  it pays back, so neither shows as open (F24).
- **A cancelled booking's advance** (M3-13, RC-127). Cancelling a booking says what happens to what's left of its
  advance (the receipts' amount less their net allocations and their refunds, posted or waiting for approval), so
  none is left unexplained. It's **refunded
  in full** (`bookings:refund_full`), **refunded in part** (`bookings:refund_part`), or **kept** (`bookings:forfeit`,
  once CA-47 is answered, below), and whatever isn't refunded or kept stays as the customer's credit on Debtors,
  named so on the cancellation.
  - Each choice is a key of its own, granted per role on the roles screen like any other (Sarthak, 20 Nov). Each
    needs the second factor, since each moves money (D-19). The cancellation takes a `reason()`. By default
    admin, owner and accounts hold both refund keys.
  - **Which refund key an amount needs:** all of what's left needs `bookings:refund_full`; more than nothing but
    less than that needs `bookings:refund_part`; nothing refunded needs neither. Without the key the amount needs,
    the cancellation is refused (`forbidden`, naming the key). So a role with only `bookings:refund_part` can't
    refund everything, in one refund or in several: each is judged against what's left at that moment, under the
    booking's row lock (`FOR UPDATE`, after the period lock), so two refunds at once take turns.
  - A refund is a payment out naming the receipt (F24), within the receipt's cap and under the cash limit (§8).
  - **Later**, what was left as credit is refunded from the cancelled booking under the same keys and rule. The
    booking reads what's still held live from its receipts, so it stays right whatever else applies them.
  - **A booking's advance is refunded only through its booking**, so the booking keys decide who may, as Sarthak
    asked. The receipt names what it's held for, `(held_for_table, held_for_id)` on `payments`, as an allocation
    names its document: lib-accounts stores the name and never reads the booking. POST /payments refuses a refund
    of a held receipt (`refund_through_owner`); the bookings service refunds it through lib-accounts' `refundHeld`,
    which no route reaches, after checking its own keys. The same cap and cash limit apply. Applying the advance to
    an invoice, or cancelling a receipt entered by mistake, stays as for any receipt.
- **Keeping an advance** (forfeiture) waits on CA-47: whether GST is due on the amount kept, and on which document.
  Until it's answered there's no posting, and `bookings:forfeit` and its route aren't built. What would be kept
  stays as the customer's credit, and it can be forfeited from there, at cancellation or later, once ADR-006 §6
  has its row.

### 6. Credit notes, cancellations and refunds

- **Two kinds** (ADR-006 §6): **value only** (a discount or price correction, no stock) and **goods back** (at the
  value they went out at, §4; a serial's sale is cleared, RC-128).
- **A credit note can't exceed what's left of its invoice,** line by line: the invoice line, less earlier credit
  notes on it (`exceeds_invoice`).
- **The time limit for cutting output tax (section 34(2), CA-10).** A credit note can't reduce output tax once it's
  dated after the earlier of two dates: 30 November following the end of its invoice's financial year (the setting
  `sales.credit_note_tax_deadline`, month and day), and the date that year's annual return was filed. M5-08's filing
  record gives the second date. Until it exists, or when the return isn't filed yet, the 30 November date alone
  applies. Such a note posts its tax to **GST Borne on Late Credit Notes** (system account `late_cn_gst`, an
  expense), not to Output GST (F25). It still needs approval like any credit note.
- **Cancelling an invoice** is refused while:
  - any allocation is still applied to it (net allocations aren't zero, ADR-005 §7a);
  - any credit note stands against it;
  - its month is filed (M5-08, CA-11).

  The user reverses those first. The receipts themselves are never touched (RC-126). The mirror entry is dated the
  cancellation's day (ADR-006 F10).
- **Cancelling a delivery** is allowed only while nothing on it has been invoiced or taken back (ADR-006 §4).
- **Cancelling a credit note** mirrors it exactly. Goods that came back on it go out again at the value they came
  back at, never as a new sale or a new return (RC-207).
- **A counter refund** (RC-126) is a goods-back credit note, then a refund in the same save (F26). Both are posted
  documents, so a cash refund is in the books the moment the cash leaves.

### 7. The invoice itself (RC-022, RC-113)

- **Frozen issuer details.** Posting copies the company profile into the invoice's own columns: legal name,
  GSTIN, address, state and state code. A reprint never reads the profile again (RC-022).
- **The buyer.**
  - A buyer with a GSTIN is B2B, decided by the GSTIN on the invoice when it's posted, never by the party's type
    (RC-113). A dealer without a GSTIN is unregistered, and the invoice says so.
  - An unregistered buyer's name, address and state are required when the invoice reaches Rs 50,000 (Rule 46). Taxable
    value or invoice value waits on CA-43; the default is invoice value, the stricter reading.
  - A counter sale below that limit may go to the seeded party **Counter customer** (system key `walk_in`). A
    Debtors line always names a party (ADR-006 §2).
- **Place of supply** decides CGST and SGST against IGST, from the company's state and the buyer's (or ship-to)
  state (CA-08).
- **Each posted line copies its GST rate (and rate source) at posting, never looking it up later.** That's the rate
  in force on the invoice's business date (M2-12).
- **Round-off.** The total is rounded to the rupee, and the round-off line is under 1 (ADR-005 §2, F7). CA-33
  confirms.
- **Every Rule 46 particular is on the printout** (CA-35), including "Tax payable on reverse charge: No" and the
  ship-to address where it differs.

### 8. Cash limits (RC-114, CA-24)

The receipt and payment services warn, with an owner override recorded through `defineApproval`, when:
- a party's cash receipts reach Rs 2,00,000 in a day (section 269ST);
- a party's cash payments exceed Rs 10,000 in a day, counted together (section 40A(3)).

The amounts are settings until CA-24 confirms them.

### 9. Credit and price checks (M3-07, RC-061, RC-131)

Each stage that commits a sale (confirming an order, a delivery, an invoice, handing back a repaired vehicle) runs
M3-07's `checkSale`. What it finds needs someone else's approval, through `defineApproval` under `sales:override`,
which needs the second factor (D-19, Sarthak, 20 Nov). The stage holds its party (`holdParty`, ADR-006 §1) after
locking its own documents and before the check, so two sales to one party can't both pass on the same balance.
`checkSale` itself takes no lock, since it also answers in read-only paths.
- **Credit, at every stage.** A party's exposure is its net Debtors balance (an advance already reduces it), plus
  what it has been delivered and not billed, at selling value with GST, plus this document, nothing counted twice:
  an invoice replaces the deliveries it bills. It's over when it's above the party's credit limit.
  - **A party with no credit limit set gets no credit** (Sarthak, 20 Nov): any exposure above zero is over, as with
    a limit of 0. Credit is given by setting a limit (`parties:manage`). The quick bill (M3-11) counts only the
    part left unpaid.
  - **Overdue:** a bill dated D is overdue after D plus the party's credit days. A party with none set takes the
    company's `accounts.default_credit_days`, which starts at 0, so a bill is due the day it's made (Sarthak,
    20 Nov).
- **Price, where a price is set:** on an order at confirmation, and on any line whose rate or discount isn't copied
  unchanged from an approved order line.
  - **Below cost:** the line's rate after discount, per base unit and before GST, against the item's moving average
    at the place (landed cost included; across the sellable places when the line has none), else its purchase
    price, never the last purchase rate. A stock item with neither is `cost_unknown`, and needs approval too. A
    person without `cost:read` sees the warning, never the figure.
  - **Discount:** the percent off the list rate, judged against **the document maker's limit** (the role of
    `created_by`), never the reader's, in exact decimals. A role with no limit of its own has
    `sales.discount_limit_default`, 0%.
- **One version for everyone.** An override approves the document's figures and the issues found. Nothing in them
  depends on who reads them, so the maker, the approver and whoever confirms or posts see the same issues. An
  edit, or a limit changed while a request waits, makes the request stale, and the maker asks again.

## Consequences

- M3-07 to M3-13 build to §1 to §9, and each document adds its own rows to `state_transitions` in its migration.
- ADR-006 gains three rows in §6 (advance, refund, late credit note), the `late_cn_gst` account in §2, and figures
  F23 to F26 in §8. M3-10's owner migration seeds `late_cn_gst`, and M3-11's seeds the Counter customer party.
- New settings: `sales.invoice_lag_days` (0), `sales.credit_note_tax_deadline` (30 November) and the two cash limits.
  Each is the strict default until its CA answer. Also `accounts.default_credit_days` (0), lib-accounts' as the
  owner of parties' terms, which M3-15's To collect reads too.
- New keys, each with the second factor (D-19): `sales:override` (M3-08), `bookings:refund_full` and
  `bookings:refund_part` (M3-13), and `bookings:forfeit` with CA-47's posting.
- New error codes for the services: `date_in_future`, `date_before_source`, `invoice_too_late` and `exceeds_invoice`.
  The database's own guards stay RA003 and RA004.
- CA-47 (GST on a forfeited advance) is added to the CA questions.

## Alternatives considered

- **Number drafts.** It's simpler to show a number early, but abandoned drafts would leave gaps, and an invoice
  series must be continuous (Rule 46).
- **Let goods leave first, invoicing at month end.** That's v1's way. Section 31 ties a goods invoice to removal,
  so it's the exception a setting allows after CA-09, not the default.
- **A separate Customer Advances account.** It would make advances visible in the trial balance, but every advance
  would then need moving to Debtors at the invoice. On Debtors, the allocation alone does the set-off.
- **A pending state on credit notes.** The approval engine already holds the request and its version hash. A second
  state on the document would need the guards to allow posting from it.
- **One key for whatever happens to a booking's advance.** Simpler, but Sarthak wants each choice adjustable per
  role (20 Nov). With a key per choice, a role can refund in full without being able to keep any of an advance.
- **No limit set means no limit.** It would let a new party buy on credit before anyone decided it should. Sarthak
  chose the other way (20 Nov): credit is given by setting a limit.
