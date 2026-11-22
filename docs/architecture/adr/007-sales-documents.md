# ADR-007: Sales documents and their dates

- Status: proposed
- Date: 2026-11-19
- Ticket: RAD-105 (M3-01). The design basis for M3-07 (credit and price checks), M3-08 (quotes, orders,
  deliveries), M3-09 (invoices), M3-10 (credit notes, cancellations, refunds), M3-11 (quick bill), M3-12 (payments)
  and M3-13 (bookings).
- Builds on: [ADR-005](005-database.md) §6 (business date), §7a (allocations), §7b (posted documents);
  [ADR-006](006-ledger.md) §1 (lock order), §3 (entries and numbers), §4 to §6 (stock, units, postings), §8
  (figures); [ADR-001](001-layers.md) §8b (approvals).
- Source: the register (RC-022, RC-061, RC-110, RC-111, RC-113, RC-122, RC-125, RC-126, RC-127, RC-131, RC-190,
  RC-207, RC-208); CA
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
  checks again. **An edit those checks would refuse is refused** (`change_over_checks`, naming each issue, RAD-112),
  and the order keeps its lines; an edit that passes saves at once. There's no pending copy of the lines: more goods
  go on a new order through an override, and a refused price or discount means closing short (with a reason) and
  raising a new order. An order is **closed** when every line is delivered, or **closed short** when a person closes it
  with lines still undelivered. The undelivered quantities are released, and a reason is kept (RC-125). A posted
  delivery return that brings a line back below what was ordered reopens an order its deliveries closed
  (`closed → confirmed`), so the goods can go again; an order a person closed short stays closed (RAD-112).
- **A quote's and an order's tax figures** (taxable value, the GST split, the total) are worked out by lib-gst as an
  invoice's are. They're computed on read while a draft, and stored, with each line's rate and the place of supply,
  when a quote is sent or an order confirmed, then never recomputed: the order's credit check uses that stored
  total. An order line's delivered and invoiced quantities are read from `delivered.ts`, never stored (RAD-125).
  Sending a quote or confirming an order is refused while the company profile has no state
  (`company_profile_incomplete`), since the place of supply needs it (RAD-112).
- **A delivery** comes from a sellable place only (`place_not_sellable`, ADR-006 §4). Selling a demo or rejected
  unit is a transfer to a sellable place first (M4-06). A delivery made against an order is owned, for record
  scope (ADR-001 §6a), by the order's owner, copied when it's made; one with no order by its maker; and a return
  by its delivery's owner. So a salesperson sees the delivery of their own order, whoever made it.
- **A credit note is approved before it posts**, through `defineApproval` (RAD-38). It stays a draft while its
  request is pending. The approval's version hash means the approver approves exactly what was sent, and the
  approval's `approved` step posts it (ADR-001 §8b). Every credit note is approved, whatever its amount (Sarthak,
  19 Nov).
- **A refund** is a payment out to the customer (lib-accounts, §6), not a document of its own.
- **A vehicle booking** (M3-13) posts nothing itself. Its advance is a receipt (§5), and the booking is §12.
- **The quick bill** (M3-11) is no document of its own: one save makes the receipts, order, delivery and invoice
  through each one's own service (§11).

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
| `sales.booking` | BK | made | 5 |

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
  documents, so a cash refund is in the books the moment the cash leaves. Since every note is approved (§1), the
  note's draft carries the refund (amount and account) as part of what's approved, and the approval's `approved`
  step posts the note and then the refund; a cash refund past the day's limit (§8) still waits for its own approval.
- **A refund of a credit note** names the credit, `(credit_table, credit_id)` on `payments`, beside `refund_of_id`
  for a receipt; a refund names exactly one. A credit's refunds and net applications stay within its total, checked
  by the database at commit (ADR-005 §7a). Refunding what's left of a credit later is a refund under
  `payments:write`; only a booking's advance is refunded through its owner (§5).
- **Keys** (RAD-114): `credit_notes:write` raises a note (by default admin, owner, accounts and counter);
  `credit_notes:approve` approves one (admin, owner and accounts; with the second factor, D-19, Sarthak, 20 Nov);
  `credit_notes:cancel` cancels one (admin, owner and accounts); `deliveries:cancel` cancels a delivery
  or a return (admin, owner and stores).

### 7. The invoice itself (RC-022, RC-113)

- **Frozen issuer details.** Posting copies the company profile into the invoice's own columns: legal name,
  GSTIN, address, state and state code. A reprint never reads the profile again (RC-022).
