# Register: v1 defects that v2 designs out

All 222 items of the v1 register (RC-001 to RC-222), each with its wave, its level and the v2 ticket whose
acceptance criteria prove v2 doesn't have it. The ticket ids are the plan's (M0-01, M1-05, ...); in Linear each
ticket's title starts with the same id in brackets.

- Source: the coverage index of the approved plan ([plan.md](plan.md) §7) for wave, title and ticket, and the
  register in the fix plan ([source/03-Fix-Plan.md](source/03-Fix-Plan.md)) for the level. The full fix, proof and
  history of each item are in the fix plan and the technical report.
- Levels: Critical 1, Serious 59, Moderate 123, Minor 39.
- Each item is an acceptance criterion on exactly one ticket. That ticket proves v2 doesn't have the defect, with
  the register's proof rewritten as a v2 test.

| RC | Wave | Level | Defect in v1 | v2 ticket |
|---|---|---|---|---|
| RC-001 | W1 | Critical | Backups fail open: the only copy is an unencrypted dump on the same disk as the database, and nothing says so | M8-05 |
| RC-002 | W1 | Serious | Backup keys and cloud credentials sit beside the data, so ransomware or a stolen server can read or erase ever | M8-05 |
| RC-003 | W1 | Serious | The database owner password sits in the API container environment, and the app login keeps UPDATE and DELETE r | M1-06 |
| RC-004 | W1 | Serious | Posted bills, payments, expenses and payslips can be changed or deleted with plain SQL, deleting a payroll run | M2-03 |
| RC-005 | W1 | Serious | The real-PostgreSQL CI job fails before any test runs, and the real-database suite builds a new database for e | M0-08 |
| RC-006 | W1 | Serious | The repository is public, and nothing watches dependencies or scans for secrets while Next.js published 22 adv | M0-01 |
| RC-007 | W1 | Serious | Failed database queries put names, phone numbers, PAN and bank details, and link tokens into the error log, th | M1-11 |
| RC-008 | W1 | Serious | Prices and unit costs are limited to 2 decimals, so a rate such as 0.375 cannot be entered and foreign unit pr | M1-01 |
| RC-009 | W1 | Serious | Foreign-currency documents keep only the rupee figure; the foreign amount is re-derived by division, and there | M4-09 |
| RC-010 | W1 | Serious | The second legal entity is half-built and an admin can create one today; purchases, payments, stock, reports,  | M2-02 |
| RC-011 | W1 | Serious | There is no way to erase, anonymise or time-limit personal data, and the audit log and event tables keep full  | M6-16 |
| RC-012 | W1 | Serious | The filed-month GST lock guards only half the doors, nothing records what was filed, and the current month can | M5-08 |
| RC-013 | W1 | Serious | Reopening a month books the reversal into today's month, and re-approving or reopening a past month re-reads t | M6-06 |
| RC-014 | W1 | Serious | Input credit is claimed on bills from suppliers with no GSTIN, from composition dealers and from foreign suppl | M4-04 |
| RC-015 | W1 | Moderate | Choose the production host: the code is written for a long-running server and loses limits, jobs and uploads o | M0-05 |
| RC-016 | W1 | Serious | There is no point-in-time recovery: a server loss restores to last night, and invoice numbers already given to | M8-05 |
| RC-017 | W1 | Serious | The restore drill passes on an empty database, never checks uploaded files, is not scheduled, and the document | M8-06 |
| RC-018 | W1 | Serious | "Data stays in India" is true only on paper: the only running copy is pinned to Singapore and several data flo | M8-09 |
| RC-019 | W1 | Moderate | Committing the audit proof tests as they are would turn npm test and CI red | M0-08 |
| RC-020 | W1 | Moderate | PostgreSQL runs on image defaults: no data checksums, no tuning, no slow-query or lock-wait logging, and a 10- | M8-03 |
| RC-021 | W1 | Moderate | The first admin can be created locked out, and the generated password is printed into build or container logs | M1-14 |
| RC-022 | W1 | Moderate | An issued invoice does not freeze who issued it: old invoices reprint with today's company name, GSTIN, addres | M3-09 |
| RC-023 | W1 | Moderate | Duplicate-bill protection is wrong in both directions, and a bill stores neither the supplier's invoice date n | M4-03 |
| RC-024 | W1 | Moderate | 119 of 159 numeric columns and 61 of 110 tables have no CHECK, so none of the arithmetic identities is enforce | M1-05 |
| RC-025 | W1 | Moderate | The stock ledger has no business date, so back-dated documents and period-end stock reports use the posting ti | M2-05 |
| RC-026 | W1 | Moderate | Serial numbers: nothing in the database stops a unit being on the shelf twice, and some paths skip the rules | M2-06 |
| RC-027 | W1 | Moderate | One status column answers three questions (whose is it, what condition, is it promised), so a customer's scoot | M2-06 |
| RC-028 | W1 | Moderate | Batches are a label: stock going out names no batch, a receipt line holds one batch, and different suppliers'  | M4-02 |
| RC-029 | W1 | Moderate | 124 of 214 foreign keys have no index | M1-05 |
| RC-030 | W1 | Moderate | The audit trail depends on about 185 hand-written audit() calls; updated_at is not maintained and updated_by d | M1-12 |
| RC-031 | W1 | Serious | 33 of the 230 write routes leave no audit entry, including every login, password change and almost every expor | M1-13 |
| RC-032 | W1 | Moderate | The consent record is thin and forgeable: no notice or purpose stored, a stranger can record consent for someo | M3-04 |
| RC-033 | W1 | Moderate | Someone given user-management rights can make themselves an administrator, and the Permissions screen can gran | M1-18 |
| RC-034 | W1 | Serious | A payroll user can pay themselves a cash advance, and an admin can unlink their own employee record to escape  | M6-07 |
| RC-035 | W1 | Serious | One payroll user can prepare, adjust, approve and pay a month for everyone else, and the approver approves fig | M6-07 |
| RC-036 | W1 | Serious | A change of someone's bank account is not in the audit trail and needs no second person | M6-03 |
| RC-037 | W1 | Moderate | The person who makes a change can usually also approve it: adjustments, purchase orders, price lists, service  | M1-20 |
| RC-038 | W1 | Serious | The Vyapar opening stock import stays open forever, posts stock on the day of import, lets Accounts approve it | M5-16 |
| RC-039 | W1 | Moderate | One accountant can move the period lock back over open months, and a closed year can be reopened with a lock t | M5-09 |
| RC-040 | W1 | Moderate | Personal data masking and the "who looked" log cover the detail page but not lists, the phone lookup, exports  | M1-22 |
| RC-041 | W1 | Serious | Any salesperson can pull the whole lead and phone list in pages of 5,000 and edit any lead | M3-05 |
| RC-042 | W1 | Serious | Routes an AI tool would call already return data beyond the caller's role, and rows are not scoped to the pers | M1-17 |
| RC-043 | W1 | Moderate | Salary and full bank account numbers are listed for every employee at once, are plain text everywhere, and nob | M6-03 |
| RC-044 | W1 | Minor | 52 enums, 24 ADD VALUE migrations, and two roles called store and stores | M1-05 |
| RC-045 | W1 | Minor | Uniqueness, format and lookup gaps: duplicate emails and SKUs by case, GSTIN and PAN formats, and state codes  | M1-03 |
| RC-046 | W1 | Minor | Plan for the big append-only tables: partition the three logs by month now, while they are empty | M1-12 |
| RC-047 | W1 | Minor | Public link tokens are stored in plain text and copied into other tables | M1-23 |
| RC-048 | W1 | Moderate | Invoice and estimate links never expire, cannot be switched off, can be created by anyone who can read invoice | M3-14 |
| RC-049 | W1 | Moderate | Payslip links show salary, deductions and IFSC to anyone with the link, cannot be revoked, and the WhatsApp te | M6-10 |
| RC-050 | W2 | Serious | There is no disaster-recovery objective, runbook, on-call arrangement or rehearsal, and the whole business sit | M8-08 |
| RC-051 | W2 | Serious | Nothing stops a red or untested commit from reaching the live server: main is unprotected and the server build | M8-04 |
| RC-052 | W2 | Serious | The migration runner is not safe on a live database, and the "way back" that update.sh prints does not work | M1-07 |
| RC-053 | W2 | Serious | Item locks block unrelated inserts, two lock-order inversions can deadlock concurrent saves, and the latest lo | M2-05 |
| RC-054 | W2 | Serious | The public enquiry form's captcha and strict rate limit are bypassed through the website-form webhook, and the | M3-03 |
| RC-055 | W2 | Serious | No second factor on the accounts that move money, run payroll or change who can do what | M1-15 |
| RC-056 | W2 | Serious | A supplier bill is never held against the purchase order or goods received, tax is recomputed at the PO rate,  | M4-03 |
| RC-057 | W2 | Serious | There is no reverse charge anywhere | M5-03 |
| RC-058 | W2 | Serious | Expenses claim input credit with no blocked-credit check or state check, and an expense category can point at  | M5-02 |
| RC-059 | W2 | Serious | The GSTR-1 file has never been checked against the portal's rules, at least three things look likely to be rej | M5-05 |
| RC-060 | W2 | Serious | TDS is typed in by hand at payment time, with no thresholds, no higher no-PAN rate, and not at the time the bi | M5-10 |
| RC-061 | W2 | Serious | The dealer's credit limit and overdue bills are checked once, when the order is confirmed; delivery, invoice a | M3-07 |
| RC-062 | W2 | Serious | Negative-stock mode leaves a phantom stock value that never clears | M2-05 |
| RC-063 | W2 | Serious | The books-healthy check compares one total and reads six separate snapshots, so most stock-versus-books leaks  | M2-07 |
| RC-064 | W2 | Serious | A part already fitted can be deleted from a job card, so stock and cost have gone but nothing is ever billed,  | M6-14 |
| RC-065 | W2 | Serious | Any sales user can create confirmed orders at any price through the marketplace import; blank prices become Rs | M7-05 |
| RC-066 | W2 | Serious | A statement can be filed under the wrong bank account when two accounts share a mail rule | M5-12 |
| RC-067 | W2 | Serious | A Shopify cancellation that arrives before its order lets the cancelled order in, and a replayed signed body c | M7-02 |
| RC-068 | W2 | Serious | A WhatsApp "STOP" is not recognised: from an unknown number it creates a consenting lead, from a known lead it | M7-06 |
| RC-069 | W2 | Serious | The money tests are weaker than they look: estimated mutation score 52 percent on the 25 most critical functio | M2-08 |
| RC-070 | W2 | Moderate | The backup script re-archives the whole uploads folder every day, so a single server runs out of disk within t | M8-05 |
| RC-071 | W2 | Moderate | CI hygiene: no job timeouts, floating runner image, actions pinned by tag, no coverage or lint, and the Vercel | M0-08 |
| RC-072 | W2 | Moderate | The production image carries every development dependency, runs TypeScript through tsx at each start, and is b | M8-02 |
| RC-073 | W2 | Moderate | Base images are unpinned and never refreshed, so the server gets no operating-system, Node, PostgreSQL or Cadd | M8-02 |
| RC-074 | W2 | Moderate | Caddy records no access log, adds no security headers, limits no request size or time, and config changes may  | M8-03 |
| RC-075 | W2 | Moderate | No memory or CPU limits, no log rotation, no read-only filesystem or dropped capabilities: one runaway contain | M8-03 |
| RC-076 | W2 | Moderate | There is no host baseline and no infrastructure as code: hardening, patching, SSH, firewall, time and disk are | M8-01 |
| RC-077 | W2 | Moderate | Application logging is bare console.log: no request log, request id, levels, retention rule, scrubbing, or cap | M1-11 |
| RC-078 | W2 | Moderate | A database restart, network blip or stray unhandled error can end the API process | M1-10 |
| RC-079 | W2 | Moderate | Stopping the API cuts requests short: shutdown does not wait for requests or stop the scheduler, and the stop  | M1-10 |
| RC-080 | W2 | Moderate | No lock, statement or connection timeouts: one stuck transaction or heavy report can freeze billing for everyo | M1-08 |
| RC-081 | W2 | Moderate | The server starts with whatever settings it is given: nothing validates configuration, a missing NODE_ENV puts | M1-10 |
| RC-082 | W2 | Moderate | Background jobs: the 15-minute in-process loop has no queue, retry, timeout, watchdog or overlap guard, the PR | M1-26 |
| RC-083 | W2 | Serious | Nobody outside the server watches the server: the health check says ok without touching the database, there is | M8-07 |
| RC-084 | W2 | Serious | Stuck webhook events are never retried or reported, so an expired Meta token silently loses leads, and webhook | M1-27 |
| RC-085 | W2 | Serious | Shopify edits, payments and refunds after the first message are thrown away | M7-03 |
| RC-086 | W2 | Moderate | Lists, pickers and exports silently stop at a fixed size: Show more fails, past 5,000 rows nothing can be reac | M1-44 |
| RC-087 | W2 | Moderate | Bank statement auto-matching is quadratic, runs on the web thread inside an open transaction, and a year of st | M5-13 |
| RC-088 | W2 | Moderate | Rate limits count in process memory so they reset on restart and are not shared between servers, and the publi | M1-21 |
| RC-089 | W2 | Serious | Password guessing is limited per address only, in memory, with no per-account lockout, and successful sign-ins | M1-14 |
| RC-090 | W2 | Moderate | Password rules are weak, the admin chooses and knows everyone's password, and bcrypt ignores everything after  | M1-14 |
| RC-091 | W2 | Moderate | A session never really ends, and nobody can see or end other sessions | M1-16 |
| RC-092 | W2 | Moderate | Recording that an employee has left does not switch off their sign-in | M6-11 |
| RC-093 | W2 | Moderate | Manual journals can post to the GST, TDS, GRNI and payroll accounts, which the GST return never sees | M2-03 |
| RC-094 | W2 | Moderate | HR can set a new employee's salary and link a sign-in through Hire, and can change leave policy and attendance | M6-02 |
| RC-095 | W2 | Moderate | The permission matrix is cached per process, so a revoked permission stays granted on a second server copy, an | M1-18 |
| RC-096 | W2 | Moderate | Anyone signed in can upload and open "other" and picture files with no limit, attachments are never deleted, a | M1-25 |
| RC-097 | W2 | Moderate | After sign-in, a crafted next link such as /\evil.example sends the person to another website | M1-45 |
| RC-098 | W2 | Moderate | A salary change back-dated into an approved or paid month, and attendance or leave changes for such a month, a | M6-06 |
| RC-099 | W2 | Moderate | A self clock-in can still overrule HR's absent mark, because HR edits never clear the self-marked flag | M6-04 |
| RC-100 | W2 | Moderate | A raise in the middle of a month is averaged over the month, so uneven attendance is paid at the wrong rate | M6-06 |
| RC-101 | W2 | Moderate | Weekly offs are paid even if the person was absent every working day, and public holidays have no calendar | M6-04 |
| RC-102 | W2 | Moderate | Professional tax is a flat number per person (no state slabs, no February figure, charged on any earnings) and | M6-09 |
| RC-103 | W2 | Moderate | Overtime, bonus, gratuity, minimum wages and other statutory pay items are not modelled at all, and the payrol | M6-09 |
| RC-104 | W2 | Serious | PF and ESIC are worked from a made-up "Basic = 50% of gross": no real salary structure, no UAN or ESIC number, | M6-08 |
| RC-105 | W2 | Moderate | On the attendance register, approving a leave request or any refresh silently wipes the marks typed but not ye | M6-20 |
| RC-106 | W2 | Moderate | GST on customs-agent, port and trucking charges paid in cash is added to the cost of the goods instead of clai | M4-08 |
| RC-107 | W2 | Moderate | GSTR-1 leaves out nil-rated and exempt supplies, advances, e-commerce supplies and amendments, and mis-files 0 | M5-04 |
| RC-108 | W2 | Moderate | The GSTR-3B screen has two lines, no cross-head set-off, and ignores the credit brought forward | M5-06 |
| RC-109 | W2 | Moderate | GST is never settled in the books, and nothing ties each month's return to the ledger | M5-07 |
| RC-110 | W2 | Moderate | A credit note can reduce output tax at any age, and a price discount cannot be a credit note at all | M3-10 |
| RC-111 | W2 | Moderate | Invoice, credit note and receipt dates are unbounded, goods are delivered before they are invoiced, advances c | M3-08 |
| RC-112 | W2 | Moderate | An invoice can be issued while the company's own GSTIN, address and state are blank, and the state silently de | M2-02 |
| RC-113 | W2 | Moderate | The printed invoice misses some Rule 46 particulars, a dealer saved without a GSTIN is reported as a consumer, | M3-09 |
| RC-114 | W2 | Moderate | Cash has no limit: receipts of Rs 2 lakh or more in a day and payments above Rs 10,000 go through unmarked | M3-12 |
| RC-115 | W2 | Moderate | No GST rate rows are loaded for the 22 September 2025 rate change, and a newer short-code rate loses to an old | M2-12 |
| RC-116 | W2 | Moderate | E-invoice IRN, acknowledgement and QR cannot be entered or printed | M5-15 |
| RC-117 | W2 | Moderate | The importers cannot read the files the sources produce: no Excel, comma-only CSV, UTF-8 only, and a 1 MB cap | M1-28 |
| RC-118 | W2 | Serious | A CSV statement with an unquoted "9,111.00" is imported as Rs 9, rows with unreadable dates vanish, and one cr | M1-28 |
| RC-119 | W2 | Moderate | The Vyapar import has never been tried on a real Vyapar file, and the file shape is an assumption | M8-13 |
| RC-120 | W2 | Serious | Unpaid bills are not brought in one by one from Vyapar, so old invoices cannot be returned, credited or chased | M5-17 |
| RC-121 | W2 | Serious | The Vyapar compare screen is a three-list snapshot, not a parallel-month reconciliation | M5-18 |
| RC-122 | W2 | Moderate | A hold on stock stays open after the goods leave from another place or with another serial, and the stock engi | M3-13 |
| RC-123 | W2 | Moderate | A physical count that lists an item twice applies the difference twice | M4-06 |
| RC-124 | W2 | Moderate | Rejected stock can be moved back to the sellable shelf, and a transfer cannot be undone | M4-06 |
| RC-125 | W2 | Moderate | A part-delivered order can never be closed, and delivered goods cannot be taken back unless they are first inv | M3-08 |
| RC-126 | W2 | Moderate | A cash sale returned across the counter cannot be refunded in the books, and cancelling an invoice deletes its | M3-10 |
| RC-127 | W2 | Moderate | Cancelling a vehicle booking leaves the lead booked for good and the customer's advance sitting unexplained | M3-13 |
| RC-128 | W2 | Moderate | A unit that comes back into stock keeps its sale: customer warranty stays on, and a sold serial can be receive | M3-10 |
| RC-129 | W2 | Moderate | A supplier return debits the supplier whether or not the rejected goods were ever billed, picks the latest bil | M4-05 |
| RC-130 | W2 | Moderate | Job work can bring in a serialised finished good without creating its units, so it sits in stock but can never | M4-07 |
| RC-131 | W2 | Moderate | The "below cost" check compares with the last purchase rate, which any goods receipt can overwrite, and ignore | M3-07 |
| RC-132 | W2 | Moderate | The "saved once" guard is optional, ignores what was sent, keeps whole answers (with link tokens) for a day, a | M1-09 |
| RC-133 | W2 | Serious | A failed save gets a fresh retry key, and several money and stock saves, including Receive goods and Save bill | M1-42 |
| RC-134 | W2 | Moderate | Cancellations and reversals record a made-up reason instead of the person's | M1-43 |
| RC-135 | W2 | Moderate | PDF and email statement parsing run inside the web server's own thread with no time or memory cap, and the PDF | M5-11 |
| RC-136 | W2 | Moderate | A genuine bank row can be dropped as "already present" when an in-and-out of the same amount repeats on a day | M5-11 |
| RC-137 | W2 | Moderate | Statement mail intake loses files on a database error, can be starved by junk mail, and grows without bound | M5-12 |
| RC-138 | W2 | Moderate | A Shopify order that was paid online becomes an unpaid invoice, so customers who already paid can be chased | M7-03 |
| RC-139 | W2 | Moderate | A returning Shopify customer's new delivery address is not recorded anywhere on the order | M7-02 |
| RC-140 | W2 | Moderate | Shopify test orders, mismatched totals and wrong tax rates are all taken in as confirmed orders | M7-02 |
| RC-141 | W2 | Moderate | Items are matched by SKU text only; the channel item map is built but never read | M7-02 |
| RC-142 | W2 | Moderate | A reply or repeat enquiry from a lead that already exists makes no sound: no alert, and often no follow-up | M3-02 |
| RC-143 | W2 | Moderate | The integration tests use hand-made payloads, enshrine today's gaps and never run the production path | M7-01 |
| RC-144 | W2 | Serious | A look-alike or forged sender still gets a bank statement mail imported and matched against real receipts | M5-12 |
| RC-145 | W2 | Serious | Bank lines are matched to the books on amount and date alone, including lines that arrived by email | M5-13 |
| RC-146 | W2 | Moderate | No browser security headers on any screen or public page, the token pages can be indexed and cached, and new t | M1-46 |
| RC-147 | W2 | Moderate | The "Signed out" dialog can be dismissed into an invisible dialog that freezes the whole page | M1-45 |
| RC-148 | W2 | Moderate | Drop-downs that act the moment their value changes: arrow keys add items to a bill or reconcile a bank line | M1-44 |
| RC-149 | W2 | Moderate | The app has no offline behaviour at all: a dropped connection shows "Failed to fetch" and unsaved work lives o | M1-42 |
| RC-150 | W2 | Moderate | The web app has no automated test, no linter and no CI step of its own, and no end-to-end test covers the five | M0-09 |
| RC-151 | W2 | Moderate | Some roles can open a screen they cannot complete (Operations job work, marketing walk-in), and some forms are | M1-40 |
| RC-152 | W2 | Moderate | Printing depends entirely on the browser's print dialog: no paper size for the thermal roll, browser headers o | M3-16 |
| RC-153 | W2 | Moderate | The permission sweep checks the code against itself: deleting a permission check from a route makes the sweep  | M1-19 |
| RC-154 | W2 | Moderate | The default test engine differs from production: PostgreSQL 17 in memory with one connection, fresh installs o | M0-08 |
| RC-155 | W2 | Moderate | Production code paths run differently under test: rate limiters are off, webhooks are awaited, passwords hash  | M1-31 |
| RC-156 | W2 | Moderate | Some tests depend on the date they run, use if around assertions, or sleep | M1-31 |
| RC-157 | W2 | Moderate | No test makes the server fail halfway through a save, so "all or nothing" is tested only for clean refusals | M2-09 |
| RC-158 | W2 | Minor | Error tracking is home-made, blind to the browser, and its alert de-duplication is keyed on the full URL and r | M1-11 |
| RC-159 | W2 | Moderate | No error screen, loading screen or not-found page anywhere, and a render error shows Next's blank error page a | M1-40 |
| RC-160 | W2 | Minor | Searching by part of a name cannot use an index, and the database has no trigram support | M1-29 |
| RC-161 | W2 | Minor | The settings table holds configuration, hot job state and the period lock in one key space | M1-30 |
| RC-162 | W2 | Minor | Nothing ties a quantity to the item's unit of measure, so a Nos item can be ordered in fractions | M2-10 |
| RC-163 | W2 | Minor | Closing a year or moving the lock does not wait for postings in flight, and postJournal checks the lock after  | M5-09 |
| RC-164 | W2 | Minor | Cost prices reach Operations through job work, and the masters workbook skips the cost filter | M2-14 |
| RC-165 | W2 | Minor | The cross-site check lets a request with no Origin header through | M1-21 |
| RC-166 | W2 | Minor | The bank list includes people with no account number or IFSC | M6-10 |
| RC-167 | W2 | Minor | The regular tests do not pin the statutory payroll numbers, and the proofs of the open payroll holes live in a | M6-12 |
| RC-168 | W2 | Minor | The shared date check accepts days that do not exist (31 February), so a bad date reaches the database and ret | M1-02 |
| RC-169 | W3 | Serious | Salary TDS (Section 192) is not calculated: it is a flat monthly number someone types, with no PAN, regime, de | M9-02 |
| RC-170 | W3 | Serious | No e-invoice or e-way bill integration: a live IRN does not stop a cancel | M9-03 |
| RC-171 | W3 | Serious | Permission checks live only in the route files and response filters, so any AI layer that calls service functi | M1-17 |
| RC-172 | W3 | Serious | A purchase bill has no draft state and posts to the books the moment it is created, and no bill file is linked | M4-03 |
| RC-173 | W3 | Serious | Free text from outsiders (WhatsApp, lead forms, complaints) is stored in the same fields as staff notes, so an | M3-02 |
| RC-174 | W3 | Moderate | CI never exercises the deploy path: backup, restore, Caddy and the update script are not run | M8-04 |
| RC-175 | W3 | Moderate | Seven files of 700 to 1,400 lines mix routes, SQL and business rules, so the background worker cannot reuse a  | M0-02 |
| RC-176 | W3 | Moderate | Lists and reports add up a whole ledger before they keep 100 rows, so 8 of the 15 heaviest screens take 1 to 1 | M5-14 |
| RC-177 | W3 | Moderate | Opening the home screen, the owner dashboard or any task screen writes to the database | M6-13 |
| RC-178 | W3 | Moderate | Clock-in is not verified: location is advisory and sent by the phone, any time of day counts, a missing clock- | M6-04 |
| RC-179 | W3 | Moderate | The leave module is a single flat allowance: no types, no balance check when leave is asked for, no carry forw | M6-05 |
| RC-180 | W3 | Moderate | Leaving the company has no final settlement: advances are stranded, and leave, notice and gratuity are not han | M6-11 |
| RC-181 | W3 | Moderate | The TDS flow stops at the deposit: no quarterly return file, no certificates, no interest or late fee, and the | M9-01 |
| RC-182 | W3 | Moderate | Supplier warranty claims are not de-duplicated or capped, and the supplier's credit is booked without a docume | M6-15 |
| RC-183 | W3 | Moderate | Available stock is not pushed back to Shopify, so the store can sell goods RadCore has already sold | M7-04 |
| RC-184 | W3 | Moderate | WhatsApp sending: a timeout says "nothing was sent" when it may have been, there are no approved templates, an | M7-07 |
| RC-185 | W3 | Moderate | Lead alerts exist only while a tab is open, and the phone notification call is the wrong one | M9-04 |
| RC-186 | W3 | Moderate | The screens share no validation with the API and have no typed contract with it | M1-04 |
| RC-187 | W3 | Moderate | ui.tsx has outgrown itself, and money screens work around its Form | M1-43 |
| RC-188 | W3 | Moderate | The data layer re-fetches on every keystroke, shows the previous answer under a new filter, and never refreshe | M1-42 |
| RC-189 | W3 | Moderate | Accessibility (WCAG 2.2 AA): several failures touch every screen type | M1-41 |
| RC-190 | W3 | Moderate | Quick bill is not yet a Vyapar-speed counter screen | M3-22 |
| RC-191 | W2 | Moderate | Attachments live inside Postgres on Vercel, with a 4 MB cap, and are read whole into memory | M1-25 |
| RC-192 | W3 | Moderate | On Vercel the migration runs inside every branch build as the database owner while the old version keeps servi | M8-04 |
| RC-193 | W3 | Moderate | The only database login can write everywhere, and there is no read-only login or replica | M1-06 |
| RC-194 | W3 | Moderate | Authenticated routes have no per-user rate limit or spend cap | M1-21 |
| RC-195 | W3 | Moderate | No recorded legal basis or notice for AI processing | M9-06 |
| RC-196 | W3 | Moderate | Two known accounting defects (credit on unregistered suppliers, bills at the wrong price) would be made easier | M9-07 |
| RC-197 | W3 | Moderate | 57 of 402 routes are not exercised by any behaviour test; 32 are never named at all, including price-list appr | M8-10 |
| RC-198 | W3 | Minor | The development compose file publishes PostgreSQL on every network interface with a known password | M0-07 |
| RC-199 | W3 | Minor | The camelCase-to-snake_case layer burns CPU on every row: 3.8 seconds of one core for a 50,000-row answer | M1-08 |
| RC-200 | W3 | Minor | Settings, the default company and account ids are looked up again for every document; a numbered document cost | M2-04 |
| RC-201 | W3 | Minor | Node closes idle connections after 65 seconds but Caddy keeps them for 2 minutes, so an occasional request can | M8-03 |
| RC-202 | W3 | Minor | Date filters on timestamps convert every row, so they cannot use an index | M1-29 |
| RC-203 | W3 | Minor | Small input-handling gaps: search wildcards are not escaped, the 5,000-row page applies to every role, and pho | M1-29 |
| RC-204 | W3 | Minor | Follow-up times use the device's time zone on the older screens, and "today" comes from the device clock | M1-02 |
| RC-205 | W3 | Minor | The moving average includes rejected, job-work and demo stock | M2-05 |
| RC-206 | W3 | Minor | Journal entry numbers are a database sequence, so they have gaps | M2-03 |
| RC-207 | W3 | Minor | Taking back a cancelled credit note is recorded as another "sales return in", and a re-delivered line is coste | M3-10 |
| RC-208 | W3 | Minor | The vehicle delivery checklist accepts any file as the photo or signed note, ignores the order's state, and a  | M3-13 |
| RC-209 | W3 | Minor | Resource allocation can be over-booked by two people at the same moment, and project owners can reassign owner | M6-13 |
| RC-210 | W3 | Minor | Unmatching a bank line leaves a booked bank fee behind, and one book entry can never be split over two bank li | M5-13 |
| RC-211 | W3 | Minor | Smaller CRM points: the manual WhatsApp send has no per-user limit or opt-out check, templates change without  | M3-06 |
| RC-212 | W3 | Minor | The lead-sources "ignore" button can set aside a Shopify or marketplace order | M3-06 |
| RC-213 | W3 | Minor | Integration tokens and the secret box: no expiry watch, the Meta token travels in the URL, one Shopify secret, | M1-24 |
| RC-214 | W3 | Minor | The first-load JavaScript is fine; the render waterfall is the real cost | M1-40 |
| RC-215 | W3 | Minor | Money decisions in the browser use JavaScript floating point, though the shared Decimal helpers exist | M1-01 |
| RC-216 | W3 | Minor | Two small design smells that will bite later: matching on an error message, and a module-level retry key | M1-08 |
| RC-217 | W3 | Minor | Hindi and other-language readiness: numbers and dates are right, text is hard-coded English | M1-40 |
| RC-218 | W3 | Minor | A saved "board or list" choice is applied after the first draw, so the wrong view is fetched first | M1-44 |
| RC-219 | W3 | Minor | The iPhone home-screen app may draw under the notch: the viewport does not ask for the full screen | M1-40 |
| RC-220 | W3 | Minor | Dependencies are declared but unused, one drags in ten old packages, and nothing checks the manifests or the N | M0-04 |
| RC-221 | W3 | Minor | Small follow-ups recorded beside verified controls: a lint rule against raw SQL and dangerouslySetInnerHTML, a | M0-03 |
| RC-222 | W3 | Minor | Story tests depend on order and share a mutable record of ids, so a single test cannot be run on its own | M1-31 |