- **The buyer.**
  - A buyer with a GSTIN is B2B, decided by the GSTIN on the invoice when it's posted, never by the party's type
    (RC-113). A dealer without a GSTIN is unregistered, and the invoice says so.
  - An unregistered buyer's name, address and state are required when the invoice reaches Rs 50,000 (Rule 46). Taxable
    value or invoice value waits on CA-43; the default is invoice value, the stricter reading. Both are settings:
    `sales.b2c_details_limit` (50,000.00) and `sales.b2c_details_basis` (`invoice_value` or `taxable_value`).
  - A counter sale below that limit may go to the seeded party **Counter customer** (system key `walk_in`), only
    through the quick bill (§11). A Debtors line always names a party (ADR-006 §2).
- **Place of supply** decides CGST and SGST against IGST, from the company's state and the buyer's (or ship-to)
  state (CA-08).
- **Each posted line copies its GST rate (and rate source) at posting, never looking it up later.** That's the rate
  in force on the invoice's business date (M2-12).
- **Cess.** Invoice and credit-note lines carry `cess_ad_valorem` and `cess_per_unit_amount` (ADR-005 §2), held at
  0 until lib-gst has cess rates, and posting writes no cess line while it's 0. Whether any goods sold attract
  cess waits on CA-50; if one does, its rates are a lib-gst ticket of their own.
- **Round-off.** The total is rounded to the rupee, and the round-off line is under 1 (ADR-005 §2, F7). CA-33
  confirms.
- **Who issues and cancels.** `invoices:write` issues (by default admin, owner, accounts and counter), and
  `invoices:cancel` cancels (admin, owner and accounts): two keys, so cancelling can be kept from the counter.
  Neither needs the second factor (Sarthak, 20 Nov).
- **Record scope.** An invoice is owned by the owner its deliveries share. One that bills deliveries of several
  owners, or none, is owned by its maker. The owner is fixed when it posts. A salesperson whose order went on a
  mixed invoice still sees the order and its deliveries, with the number of the invoice that billed them.
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
  - **The list rate** is the price list's, never a rate typed on the line or the order's. A party's list is set
    under `prices:approve` (`party_price_lists`), else the company's `sales.default_price_list`. A document copies
    its list when it's created, and the service stores each priced line's `list_rate` from that list's rate in force
    on the document's date (`priceFor`). A priced line with no list rate, because its item isn't on the list or the
    document has no list, is `no_list_rate` and needs approval, as `cost_unknown` does: the strict default
    (18 Nov). `sales.default_price_list` starts unset, so until an admin sets it, a party with no list of its own
    needs approval for every priced line.
- **One version for everyone.** An override approves the document's figures and the issues found. Nothing in them
  depends on who reads them, so the maker, the approver and whoever confirms or posts see the same issues. An
  edit, or a limit changed while a request waits, makes the request stale, and the maker asks again.

### 10. Invoice links and payment reminders (M3-14, M3-15)

- **An invoice link** (RAD-118) is made, listed and revoked under `invoices:share`, a key of its own, scoped as
  invoices are. Its defaults are admin, owner and accounts at `all`, and sales and counter at `own`; it needs no
  second factor. Revoking reaches any link on an invoice the person may share.
  - Only a posted invoice is shared. A cancelled invoice's link answers as an expired one does.
  - The link shows the invoice as issued, buyer's name, address, state and GSTIN in full (Rule 46), from its frozen
    copy. It shows no phone, email, note or cost, and reads through `linkRecord` (ADR-001 §6a).
  - Estimate links are M6-14's, with their approval step.
- **A payment reminder** (RAD-119) carries one link, to the party's open invoice that falls due first, whether or
  not it's overdue yet (Sarthak, 21 Nov, "One, oldest invoice"), made fresh for each reminder.
  - Open bills that aren't invoices (an opening balance, a manual journal) are passed over for the first one that
    is. Only when no open bill is an invoice is there no link (`noLink: 'not_an_invoice'`).
  - A sender without `invoices:share` on that invoice still sends the reminder, with no link (`noLink:
    'no_share_key'`).
  - The token is only in the answer (ADR-001 §7a), never in `payment_reminders` or its audit rows.

### 11. The quick bill (M3-11, RC-190)

The counter sale is one save, `POST /sales/quick-bills` under `invoices:write`. It calls each stage's own service in
one transaction, never a copy of it, so any refusal on the way rolls all of it back (RAD-115).
- **Keys, up front.** The save, the hold and the complete (below) each check `sales:write`, `deliveries:write` and
  `invoices:write` before writing anything, so one refusal names every key missing. Its receipts go through
  lib-accounts' route-less `recordCounterReceipt`, not `payments:write`: receipts only, never a payment out or a
  refund, at most the bill (`overpaid`), and each applied to the bill's invoice before the save ends.
- **The order of the save.** First every lock for the whole bill, by ADR-006 §1: the period, a held bill's order
  and its hold (at complete), the party, the stock positions and units, then every series it draws, journal first.
  Then the receipts; the order, confirmed; its whole
  delivery from one place, posted; its invoice of exactly that delivery, posted; and each receipt applied to it. The
  receipts come first so that each stage's credit check sees only what's left unpaid (§9).
- **Payments.** Cash is one receipt into the `cash` account. A card payment goes to `sales.card_account`, an active
  cash or bank account; unset, it's the seeded **Card settlements** account, which a manual journal empties into the
  bank, with the machine's fee as an expense. A card records only the machine's approval code, in
  `payments.reference` (at most 40 characters, also a bank payment's UTR or cheque number). The code is required
  (`approval_code_required`), and no reference may be card digits: a Luhn-valid number of 13 to 19 digits is refused
  (`looks_like_card_number`).
- **The cash limit (§8).** Every walk-in shares the Counter customer, so its cash is judged one bill at a time,
  never summed over the day; any other party's cash sums its day, as on POST /payments. Past the limit the bill is
  refused (`cash_over_limit`), never put on credit, and the rest is taken another way.
- **Tax.** The invoice is shipped to the shop (the company's name, address and state), since the goods are handed
  over at the counter, so the place of supply is the shop's state whoever buys: CA-08's default until it's answered.
  The Counter customer's own state follows the company profile's.
- **The Counter customer** (`parties.system_key` `walk_in`) buys only through the quick bill: a quote or order for
  it is refused (`counter_customer_only`), the party pickers leave it out, and it can't be changed by hand
  (`system_party`). It never holds a balance: its bill is paid in full (`walk_in_pays_in_full`), judged on the
  order's total and again on the posted invoice's. So its credit check reads none of its history, which grows with
  every walk-in; its discount and below-cost checks run as anyone's do.
- **A walk-in who leaves a balance** (Sarthak, 22 Nov, "Allow with approval") is billed to a named customer instead,
  given with the hold (below), since the balance needs an approval. Naming one needs `sales:counter_credit`
  (all-only; by default admin, counter and sales), `parties:write`, and `parties:contact`, since it checks the phone:
  a customer with that phone already is to be chosen (`buyer_has_party`), else a new unregistered one is made in the
  shop's state with no credit limit. A bill at or above `sales.b2c_details_limit` needs the buyer's address, city
  and PIN code too (`buyer_details_required`). The unpaid part is then over the limit, and approved as any credit is
  (§9).
- **Hold, then complete** (Sarthak, 22 Nov). A bill whose checks need an override (a discount, a price below cost,
  credit) is refused by the save (`needs_override`) and held instead:
  - `POST /sales/quick-bills/hold` saves its order as a draft, keeps the place, the picks and the planned payments
    (method and amount, and a bank payment's account and reference; a card's code comes when it's charged) in
    `quick_bill_holds`, and asks for the order's
    override, judged with the planned payments taken off (`paidNow`). A bill that needs none is refused
    (`no_override_needed`).
  - Once it's approved, `POST /sales/quick-bills/:orderId/complete`, at the order's scope, takes the planned payments,
    each card with its code now, confirms the order on its approval, and posts its whole delivery and its invoice
    through that same approval. They pass only on issues of the approved kinds and no worse; anything new is
    `needs_override`.
  - The approval holds only for what was owed when it was given: its `approved` step records the credit figure on
    the hold, outside the hash, and complete refuses `version_changed` if the party owes more now (RAD-135).
  - The hold goes with the complete, so a second is `not_held`. A held order changes only through the quick bill
    (`quick_bill_held`); a rejected or abandoned one is thrown away by deleting its draft order, hold and all.
  - `GET /sales/quick-bills/held` lists them oldest first, at the order's scope as completing one is, with each
    planned payment's method and amount, never its reference.
- **The preview** (`POST /sales/quick-bills/preview`, read only) prices and taxes the lines as the save will, so its
  total is the posted one; it says what the payments leave, and names the codes of the checks the save would raise.
  It takes no lock or number, writes nothing, and answers no cost or balance, only the codes.

### 12. Vehicle bookings and test rides (M3-13, RC-122, RC-127, RC-208)

- **A booking** (`vehicle_bookings`, numbered when it's made) holds one unit for a confirmed order line of quantity
  1 (`booking_one_unit`), one live booking a line (`line_booked`), with an optional lead the maker may read.
  - The unit is ours, at a sellable place, new or used, or damaged where `stock.sell_damaged_units` allows (ADR-006
    §5); else `unit_unavailable`. One promised to another line is `unit_held`.
  - The booking promises the unit to its line (a `reserved` unit event), so stock and every picker see the hold.
  - It takes an advance above 0 (`advance_required`), a receipt held for it (§5), and more while it's booked. It
    stores no advance figures: what's taken and what's left are read live from its receipts (`heldLeft`).
- **The lock order** (ADR-006 §1): the period, the order, the booking, its lead, the party, the unit, numbering.
- **States:** booked → delivered or cancelled. The line's delivery locks its live bookings in the documents step,
  before the units, marks a finished line's booking delivered, and ends the promise under the same unit lock. A
  cancelled delivery puts the booking back to booked, with the unit that came back promised to the line again.
- **While a booking is live** its order can't be cancelled or closed short (`booking_live`): the booking is
  cancelled first, so its advance is explained. Its lines can't be rewritten while any booking names one, cancelled
  or not; extras or another vehicle go on a new order. The refusal names the line, not the booking, since whoever
  changes the order may hold no bookings key (`booking-holds.ts`, ADR-001 §6a's E7 exemption).
- **Cancelling** takes a reason, releases the unit's promise, and says what's refunded (§5).
- **The lead.** A booking converts its lead. A cancellation sends it back to `interested`, with a follow-up on the
  cancellation's date, only when it has no other live booking; the lead is locked right after the booking and
  judged under that lock.
- **Test rides** (`test_rides`) take one of our demo units (else `not_demo`) out for a lead the person may open.
  They're records, not locks, so a unit's several rides in a day all stand. Each records its outcome once (`liked`,
  `not_interested`, `wants_another`, `no_show` or `cancelled`), and before its time only `cancelled`.
- **The delivery checklist** (RC-208), kept on a delivered booking: inspected, briefed, warranty registered, a photo
  and a delivery note, each file a ready upload of its own kind (`wrong_file_kind`). The invoice never waits for it,
  since section 31 ties the invoice to the goods' removal; the bookings list filters the incomplete ones instead.
- **Keys**, without the second factor: `bookings:read` (bookings, rides and the checklist's files) and
  `bookings:write` (booking, its advances, cancelling, rides and the checklist). By default sales and counter hold
  them at `own`, and admin, owner and accounts at `all`. The refund keys are §5's.

## Consequences

- M3-07 to M3-13 build to §1 to §12, and each document adds its own rows to `state_transitions` in its migration.
- ADR-006 gains three rows in §6 (advance, refund, late credit note), the `late_cn_gst` account in §2, and figures
  F23 to F26 in §8. M3-10's owner migration seeds `late_cn_gst`, and M3-11's seeds the Counter customer party and
  the Card settlements account.
- New settings: `sales.invoice_lag_days` (0), `sales.credit_note_tax_deadline` (30 November), the two cash limits,
  `sales.b2c_details_limit` (50,000.00) and `sales.b2c_details_basis` (`invoice_value`). Each is the strict default
  until its CA answer. Also `accounts.default_credit_days` (0), lib-accounts' as the owner of parties' terms, which
  M3-15's To collect reads too; `sales.default_price_list` (unset), the list for a party with none of its own; and
  `sales.card_account` (unset, meaning Card settlements).
- New keys, each with the second factor (D-19): `sales:override` (M3-08), `bookings:refund_full` and
  `bookings:refund_part` (M3-13), and `bookings:forfeit` with CA-47's posting. Without it (Sarthak, 20 Nov):
  `invoices:write` and `invoices:cancel` (M3-09); also `bookings:read` and `bookings:write` (M3-13), and
  `sales:counter_credit` (M3-11, all-only).
- New error codes for the services: `date_in_future`, `date_before_source`, `invoice_too_late` and `exceeds_invoice`.
  The database's own guards stay RA003 and RA004.
- CA-47 (GST on a forfeited advance) and CA-50 (cess on goods sold) are added to the CA questions.

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
- **A walk-in's balance left on the Counter customer.** It needs no name at the counter, but every walk-in shares
  that party, so nobody could be asked to pay it. A balance goes on a named customer instead (§11).
