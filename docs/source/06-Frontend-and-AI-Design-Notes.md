RADCORE TECHNICAL REVIEW
RadCore: Front-end and AI design notes
Radboards Pvt Ltd
29 October 2026
Reviewed commit  194e288
Contents
Prepared for Radboards Pvt Ltd. Reviewed commit 194e2881dc1063ffc99b41b3c6d2e71a4ef392e2. Built on 29 October 2026 from the front-end report (area 08, prefix WEB), the AI report (area 09, prefix AIX) and the master register (master-register.md, ids RC-001 to RC-222).
This is the proposal's deliverable "Front-end and AI design notes. What to build, in what order, and what each needs in place first."
## How to read this
- Plain words first. Every section opens with what it means for the shop. The detail follows for the developer.
- Nothing here has been built or run. Both reports are code reads. No screen was opened in a browser, no printer or phone was tried, no AI model was called. Where a step needs a real device or a real model to settle, it says so.
- RC ids point into the master register. Each design step lists the RC items that must be done first. A step that needs work the register does not contain says "not in the register".
- Waves are the fix plan's waves: Wave 1 before any real data goes in, Wave 2 before go-live, Wave 3 after go-live (the first three months).
- Effort is developer-days for one competent developer who knows this code, as the reports state it. Where I had to estimate, the text says "my estimate".
- Caveats carried over from the reports (do not drop them):
- Library versions were read from the npm registry on 28 October 2026. Whether each library works with Next 16.4.2 and React 19.3.0 was not checked beyond what Next's own PWA guide cites (Serwist, web-push). Check at install time.
- Library versions for light-my-request, pg-boss, pino and next-intl were not checked. Pin and check licence and advisories when you adopt them.
- Model prices are Anthropic's list prices fetched on 28 October 2026. Amazon Bedrock India prices were not checked and may differ: get a quote. Rupee figures use an assumed 90 rupees to the dollar, for illustration only.
- The AWS announcement of Claude on an India inference profile (29 September 2026) was read through a summarising reader. Read the post and the model card yourself before signing.
- The dates of the DPDP provisions are unverified. The Rules were reported as notified on 13 November 2025. A September 2026 law-firm commentary says the cross-border transfer provisions begin on 13 May 2027 and that no restricted-country list had been notified. That is commentary, not the Gazette text. Nothing here is legal advice.
- Statements about GST invoice rules (the 50,000-rupee buyer-details rule, e-invoicing threshold, provisional bills) come from the reviewer's general knowledge of the CGST Rules. The chartered accountant (CA) must confirm them before they drive a build.
# Part A: Front end
## A1. What the screens are good at today, and what blocks the three goals
In plain words. The screens look tidy and behave consistently, and the server underneath is careful about duplicate saves. That is a good base for a Vyapar-style counter and a Privyr-style lead inbox. But three things are missing underneath: the app keeps nothing on the device, it has no tests, and it has no way to reach a phone that is not looking at it. Offline billing and push alerts both need exactly those three things, so they cannot be bolted on yet.
Readiness (area 08): 2 out of 5. Sub-ratings: redesign 3/5, offline 1/5, push 1/5, accessibility 2/5, test coverage 0/5.
### What is done well (keep it, build on it)
| Strength | Why it matters for the redesign |
| Colours, spacing and dark mode are held in one token set (globals.css, 994 lines); tables turn into cards on phones; dialogs are the browser's own | The redesign can reuse the look and change the behaviour |
| Saves made through Form, ActionButton and useSaving ignore a second click and reuse one retry key | The base for the offline outbox |
| Edit forms never overwrite what the person typed | Needed for any draft or held bill |
| A "signed out in the middle of work" dialog exists (with one bug, RC-147) | The right idea for long counter sessions |
| Dates are plain text and cannot shift by time zone; money is a string; rupee grouping is lakh and crore | Indian formatting is already right |
| Printed documents are paper-white in either theme; the thermal invoice prints HSN, rate, taxable value and tax by rate | Print work starts from a good place |
| Permissions in the screens come from the same table the server enforces | The UI cannot offer what the server would allow and hide the rest |
| Drag-and-drop on the pipeline has a click alternative; charts have table alternatives; the bundle is small (about 128 KB gzip shared) | No accessibility or speed rewrite needed for those |
| No cross-site scripting found; only two fixed inline scripts; the public payslip page masks the account number and expires (the proposal's "never expire" line is not reproduced at this commit) | Safe to build on |

### What blocks the Vyapar and Privyr style redesign
| Block, in plain words | Finding | RC |
| Choosing an item means scrolling a dropdown of up to 2,000 entries. No type-ahead, no keyboard flow, no one-tap print, no customer balance shown at the till. The thermal-layout choice resets to A4 every time | WEB-06 | RC-190 |
| Pickers and "my leads" silently stop at 2,000 or 50 rows. A customer number 2,001 cannot be chosen for a payment; a salesperson with 140 overdue follow-ups sees 100 and is not told | WEB-05 | RC-086 |
| "Show more" fails on six lists (journal, stock, units, product list, task board) and three downloads always fail; every other Excel/CSV stops at 5,000 rows without saying so | WEB-03, WEB-04 | RC-086 |
| Printing relies on the browser dialog: no paper size for the thermal roll, browser headers on the page, no PDF to send | WEB-25 | RC-152 |
| Arrow keys on some dropdowns add an item to a bill or reconcile a bank line the moment the value changes | WEB-10 | RC-148 |
| The shared building blocks (ui.tsx, 745 lines) cannot do dependent fields, field errors, sorting, paging or masked input, so about 25 forms are hand-built and lack the duplicate-save protection | WEB-15, WEB-11 | RC-187, RC-133 |
| Forms share no checks with the server (no GSTIN, phone or amount rule in the browser) and every server answer is untyped (447 uses of any) | WEB-14 | RC-186 |
| The data layer asks the server on every keystroke, shows the previous answer under a new filter and never refreshes the bell, the session or the permissions | WEB-16 | RC-188 |
| The web app has no automated test, no linter and no CI step | WEB-19 | RC-150 |
| Contrast, unlabelled boxes and silent "Saved" messages on every screen type | WEB-20 | RC-189 |
| Text is hard-coded English; the font stack has no Devanagari | WEB-29 | RC-217 |

### What blocks offline counter use
| Block, in plain words | Finding | RC |
| Nothing is kept on the device. The service worker file (public/sw.js, 5 lines) does nothing; every page loads its data live | WEB-12 | RC-149 |
| When Wi-Fi drops the screen says "Failed to fetch" and the whole app is replaced by a red message. Half-typed bills live only on the screen | WEB-12 | RC-149 |
| A retry after a lost reply can save twice, because the retry key is renewed on failure | WEB-01 | RC-133 |
| Several money saves (booking an advance, payroll approve, opening balances, typed WhatsApp messages) carry no retry key at all | WEB-11 | RC-133 |
| The server keeps retry keys for one day and does not tie a key to what was sent. An outage can outlast a day, and a reused key with a different body replays the old answer | (server side) | RC-132 |
| A bad answer shape blanks the whole app and loses typed work (no error screens) | WEB-17 | RC-159 |
| No shared checks, so a bill cannot be validated before it is queued | WEB-14 | RC-186 |
| Invoice numbers are issued by the server, gap-free. A device cannot issue a legal number offline without a design decision | (design) | needs owner and CA decision (A4) |

### What blocks push alerts
| Block, in plain words | Finding | RC |
| Lead alerts are a 30-second check that runs only while a tab is open. A locked phone or a background tab freezes it | WEB-13 | RC-185 |
| The first check after opening returns nothing, so a lead that arrived while nobody had RadCore open is never announced | WEB-13 | RC-185 |
| The phone notification call used (new Notification) is refused by Android Chrome and by iPhone outside an installed web app; the error is swallowed, so it fails silently | WEB-13 | RC-185 |
| The bell count loads once and never refreshes | WEB-16 | RC-188 |
| No push subscription, no VAPID key, no server sender, no one-minute scheduler. The in-process job loop ticks every 15 minutes and Vercel runs one daily cron | WEB-13 | RC-082 |
| Stuck webhook events (an expired Meta token) are never retried or reported, so a lead can be lost before any alert exists | INT-01 | RC-084 |
| A repeat enquiry or reply from an existing lead makes no sound and often no follow-up | (area 07) | RC-142 |
| A crafted login link can send a signed-in user to another site; push deep links must be safe first | WEB-09 | RC-097 |

### Status of the proposal's "Screens" row at this commit
| Proposal said | At this commit |
| Lists silently stop at 100 rows | Changed: tables say "Showing the first N", but "Show more" fails on six lists and pickers have no notice (RC-086) |
| An expired session loses unsaved work | Changed: an in-place sign-in dialog exists, but Esc turns it into an invisible dialog that freezes the page (RC-147) |
| The thermal invoice leaves out details a dealer needs | Changed: HSN, rate, taxable value, tax by rate and signature are printed. Still missing: reverse-charge line, buyer details above 50,000 rupees, ship-to on thermal, IRN and QR (RC-113, RC-116) |
| A double click can save a payment twice | Changed: payments and quick bill are keyed, but useSaving renews its key on failure and several money saves are unkeyed (RC-133) |
| Payslip links show the full bank number and never expire | Not reproduced at this commit (the server masks and expires) |

## A2. The redesign plan, in build order
In plain words. Do it in this order: first mend the small things that can cost money today, then put tests under the screens, then replace the plumbing (data layer, forms, building blocks) without changing how any screen looks, then build the new counter on the better plumbing, and only then add offline billing and push alerts. Each step ships on its own and leaves the app working. Doing offline before the plumbing would multiply the cost of every duplicate save and stale number.
Principles (area 08, D0).
- Keep Next.js and the Express API. Nothing here needs a rewrite.
- Make the safe path the only path first. Offline and push multiply the cost of a duplicate save or a stale cache.
- Keep the public props of ui.tsx (Page, Form, Table, Modal, ActionButton). Re-implement what is underneath so 96 screens improve without being rewritten.
- Counter screens are a separate, faster mode, not the ERP screens made smaller: keyboard and scanner first, large targets, one purpose per screen.
- The server stays the authority for numbers, stock, money and permissions. The device keeps a copy and a queue, never the truth.
### Overview table
Effort shown is the front-end report's figure (D6), with the register's figure beside it where they differ.
| Step | What | Needs first | Report effort | Register items (wave, days) |
| A-0 | Mend live defects: retry key, signed-out dialog, Show more, exports, login redirect, quick-bill quick wins, error screens | RC-132 (for the key), RC-158 (for error reporting) | 3 days | RC-133 (W2, 3), RC-147 (W2, 0.25), RC-086 (W2, 5), RC-097 (W2, 0.25), RC-159 (W2, 0.75), RC-190 quick wins (1 of its 7) |
| A-1 | Test harness: Vitest, Testing Library, Playwright on the in-memory API, ESLint | RC-005 (working CI) | 3 days | RC-150 (W2, 7; includes the five money-flow journeys) |
| A-2 | Shared data layer (TanStack Query under the existing hooks) | A-1 | 5 days (4 to 6) | RC-188 (W3, 5), RC-214 (W3, 1) |
| A-3 | Shared schemas and form library, counter forms first | A-2 | 8 to 12 days | RC-186 (W3, 10) |
| A-4 | Building blocks: dialog, tabs, popover, combobox, table, token and accessibility fixes | A-2, A-3 | 10 to 15 days | RC-187 (W3, 12), RC-189 (W3, 3), RC-148 (W2, 0.5), RC-086 (W2) |
| A-5 | Server prerequisites: item and party search, catalogue delta, client_ref, long body-bound keys, notification tables, one-minute dispatcher | A-1 (API tests); RC-082, RC-132 | 6 to 8 days | Not in the register as a whole; pieces sit in RC-086, RC-132, RC-082 |
| A-6 | Counter v2: bill screen, hold and recall, one-tap print, party ledger card, day close, PDF | A-4, A-5 | 10 to 14 days | RC-190 (W3, 7), RC-152 (W2, 1; PDF 3 to 4 days not counted), RC-113 (W2, 2), RC-116 (W2, 1.5) |
| A-7 | Service worker and read-only offline catalogue ("price check offline") | A-5, A-6 | 5 days | Part of RC-185 (W3); RC-149 (W2, 1 for the cheap protections) |
| A-8 | Offline sale outbox: provisional bills, sync, conflict tray | A-7; owner and CA decision | 12 to 15 days | Not in the register (RC-149 says "not costed here") |
| A-9 | Push alerts (inbox, service-worker push, preferences, quiet hours) | A-5, A-7, RC-097, RC-082, RC-084 | 7 to 10 days | RC-185 (W3, 6.5) |
| A-10 | Lead inbox and WhatsApp template picker | A-4; A-9 for instant arrival; RC-041, RC-184, RC-068 | 6 to 8 days | Not in the register as a build; prerequisites are RC items |
| A-11 | Hindi and bilingual counter screens and invoice | A-6 | 4 to 6 days | RC-217 (W3, 5) |
| A-12 | Security headers and CSP, e-invoice card, invoice particulars | none; before go-live | 3 days | RC-146 (W2, 1.5), RC-116 (W2, 1.5), RC-113 (W2, 2) |

Totals. About 80 to 110 developer-days for A-0 to A-12 (the sum of the report's ranges is 82 to 107). With two developers (one on A-2 to A-4 and A-6, one on A-5 and A-7 to A-9), about 10 to 14 calendar weeks. The register's front-end theme is 68.1 days, but it does not contain A-5, A-8, A-10 or the PDF, so do not read 548.75 days as covering this redesign. Only A-0, A-1 and A-12 are before go-live in the report; from A-6 onward is the first three months.
### Step details
#### A-0: Mend the live defects
- What to build. (1) Renew the retry key only after success (WEB-01). (2) Make the signed-out dialog undismissable, with dismissible={false} (WEB-02). (3) Make withLimit replace instead of append the limit value, and make CsvLink strip any existing limit (WEB-03, WEB-04). (4) Check the login next link by resolving it against the site's own origin (WEB-09). (5) Quick-bill quick wins: read ?new=1 on the invoice page, remember the thermal choice per device, call print once the invoice loads, focus the scan box, ignore out-of-date price previews (WEB-06). (6) Add error.tsx, global-error.tsx, not-found.tsx and loading.tsx, and send client errors to the API's alert channel (WEB-17). (7) Route the unkeyed money saves through the protected wrappers and add a lint rule against a bare post() in a component (WEB-11, WEB-34, WEB-35).
- Needs first. RC-132 (the server's "saved once" guard must tie a key to what was sent) before RC-133; RC-158 and RC-007 for client error reporting before RC-159.
- Acceptance. Playwright retry after a lost reply reuses the key (both requests carry the same Idempotency-Key; one credit note exists). Playwright signed out dialog cannot be dismissed. Vitest on withLimit and on the redirect check (/\evil.com, /<TAB>/evil.com, //evil.com, https://evil.com all return /). A 6,000-invoice export is complete or fails loudly. A mocked bad answer shows the error screen and the sidebar still works.
- Effort. 3 days (report). Register: RC-133 3, RC-147 0.25, RC-097 0.25, RC-086 5, RC-159 0.75. The register is larger because RC-133 also covers the other nine unkeyed sites and RC-086 includes real paging and the combobox.
- Do not. Do not wrap only the sites the report names and call the class of bug closed: add the lint rule so the next screen cannot skip the wrapper. Do not rely on the double-click flag alone; the case that matters is a lost reply followed by a second press.
#### A-1: Test harness
- What to build. Vitest and Testing Library for lib/api.ts (keys, withLimit, the 401 event), ui.tsx (Form, ActionButton, Modal, CsvLink) and the redirect check: about 25 tests. Playwright journeys against the API in its in-memory PGlite mode (no Docker): login, quick bill by keyboard, lost reply, signed-out recovery, show-more, export, credit note, payment. ESLint with the Next config and hooks rules, run in CI, and a type check on the Vercel path.
- Needs first. RC-005 (the real-database CI job fails before any test runs today).
- Acceptance. npm test -w @radcore/web exists, runs in CI and fails on a reverted WEB-01 or WEB-03 fix.
- Effort. 3 days to set up and write the first 25 unit tests and 6 journeys, then about 0.5 day per new screen (report). Register RC-150 is 7 days because it adds the five money-flow journeys and a sweep of every screen.
- Do not. Do not skip this to "save time". Every later step changes shared plumbing that protects money, and nothing else would notice a regression.
#### A-2: Shared data layer
- What to build. TanStack Query behind the existing useGet hook, with the same signature (path) => { data, error, loading, reload } so no screen changes. Cancel old requests, wait 250 ms before searching, keep the previous answer visibly dimmed under a new filter, bound the cache size, refetch when the window regains focus, refresh the bell and /auth/me every minute, and make one reload refresh every user of that path. Writes go through useMutation, with the retry key held in the mutation and reset only on success. Read the session on the server in the app layout, which removes the "Loading..." screen and one round trip (WEB-18).
- Needs first. A-1.
- Acceptance. Typing five characters sends at most two requests. reload on one hook refreshes a second hook on the same path. Revoking a permission in the admin screen hides the button on another open tab within a minute. The signed-in home page reaches its first data render with at most two sequential requests after the HTML.
- Effort. 5 days (4 to 6); 1 more day for the server-side session read.
- Do not. Do not choose SWR (smaller, but no mutation or paging story). Do not change screen code in this step; the point is to improve 96 screens through one hook.
#### A-3: Shared schemas and the form library
- What to build. Move the request schemas for the ten busiest routes (quick bill, payment, expense, party, lead, walk-in, journal, stock, quote, invoice cancel) into packages/shared/src/schemas/. The API imports them (zod 4.6.7 is already there) and the forms validate with the same object through React Hook Form. Export request types from the schemas and hand-write response types for the same ten routes, with a contract test per route. Counter forms first.
- Needs first. A-2; RC-150 for the tests.
- Acceptance. One unit test where the quick-bill schema rejects a 14-character GSTIN, run in both the API suite and the web form test, from the same import.
- Effort. 8 to 12 days for the ten routes and the form wrapper (RC-186, 10).
- Do not. Do not convert all 96 screens at once; go screen by screen. Do not start with ts-rest or generated OpenAPI; shared schemas need no new tool.
#### A-4: Building blocks, tokens and accessibility
- What to build. Put headless libraries under the existing ui.tsx props: Radix primitives for dialog, popover, select, tabs and menu; React Hook Form for Form; TanStack Table for Table; a server-searched cmdk combobox for item and party pickers. Split ui.tsx into format.ts, layout.tsx, table.tsx, form.tsx, dialog.tsx. Apply the token and accessibility fixes in A6. One shared reason dialog for every cancel and reverse button (WEB-21, RC-134). Item and party pickers read from server search endpoints with prefix and barcode search.
- Needs first. A-2 and A-3.
- Acceptance. @axe-core/playwright shows zero serious violations on the ten busiest screens. A contrast unit test over the token pairs passes. With 2,100 parties seeded, a Playwright test finds party 2,050 by typing its name on Payments and records a payment. ArrowDown on the bank "Match to..." list sends no request; the Match button sends one.
- Effort. 10 to 15 days staged over the redesign (RC-187, 12), plus 3 days for the token, Form, Notice, page-title and table fixes (RC-189), plus 2 days for the shared combobox in about 12 places (inside RC-086).
- Do not. Do not adopt Tailwind as part of this. Do not rewrite globals.css. Do not ship a combobox that loads a fixed slice; a limit in the screen is a business rule, so it must search on the server.
#### A-5: Server prerequisites (can run in parallel with A-2 to A-4)
- What to build. (a) Item and party search endpoints with prefix and barcode search. (b) GET /api/sync/catalogue?since=<cursor> with tombstones. (c) A unique client_ref (the outbox id) on invoices and payments, so a retry is safe even after the key table is cleaned. (d) Retry keys kept 30 days for the sync endpoint and bound to a hash of the request body. (e) POST /api/sync/bills accepting a batch and returning one result per row. (f) created_offline, device_id and client_time on documents, shown in the audit trail. (g) Server time in /auth/me. (h) An "offline-sellable" flag on items. (i) Negative-stock and needs-review alerts. (j) Notification tables, endpoints and a one-minute dispatcher (section A5).
- Needs first. A-1 (API tests); RC-132 (body-bound keys); RC-082 (the job runner).
- Decision taken: retention is a setting per route class. Normal screens: keys short-lived (48 hours) and tied to what was sent. Offline outbox (the sync endpoint): keys generated by the device when the bill is queued, fixed for life, tied to what was sent, kept 30 days. RC-132 must not shorten the offline class (the register note says so). See "Decisions taken", item 4.
- Acceptance. An API test per endpoint; the same client_ref sent twice creates one invoice; a key reused with a different body is refused.
- Effort. 6 to 8 days.
- Do not. Do not let the device be the authority for any number, stock figure or permission.
#### A-6: Counter v2 (quick-bill speed and the party ledger)
In plain words. Vyapar's value at the counter is speed: scan, tender, print, next customer in well under half a minute. Today a bill costs three extra clicks and a 2,000-item dropdown. The new bill screen removes both.
- Bill screen v2 (replaces Quick bill).
- What to build. One screen with item search-as-you-type (cmdk); a barcode input that never loses focus; plus, minus and quantity keys; a running total always visible; line discount as percent or rupees; bill discount and round-off; a customer chip (phone lookup shows name and balance); a payment panel with cash tendered, change to return, a default mode and split payment; F-key shortcuts (add customer, hold, pay, save and print). Show the customer's balance when an existing party is picked (the walk-in screen already does; quick bill does not).
- Hold and recall bills: park up to N bills per till, kept on the device, each with its own key.
- One-tap print: thermal 58 mm and 80 mm and A4 presets, remembered per device; same output as the PDF. @page { size: 80mm auto; margin: 2mm } for thermal and A4 for the rest, chosen by a class on the page just before printing.
- Day close: cash counted against expected, and the day book shared to the owner on WhatsApp (one new endpoint for expected cash).
- Party card as the ledger. A header that says "they owe you" or "you owe them"; ageing buckets; last payments; "Record payment" and "Send statement" buttons; the statement as PDF or WhatsApp; reminders with the last-sent time. The statement PDF is shared with the invoice PDF.
- Needs first. A-4 (combobox, form and table), A-5 (search endpoints), RC-133 (the payment form protections), RC-148 (arrow-key hazard). The party card must respect RC-042: today GET /api/parties/:id returns balance, open invoices and PAN to every role that can read parties, including technicians. Redesigning that card on top of the leak would spread it. Also RC-151 (roles that cannot finish a screen), RC-113 (invoice particulars, reverse-charge line, 50,000-rupee buyer details) and RC-116 (IRN and QR on the printed invoice) so the invoice that prints is the right one.
- Acceptance. Playwright quick bill by keyboard only: scan, tender, print, with the print dialog stubbed, the thermal layout asserted and no mouse event used. A keyboard-only sale in under 30 seconds in a Playwright run (report's done-when). page.pdf({ preferCSSPageSize: true }) on the thermal invoice yields a page 80 mm wide, and the shared-link PDF shows the same total as the screen. A 60,000-rupee anonymous quick bill is refused by the API.
- Effort. 10 to 14 days for the bundle (report). Of that, the bill screen is 6 to 8, the paper presets 1, and the server-side PDF 3 to 4 (WEB-25, not counted in RC-152). The report gives no separate figure for hold and recall, the party card and day close; they are the remainder of the bundle and need their own estimate when designed (my note).
- Do not. Do not make the ERP screens smaller and call them the counter. Do not send a plain browser print as the only route if a PDF is wanted. Do not claim a 58 mm clip is fixed until the shop's actual printer is tried (to confirm).
#### A-7: Service worker and read-only offline catalogue
- What to build. Serwist replaces the empty public/sw.js. Pre-cache the app shell and the counter route; hashed static files cache-first; the page shell stale-while-revalidate with a "new version ready" prompt that applies between bills, never mid-sale. Serve /sw.js with no-cache headers and a strict CSP. Never cache /api/auth/*, /api/files/*, any ledger, balance, payment, payroll, report or permissions answer, or any POST, PUT or PATCH. An allow-list of reads refreshes in the background into the device database. Show "Prices as of 10:42".
- Needs first. A-5 (catalogue delta endpoint) and A-6 (the counter screen to serve). Also RC-146 (headers) so the CSP is consistent.
- Acceptance. Offline reload shows the shell and prices. A reload of a half-filled quick bill keeps its lines.
- Effort. 5 days.
- Do not. Do not apply a new service-worker version mid-sale. Do not cache anything that shows balances, ledgers or reports.
#### A-8: Offline sale outbox (section A4 has the full design)
- Needs first. A-7; the owner and CA decision on provisional bills versus reserved invoice-number blocks; RC-132; RC-016 (invoice numbers reused after a restore: the offline design must not re-introduce reuse); RC-039 (period lock) and RC-113 (the 50,000-rupee rule) so the conflict rules have a server to agree with.
- Acceptance. The test list in section A4, under "Tests".
- Effort. 12 to 15 days. This is the biggest risk item and is placed after everything it depends on.
#### A-9: Push alerts (section A5 has the full design)
- Needs first. A-5 (tables and dispatcher), A-7 (service worker), RC-097 (safe deep links), RC-082 and RC-084 (runner and webhook retry), RC-092 (a leaver's sign-in is switched off, so their subscription is deleted).
- Acceptance. With the app closed, a lead created through the public enquiry endpoint produces a notification on a test device within 10 seconds, and the sender is called once per assigned owner.
- Effort. 7 to 10 days for P1 to P3 (RC-185 is 6.5).
#### A-10: Lead inbox and WhatsApp templates (Privyr style)
In plain words. A salesperson opens one list called "To do now". New leads come first, then follow-ups due, then overdue. Each row has Call, WhatsApp, and Done, Reschedule or Lost in one tap. A new lead arrives on the phone within seconds (once push is in).
- Lead inbox. One list ordered by what to do next. Unread dot, snooze, a speed-to-reply timer, and "assigned to me" as the default filter. The 50-lead cap goes away (WEB-05). The existing pipeline board, saved views, quick replies, follow-up plans, lead score and "customer opened your file" tracking stay.
- WhatsApp templates. A placeholder picker for the existing variables ({first_name}, {name}, {products}, {my_name}, {company}) plus {price} and {link}; a default template per stage; a live preview; a send count; brochure and price-list share with the "opened" notification that already exists.
- Needs first.
- A-4 (table and combobox primitives); A-9 for instant arrival (the inbox is useful without push, best with it).
- RC-041: a salesperson can today pull the whole lead list. The inbox should show "mine" by default and the server must enforce it; this needs the owner's decision (below).
- RC-142: a reply or repeat enquiry from an existing lead must raise an alert, or the inbox misses it.
- RC-184 (area 07, INT-14): the "templates" today are local quick replies sent as free text. Meta refuses free text outside the 24-hour window (error 131047), and the app has no approved-template sending and cannot see delivery failures. A template picker that sends through the business WhatsApp number needs approved templates, a message log and delivery status. Until that is built, the picker can only fill a wa.me message that the person sends from their own phone.
- RC-068 (a customer's "STOP" is not recognised) and RC-032 (consent record) before any automatic template send.
- RC-133 (the typed WhatsApp message is unkeyed today, so a lost reply can send it twice).
- Acceptance. A salesperson clears the inbox with one thumb: each row action completes in one tap, covered by a Playwright test at phone width (the report states the goal in those words; the test wording is mine).
- Effort. 6 to 8 days (report). Template approval state and Cloud API sending are RC-184 (5 days, W3).
- Do not. Do not promise template sending from RadCore until the business WhatsApp number is connected and Meta has approved the templates. Do not show other people's leads by default.
#### A-11: Hindi and bilingual
- What to build. next-intl (or react-i18next; version not checked) for the counter screens and the invoice only; a Devanagari font (Noto Sans Devanagari) through next/font; Hindi amountInWords if bilingual invoices are wanted; keep Indian number formatting (en-IN) in both languages.
- Needs first. A-6, so strings are extracted after the counter screens settle.
- Acceptance. In Hindi mode, the quick-bill screen and the thermal invoice show no English labels (a Playwright check against a list of known strings).
- Effort. 4 to 6 days (RC-217, 5); each other screen about 0.25 day.
#### A-12: Hardening and invoice completeness (before go-live)
- What to build. Security headers and a strict CSP using hashes for the two fixed inline scripts (no per-request nonce); noindex and no-referrer on the private link pages; rel and opener fixes on the six window.open sites; an "E-invoice" card on the invoice page (IRN of 64 characters, acknowledgement number and date, status, e-way bill number and validity) that calls the existing endpoint, printing IRN, acknowledgement and QR on A4 and thermal; the reverse-charge line, ship-to on thermal, and buyer name and address for an unregistered buyer at 50,000 rupees or more.
- Needs first. None for the screens; RC-048 for the headers item; the CA to confirm whether the 50,000 trigger is taxable value or invoice value.
- Acceptance. curl -I on /, /login and /i/x lists the new headers and noindex on private links. A component test renders the 64-character IRN and a QR image, and "IRN cancelled" when cancelled.
- Effort. 3 days (report); register RC-146 1.5, RC-116 1.5, RC-113 2.
- Do not. Do not wait for a GSP (e-invoice) connection. A manual route (portal, then paste the IRN) is usable at once (the live IRP call is RC-170, 12 days, W3).
## A3. Component and design-token recommendation
In plain words. Keep your colours and your CSS. Put well-tested, invisible building blocks underneath so dialogs, dropdowns, tabs and tables behave correctly for keyboards and screen readers. Do not switch to Tailwind now: converting 994 lines of tidy CSS buys little and costs a lot.
shadcn/ui is a good model ("copy the components into your repo and own them") but assumes Tailwind. Follow its pattern, owning the components in components/ui/, without its tooling.
### Libraries (versions read from npm on 28 October 2026)
| Layer | Use | Version and licence | Replaces or adds |
| Server data and writes | TanStack Query | 5.105.0, MIT | useGet, useSaving, hand-written busy flags, the in-memory cache (WEB-01, WEB-16) |
| Forms and validation | React Hook Form, @hookform/resolvers, zod | 7.91.0 MIT, 6.0.2 MIT, zod 4.6.7 MIT (already used by the API) | Form internals, per-screen form state, field errors, masks (WEB-14, WEB-15) |
| Tables | TanStack Table, with TanStack Virtual for long lists | 9.3.1 MIT, @tanstack/react-virtual 3.14.23 MIT. The latest line is v9 and most online examples are v8: read the v9 migration notes first | Table internals: sort, column choice, selection, server paging |
| Dialogs, popover, select, tabs, menu | Radix primitives | radix-ui 1.8.1, MIT | Modal, Tabs, menus, correct focus and ARIA (WEB-02, WEB-20) |
| Command and combobox | cmdk | 1.1.1, MIT | Item and party pickers, global search (WEB-05, WEB-10) |
| Service worker | Serwist | serwist and @serwist/next 9.5.13, MIT; the library Next's own PWA guide points to | The empty public/sw.js |
| Local database | idb (thin IndexedDB wrapper); alternative Dexie | idb 8.0.4 ISC; Dexie 4.4.7 Apache-2.0 | New |
| Push (server) | web-push | 3.6.7, MPL-2.0 | New |
| PDF | @react-pdf/renderer (or headless Chromium) | 4.9.0, MIT | New, optional |
| Tests | Playwright; Vitest with Testing Library; MSW | 1.64.1 Apache-2.0; 5.0.5 MIT with 16.3.3 MIT; 3.0.3 MIT | None today (WEB-19) |
| Translation | next-intl or react-i18next | Not checked; check when adopting | New |

### Token layers (all CSS custom properties)
- Primitive palette: blue, slate, green, amber and red scales, in one place.
- Semantic tokens that components use: --text, --text-muted, --surface, --surface-raised, --border-field, --border-subtle, --focus, --danger, --ok, --warn. This is what exists now. Add --border-field (at least 3:1) and a darker --text-muted.
- Component tokens: --btn-h, --field-h, --row-h, --tap, switched by data-density="comfortable | counter" on a screen wrapper. Counter density means 48 px controls, 16 px minimum font and wider spacing.
Add a unit test that computes the contrast ratio of every foreground and background pair in light and dark and fails below 4.5 (text) or 3 (borders and icons). Add a high-contrast theme by overriding the semantic layer only. Keep the focus ring and reduced-motion handling that already exist.
## A4. Offline counter architecture
In plain words. A till should keep selling cash, UPI by QR and card (taken on the shop's own machine) for minutes to hours without the internet, and every sale should reach the books exactly once when the connection returns. The goal is not to run the whole ERP offline. Credit sales, refunds, stock changes and reports stay online-only, because a stale answer there is worse than no answer.
### What works offline, and what must never
| Works offline (with a visible "offline" chip) | Must never work offline |
| Looking up an item: price, GST rate, barcode, showroom stock as of the last sync | Issuing a B2B tax invoice (buyer GSTIN) or any e-invoice; any invoice over the 50,000-rupee buyer-details rule |
| A cash, UPI-by-QR or card sale to a walk-in customer, printed as a provisional bill (or an invoice from a reserved block) | Credit sales and credit-limit overrides |
| Holding and recalling bills on the till | Payment allocation, receipt or invoice cancellation, credit notes, refunds |
| Capturing a walk-in lead or a payment received (later slices) | Stock transfers, adjustments, counts, goods receipt and QC |
|  | Journals, period lock, year close, bank reconciliation |
|  | Payroll, attendance corrections; user, role and permission changes; price-list changes |
|  | Viewing balances, ledgers or reports (show only with an "as of" stamp, or not at all); exports; first sign-in |

Each disabled action says why and offers "Do this when online".
### Parts
- Service worker (A-7, Serwist). It never caches anything on A-7's never-cache list (auth, files, ledgers, balances, payments, payroll, reports, permissions, and any write).
- Read cache, counter only. Items (id, SKU, name, barcode, HSN, GST rate, cess, retail price, unit, serialised flag, showroom stock with its time), price lists, tax settings, company and state, locations, payment modes, number-series info, the user's own permissions, and recent or active customers (name and phone only).
- Device database stores: catalogue, parties, meta (device id, user id, last sync, schema version), drafts (held bills) and outbox.
- Outbox row. id (uuid), kind (sale, receipt, lead, walkin), user_id, device_id, created_at (device clock), payload, idempotency_key (a uuid fixed for life), local_no (P-<till>-<yymmdd>-<n>), status (queued, sending, accepted, rejected, needs_review), attempts, last_error, server_ref.
- Sender. One loop that flushes on app open, on the browser's online event, on a 30-second timer and (Chromium only) through Serwist's Background Sync plugin. iPhone Safari has no Background Sync, so the foreground triggers are not optional. Rows for the same customer or bill chain go strictly in order. Each request carries its stored key. On success: mark accepted and store the server's invoice number. On a network error: retry with backoff. On a rejection by the server: mark rejected or needs_review and stop that chain.
- Invoice numbers (decision for the owner and CA). A legal invoice number must be consecutive and issued by the server (numbering.ts is gap-free). A device cannot issue one offline without breaking that. Two designs:
- A. Provisional bill (recommended first). Offline, the till prints a provisional bill numbered P-<till>-<date>-<n> that states "Tax invoice will follow". On sync the server creates the real invoice and the customer receives it by WhatsApp link. Simple; keeps numbers gap-free. Risk: GST expects the invoice at or before delivery of goods. The CA must confirm that a provisional slip plus a prompt tax invoice is acceptable for B2C counter sales, or require the paper fallback.
- B. Reserved blocks. The server hands each till a block (for example 50 numbers a day). Offline, the till issues real invoice numbers from its block; unused numbers at close become cancelled documents and show in the GSTR-1 documents table. Compliant, but numbers are no longer strictly issue-ordered, and the PRD's "no gaps" must be restated as "no unexplained gaps".
- Either way, B2B invoices with a buyer GSTIN, any e-invoice (IRN) and any invoice over the 50,000-rupee rule are online only. For a B2B customer during an outage, the report's recommendation is a paper invoice from a numbered book, entered later.
### Conflict policy: what the server does when an offline sale arrives
| Case | Rule |
| Price on the list changed since the snapshot | The price shown to the customer at the time wins. If it was below cost or over the discount limit, mark needs_review; the owner approves |
| Non-serialised item no longer in stock | Accept (the goods left the shop); stock goes negative; raise a "negative stock" alert. A per-item "allow offline oversell up to N" limit decides what the till may sell at all |
| Serialised item (vehicle, battery pack) | Offline sale allowed only for serials in the till's snapshot and flagged offline-sellable. If the serial was sold elsewhere meanwhile: needs_review, no invoice issued, owner alerted, goods flagged |
| Customer already exists (same phone) | Merge by phone (the server already de-duplicates by phone); never create a second party |
| Credit sale or credit-limit override | Not allowed offline (cash, UPI, card only), so there is no credit-limit race |
| Period lock or closed year | Reject with a clear code; the sale waits in the tray for the owner to decide the date |
| Same Idempotency-Key arrives twice | Return the first answer (exists). Keys must outlive the outage |
| Device clock wrong | The server stores both the device time and its own. Invoice date is the IST date of the device time only if within 2 days of server time, else the server date and a flag |

### Security of the device copy
IndexedDB is readable by anyone with the browser profile, and counters are shared PCs. Keep personal data minimal (names and phones of active customers only; no salaries, bank accounts or reports). Require a till PIN at start of shift; derive an AES-GCM key from it (PBKDF2) and encrypt the outbox and customer stores with WebCrypto. Wipe everything on sign-out and after 12 hours of inactivity; request navigator.storage.persist(); let the owner mark a device "revoked" so the next sync wipes it. The cookie session must still be valid for syncing, so offline use is bounded by the till PIN window. Warn before sign-out if the outbox is not empty (clearing site data mid-queue loses unsent bills).
### UX rules
A permanent status chip: Online, Offline, N bills waiting, Syncing, Needs attention. After Save always show a receipt with the number (provisional or real) so the cashier never wonders. A "Needs attention" tray lists rejected rows with the reason and the actions Retry, Edit and resend, Void. The owner gets a push when a row needs review (section A5, "Counter bill needs review").
### Slices, and the first working slice
- S1. Shell and read-only catalogue ("price check offline", no writes). Safe to ship first.
- S2. Offline cash sale with a provisional bill and the outbox. This is the first slice that actually sells offline.
- S3. Walk-in capture and payments received.
- S4. Conflict tray and owner review.
- S5. Background Sync, till-PIN encryption, remote revoke.
Sequence of the first working slice (S2: one offline cash sale)
| # | Who | What happens |
| 1 | Cashier, online | Signs in, enters the till PIN. The device downloads the catalogue delta and stores it with its time. Status chip: Online |
| 2 | Connection drops | The chip turns to Offline. Item search and prices keep working from the device copy, stamped "Prices as of 10:42" |
| 3 | Cashier | Builds a cash bill. Credit, B2B and any bill over 50,000 rupees are blocked with "Do this when online" |
| 4 | Screen | Checks the bill against the shared schema (GSTIN, amounts) before queueing |
| 5 | Screen | Saves a row to the outbox with a fixed key and local_no P-<till>-<yymmdd>-<n>, status queued |
| 6 | Printer | Prints the provisional bill, "Tax invoice will follow". The receipt screen shows the local number |
| 7 | Connection returns | The online event (or the 30-second timer, or app open) starts the sender |
| 8 | Sender | Posts the row to POST /api/sync/bills with the stored key and client_ref. Status sending |
| 9 | Server | Applies the conflict table. Creates the real invoice, gap-free number, with created_offline, device_id, client_time in the audit trail |
| 10 | Server | Returns one result per row: accepted with the invoice number, or needs_review / rejected with a code |
| 11 | Sender | Marks accepted, stores server_ref. The customer gets the real invoice by WhatsApp link |
| 12 | Failure case | The reply is lost after the server committed. The sender retries with the same key and client_ref; the server returns the first answer; exactly one invoice exists |
| 13 | Failure case | The server rejects (for example period lock). The row moves to the Needs attention tray; the owner is alerted; nothing is silently lost |

### Server changes required
The server changes are listed under A-5 (a to j). Only RC-132 and RC-082, and the search endpoints inside RC-086, are in the register.
### Tests
Playwright offline mode; fault injection that commits then drops the reply; duplicate delivery; two tills selling the last serial; clock skew; a 4-hour outage with 200 queued bills; clearing site data mid-queue (must warn before sign-out if the outbox is not empty). All must pass before A-8 is called done.
### Decisions needed (from the report, D7)
- Provisional bill (A) or reserved blocks (B), and what the counter does for a B2B customer during an outage.
- Whether to allow offline sales of vehicles (serial conflicts) or only accessories and non-serialised items.
- The oversell buffer per item and who reviews negative stock.
- Which staff phones and tablets are in use (iPhone versus Android decides the push promises).
- Whether the business WhatsApp number (Cloud API) will be connected.
- The till PIN policy and idle time.
## A5. Push alerts
In plain words. A web page cannot run in the background. To reach a salesperson with the phone in a pocket, the server has to send a message through the phone maker's push service to a small program (the service worker) on the phone. That is how Privyr-style "new lead, reply first" works. It needs a place on the server that remembers each phone, a clock that checks every minute, and a careful way of asking permission.
Platform limits. Android Chrome, Edge, Firefox and desktop browsers support it. iPhone and iPad support it only for web apps added to the Home Screen (iOS 16.4 and later), and only after a tap that asks permission. Confirm each target phone before promising a feature to staff.
### Categories and defaults
| Category | Who | Trigger | Timing | Default | Bypasses quiet hours |
| New lead assigned | owner of the lead | lead created or reassigned | at once, high urgency | on | yes, if the user chooses "always" for leads |
| Customer opened a shared file | lead owner | first view | at once | on | no |
| Follow-up due | lead owner | next_follow_up_at | at the time, once | on | no |
| Overdue follow-ups | lead owner, sales lead | daily | 09:30 IST digest | on | not applicable |
| Approval waiting (PO limit, stock adjustment, price below cost, year reopen) | approvers | request created | at once | on | no |
| Dealer over credit limit or invoice overdue | owner, accounts | event or daily | at once / 10:00 digest | on / off | no |
| Low stock | stores, owner | daily | 10:00 digest | on | no |
| Online order failed to import | sales, owner | webhook failure | at once | on | no |
| Counter bill needs review | owner | needs_review row | at once | on | yes |
| Leave request or interview today | HR, interviewer | event / morning | at once / 08:30 | on | no |
| Task due or overdue | assignee | schedule | at due time / digest | on | no |
| Security (sign-in from a new device, password changed) | the user | event | at once | on, cannot be turned off | yes |

### Quiet hours
Per user, default 21:00 to 08:00 IST. During quiet hours, notifications that do not bypass are held and delivered as one digest when quiet hours end. A "pause for 1 hour" control sits on the bell. Quiet hours are evaluated at send time on the server so they work when the phone is off.
### Subscription and inbox tables
- push_subscriptions(id, user_id, endpoint unique, p256dh, auth, user_agent, device_label, created_at, last_seen_at, last_success_at, failure_count, disabled_at).
- notification_prefs(user_id, category, push bool, in_app bool, quiet_start, quiet_end, tz).
- notifications(id, user_id, category, title, body, url, dedupe_key, created_at, send_after, sent_at, read_at). The inbox is the source of truth and drives the bell; push is a delivery of an inbox row.
- Endpoints: POST/DELETE /api/push/subscriptions (upsert by endpoint; delete on sign-out), GET /api/notifications and /unread-count, POST /api/notifications/:id/read, PUT /api/notification-prefs, POST /api/push/test.
- Keys: VAPID keys generated once with web-push generate-vapid-keys; the public key goes to the browser, the private key is a server secret. Rotating it invalidates every subscription.
### What the scheduler must do
The code that creates a lead (or a nightly job that finds overdue follow-ups) writes a notifications row. A dispatcher sends rows whose send_after has passed through web-push, with a TTL (for example 120 seconds for "new lead", 12 hours for digests) and urgency: high for leads. On HTTP 404 or 410 from the push service, disable the subscription. Coalesce with tag.
The dispatcher needs a one-minute tick for time-critical alerts (new lead, bill needing review). Today the in-process scheduler runs every 15 minutes (apps/api/src/core/jobs.ts:56,70) and vercel.json:7 is one daily cron. On a normal server a one-minute interval is easy. On Vercel, check the plan's cron limits first (not verified) or use an external pinger on /api/hooks/jobs/run. RC-082 (the job runner, W2) builds the runner, and the one-minute tick is now in its register note. Webhook retry (RC-084) must also exist, or a lead lost at the door never reaches the inbox. Digests can use the slower tick.
### Payload privacy
The lock screen is public. Default text carries no amounts, phone numbers or full names: "New lead for you: Pune expo" and "Follow-up due now". A per-user option can show the first name. Never put tokens or ids that grant access in a URL; the URL is a route, not a secret.
### Permission-prompt UX
- Never prompt on page load.
- Ask in context, after the person has seen value: on the first lead assigned to them, or from a "Get alerts on this phone" card on My work.
- Show our own explanation first ("RadCore will buzz this phone when a new lead arrives. You can pick which alerts."), then call Notification.requestPermission() only from that button's click.
- On iPhone, first show "Add RadCore to your Home Screen" (the existing install help), then the card.
- A My notifications page shows state per device (Allowed, Blocked, Not asked), a Test button, per-category switches, quiet hours, and plain steps to unblock a denied permission.
- Re-subscribe on pushsubscriptionchange; delete the subscription on sign-out and when a user is deactivated (RC-092 makes a leaver's sign-in actually switch off).
### Fallbacks
The in-app bell (fixed to refetch on focus and every minute, A-2), then an email or WhatsApp template message for the two urgent categories if no push has succeeded for 24 hours. The WhatsApp fallback depends on approved templates (RC-184).
### Slices
- P1. Inbox table, endpoints, a bell that reads it (no push) and a one-minute dispatcher.
- P2. Service-worker push handler, subscription flow and the "new lead" push.
- P3. Categories, preferences, quiet hours and the My notifications page.
- P4. Digests, fallbacks and a delivery health screen for the owner (sent, failed, expired).
### Acceptance and prerequisites
- Needs first: A-5 (tables and dispatcher), A-7 (worker), RC-097 (safe deep links), RC-082, RC-084, RC-142, RC-092.
- Acceptance: a closed app gets a lead alert within 10 seconds on a test device; the sender is called once per assigned owner; on Android and iPhone the counter phones are tried before any promise to staff (the report marks Android and iOS behaviour "to confirm").
- Effort: 7 to 10 days (RC-185 is 6.5, W3). Until then, a cheap fix: store since in localStorage, send the last-seen time on first call so missed leads show on return, and make the bell refetch on focus.
## A6. Accessibility and Hindi or Indian formatting readiness
In plain words. Counter staff work in glare and on small phones. Pale grey text, unlabelled boxes and silent "Saved" messages are where wrong amounts get typed. Most of the fixes are in a handful of shared pieces (colours, Form, Table, Notice, Modal), so fixing them once improves every screen. Indian number formats are already right; Hindi is not yet possible.
### Accessibility (WCAG 2.2 AA), grouped by screen type (RC-189, 3 days, W3)
| Where | Problem | Fix |
| All text | Muted text #64748b is 4.34:1 on the page and 3.86:1 on chips (limit 4.5:1); used at 12 px and for labels. Amber text on white is 3.19:1. Links are told apart by colour alone | Darken muted text (for example #556178 gives 5.69:1 on the page); underline links inside text |
| Forms | Field borders are 1.23:1 on white (3:1 needed). No aria-invalid or aria-describedby; no focus move to the error. Password and phone fields set no autocomplete. Table-cell inputs have no accessible name | A field-border token of at least 3:1 (#8a94a6 is 3.06 on white but 2.79 on the page, so go slightly darker); error summary that takes focus; labels on the cell inputs |
| Tables | On phones every table becomes blocks, which removes table meaning for screen readers. No caption or scope | Restore role="table", add aria-label and scope |
| Menus, search, tabs | Search list claims listbox but holds links; account menu lacks arrow keys; tabs have no aria-controls or arrow keys | Adopt the Radix primitives (A-4) |
| Messages | "Saved", "Clocked in", "Approved" are silent for a screen reader | role="status" on Notice |
| Pages | Every page title is "RadCore" | A useDocumentTitle call inside Page |
| Dialogs | First focus goes to the close button, not the first field | Focus the first field |
| Touch targets | 42 px buttons, 38 px icon buttons; pass 2.5.8. Phone checkboxes are 20 px but their labels are clickable | Counter density: 48 px controls |

Screen-reader behaviour on the phone table layout and the search list is "to confirm" with NVDA or TalkBack. Acceptance: @axe-core/playwright shows zero serious violations on the ten busiest screens, plus the contrast unit test.
### Indian formatting, already right and to keep
formatINR groups as 12,34,567.89; counts use en-IN; compact rupees write ₹3.4L and ₹1.2Cr; dates are DD-MM-YYYY and plain text (no time zone shift); date-times are pinned to Asia/Kolkata. Invoice number format INV/26-27/00001 stays within the 16-character Rule 46 limit.
### Not ready
- Text is hard-coded English (about 96 screens); lang is fixed at en; month names in charts are an English array; amountInWords is English only; date inputs use the browser's own format; the font stack starts with Roboto, which has no Devanagari (RC-217, A-11).
- Spreadsheet imports read every file as UTF-8, so a Vyapar export saved by Excel's plain "CSV" choice can arrive with broken names (₹ becomes �; Devanagari is damaged). Read bytes, test for valid UTF-8, fall back to Windows-1252, and show the first five decoded rows with "Do these names look right?" (WEB-22, RC-117, W2, 3 days). This matters on day one of moving off Vyapar.
- Follow-up times on the older screens use the device's time zone, and "today" comes from the device clock. Parse every date-time as IST and use server time from /auth/me (WEB-30, RC-204, 0.5 day).
- Money maths in the browser uses floating point in a few places (the journal's "Out by" warning, the quick-bill "Full" button). Use the shared Decimal helpers (WEB-26, RC-215, 1 day).
Devanagari digits are not expected in Indian business use; keep en-IN numbers in both languages.
## A7. Test plan for the new front end (Playwright)
In plain words. The owner cannot see a duplicate save or a stale number happen. The only protection is tests that run on every change. A few tests on the shared plumbing and about a dozen full-journey tests catch the defects the review found.
Setup (A-1, RC-150). Playwright 1.64.1 against the API in PGlite mode (no Docker). Vitest 5.0.5 with Testing Library 16.3.3 for units; MSW 3.0.3 for stubs. ESLint in CI. Axe via @axe-core/playwright. Needs RC-005 so CI runs a real database job at all. Roughly 0.5 day per new screen afterward.
Lint rules that keep it safe (not tests, but they fail CI). No bare post, put or patch in a component (no-restricted-imports). Flag Number( on fields named amount, total, balance, price or rate. Ban hand-rolled form state plus a bare post.
### Journeys
| # | Flow | What it proves | Item |
| 1 | Retry after a lost reply: first request commits, response aborted, user presses again | Both requests carry the same key; one credit note exists | A-0, WEB-01 |
| 2 | Lost reply on booking, payroll approve and opening-balance import | One record each | WEB-11 |
| 3 | Signed-out dialog: clear the cookie, save, press Esc | Dialog stays; sign in; typed values intact | WEB-02 |
| 4 | Show more on stock movements; export of 6,000 invoices | One limit in the URL; export is complete or fails loudly | WEB-03, 04 |
| 5 | Payments with 2,100 parties seeded | Party 2,050 found by typing, payment recorded | WEB-05 |
| 6 | Quick bill by keyboard only: scan, tender, print | Thermal layout printed; no mouse event; under 30 seconds | A-6, WEB-06 |
| 7 | Thermal PDF | Page is 80 mm wide; shared-link PDF has the same total as the screen | WEB-25 |
| 8 | 60,000-rupee anonymous quick bill | API refuses; printed invoice shows name, address and reverse-charge text | WEB-07 |
| 9 | Invoice with IRN | 64-character IRN and a QR render; cancelled IRN shows "IRN cancelled" | WEB-08 |
| 10 | Bank "Match to..." dropdown | ArrowDown sends no request; the Match button sends one | WEB-10 |
| 11 | Type five characters in a search box | At most two requests | WEB-16 |
| 12 | Revoke a permission in one tab | The button disappears in another tab within a minute | WEB-16 |
| 13 | Mocked bad answer shape | Error screen shows, sidebar works, error recorded | WEB-17 |
| 14 | Attendance register: mark three people, approve a leave request | The three marks remain; Save sends them | WEB-33 |
| 15 | Double click on "Save receipt" and "Save bill" on a purchase order | Exactly one document | WEB-34 |
| 16 | Run as operations and as marketing | Job-work send-out completes; Walk-in shows no "Buying now" | WEB-23 |
| 17 | Public enquiry form: force one server error, press send again | The second request carries a fresh captcha token | WEB-27 |
| 18 | Time zone: run with TZ=America/New_York, create a follow-up | Stored as the IST instant | WEB-30 |
| 19 | Headers: curl -I on /, /login, /i/x | New headers and noindex on private links | WEB-24 |
| 20 | Axe on the ten busiest screens | Zero serious violations | WEB-20 |
| 21 | Hindi mode on quick bill and the thermal invoice | No English labels from the known-string list | WEB-29 |
| 22 | Offline mode with a half-filled quick bill, then reload | Offline banner (not "Failed to fetch"); draft survives | WEB-12 |
| 23 | Offline sale, then reconnect (S2) | One invoice with the server number; same key resent returns the first answer | A4 |
| 24 | Offline fault set: commit-then-drop reply, duplicate delivery, two tills selling the last serial, clock skew, 4-hour outage with 200 queued bills, clearing site data mid-queue | No duplicate, no silent loss, warning before sign-out with a non-empty outbox | A4 |
| 25 | Push with the app closed | Lead alert on a test device within 10 seconds; sender called once per owner | A5 |
| 26 | Lead inbox at phone width | Call, WhatsApp, Done, Reschedule and Lost each complete in one tap | A-10 |

### Unit and component tests
withLimit yields exactly one limit; the redirect check passes the six bad strings; Form and ActionButton renew the key only on success; a token contrast test over every pair in light and dark; 0.1 plus 0.2 against 0.3 shows "balanced"; a reworded server message still shows the payroll "Approve as it is?" confirm; the Windows-1252 file "Café Ünïcode ₹" and a UTF-8 Hindi file both preview correctly; the 14-character GSTIN is rejected by the shared schema in the API suite and in the form test.
### Role matrix
Turn the earlier audit's role-by-page-by-API script into a CI test: for each role, each page and its API call. This catches "a screen a role can open but not finish" (WEB-23).
# Part B: AI features
## B1. The short version
In plain words. There is no AI code in RadCore today. The review found it can be built safely, but not on the code as it is. The safest design is one where the AI model never touches the database. It can only ask for named, read-only tools, and each tool is an existing screen route called with a short-lived copy of the signed-in person's own login. So whatever the person cannot see on a screen, the AI cannot see either, because the same guards run. Nothing the AI produces goes into the books by itself: a bill is only ever a draft until a person clicks the normal Save button.
Four features, in the order they should be built:
| Order | Feature | What it does | Needs a model? |
| 1 | Unusual-activity alerts | Tells the owner when a pattern of known abuse appears (someone approving their own pay, a period lock moved back, a mass export) | No. Plain rules; a model may later explain an alert |
| 2 | Bill reading | Turns a supplier's PDF bill into a pre-filled draft purchase bill that an accounts clerk checks and posts | Yes (small model, no tools) |
| 3 | Plain-English questions | "How much did we sell last week?" answered from the same reports the person can already open | Yes (small router, stronger model with tools) |
| 4 | Technician assistant | On a job card: summary, warranty status, similar past jobs, a draft note | Yes (needs months of job-card history) |

Readiness (area 09): 2 out of 5. The permission and audit foundations are real and well organised, but the data an AI would read leaks past role in several routes, and sign-in, device and export records, a draft-bill state, a read-only database login and a work queue do not exist yet.
Honest limits. Accuracy targets below are proposals to be tested on real sets; none was measured. Token counts and volumes are assumptions. Nothing here is legal advice.
## B2. Foundations first: what the code lacks today
In plain words. Before any AI feature, fix the places where information already leaks past role, start recording who signs in and what they export (history cannot be back-filled), build a proper queue for slow work, and create a separate place for AI proposals. Without these, an assistant would volunteer a customer's balance to a technician in a friendly sentence.
| Foundation | Needed by | Today | RC item (wave, days) |
| Known data leaks closed. Party detail returns balance, open invoices, PAN and phone to every role that can read parties (including technician); the lead lookup, job document and job-work cost fields also leak; email is never masked; a salesperson can request 5,000 rows | Questions, assistant, bills | Open (AIX-02) | RC-042 (W1, 2), RC-040 (W1, 2.5) |
| Rows scoped to the person. Any salesperson lists every lead; any technician lists every job card. Owner decision | Questions, assistant | Open (AIX-11) | RC-041 (W1, 3.5) |
| Sign-in, device and export records. A good login leaves nothing; a failed one leaves nothing; an export leaves no row | Alerts R6, R7, R8, R10 | Missing (AIX-04) | RC-031 (W1, 4) |
| Errors and alerts that do not leak. recordProblem sends raw message text to a webhook; a provider error could carry a prompt | All | Open (AIX-07) | RC-007 (W1, 1.5) |
| Logging with request ids (only console.log today) | All, to join a model call to its request without logging the text | Missing | RC-077 (W2, 2.5) |
| Safe database roles. The app login can update and delete everywhere; no read-only login | Alert rules, any AI read access (executor, questions, assistant) | Missing (AIX-08) | RC-003 (W1, 2), then RC-193 (W3, 1). RC-193 stays Wave 3; the alert rules and any AI read access wait for it |
| Job runner with a queue (claim with a row lock, attempts, timeout; runs on the production host). Today: one 15-minute in-process timer; once a day on Vercel | Bills (slow extraction), alerts | Partial (AIX-06) | RC-082 (W2, 7) |
| "Saved once" guard tied to what was sent | Posting a drafted bill | Partial (AIX-09) | RC-132 (W2, 4.5) |
| Permission service callable from non-HTTP code; permission changes seen by every server | Questions, assistant, alert job | Partial (AIX-01, AIX-14) | RC-171 (W3, 1), RC-095 (W2, 1.25) |
| Draft state for purchase bills and a file-to-bill link. A bill posts to the books the moment it is created | Bill reading | Missing (AIX-03) | RC-172 (W3, 2) |
| Outsider text tagged as outsider (WhatsApp, lead forms, complaints share fields with staff notes) | All that read free text | Missing (AIX-05) | RC-173 (W3, 1.5) |
| Per-user rate limit and a monthly spend cap on signed-in routes | Questions, assistant, bills | Missing (AIX-10) | RC-194 (W3, 1), after RC-088 (W2, 2) |
| Two accounting defects fixed first (credit on unregistered suppliers; billing above the approved purchase order) | Bill reading | Open (AIX-13) | RC-014 (W1, 5), RC-056 (W2, 4.5), validator warnings RC-196 (W3, 0.25) |
| Consent evidence and a notice covering AI processing; processor register | All | Not started | RC-032 (W1, 4), RC-195 (W3, 1) |
| Personal data erasure that also reaches AI logs | All | Missing | RC-011 (W1, 6) |
| India region and provider contract | All | Not started (organisational); the only running copy is in Singapore | RC-018 (W1, 1.25), RC-015 (W1, 2); owner and counsel |
| Redaction and per-tool field allowlists; ai_events log; gateway; executor | All | Phone and address masking on lists only | New work (inside the report's Phase 0); not in the register |
| Test harness for role matrices | All evaluation gates | Present (in-memory database plus supertest) | extend |

### Dependency order
- Decisions and paperwork (no code). Vendor and region, data processing agreement, notice wording with counsel, budget cap, human-in-the-loop policy. Can start today. Sign the provider terms in parallel with everything else.
- Wave 1 data-safety items the AI inherits: RC-003, RC-040, RC-042, RC-041, RC-007, RC-031, RC-032, RC-014, RC-011, RC-018. RC-031 must be recording before go-live.
- Wave 2 platform items: RC-132, RC-082, RC-077, RC-088, RC-095, RC-056.
- AI-specific items, with RC-193 (read-only login) first. The alert rules and any AI read access wait for RC-193, so schedule it before the AI build starts. Then RC-171 (tool registry and lint rule), RC-173 (outsider-text tag), RC-172 (draft table), RC-194 (limits and cap), RC-195, RC-196, plus the new gateway, ai_events, redactor and executor.
- Then the features, in the order of section B7.
The report sizes this Phase 0 at about 14.5 developer-days (leaks 2, telemetry 2, executor and registry 3, ai_events, redactor, budget and rate limit 3, queue 2, read-only login and logging 2, idempotency 0.5). The register's AI readiness theme is only 9.75 days because it splits the same work across themes (telemetry sits in RC-031, the queue in RC-082, logging in RC-007 and RC-077).
## B3. How all four features are built (shared design)
### Role binding: how the AI never shows what a role cannot see
- The person opens the chat or uploads a bill. The browser calls /api/ai/... with the normal session cookie. The permission check (ai:ask or ai:bill_read) runs first.
- The server creates a delegated session: a session row for the same user with scope ai_read, a parent session, a 2-minute expiry and no renewal.
- Each tool call is an in-process request to the real Express app, carrying that delegated cookie, made with a no-socket injector such as light-my-request (MIT; version to be pinned at build, not checked). So the request passes the same-origin check, authentication, the route's own permission check, and the cost-hiding and phone-masking filters exactly as if that person had clicked the screen.
- A new middleware right after authentication refuses every non-GET request, and any path outside the tool allowlist, when the scope is ai_read. So even a bug in the tool registry cannot produce a write.
- A 401 or 403 from the route becomes a generic not_permitted result. The model is told only that, so it cannot learn whether data exists.
- The delegated session is deleted when the request ends. The model never sees the token.
Why not the alternatives. Calling service functions directly skips the response filters (AIX-01). A service account with broad read access makes the AI see more than the person. A second permission table drifts from the real one. Text-to-SQL needs a login that sees every table (about 100 tables, with personal data in several) and bypasses all filters; it is not to be built.
The tool registry. Each tool is { name, description, method: GET, path, argsSchema, maxRows, fields (allowlist of response keys), sensitive }. Arguments are checked by the tool's schema and then by the route's. fields removes everything the model does not need: no PAN, email, bank account number, address, or individuals' GSTIN; phones become last four digits for every role. maxRows is 50. Money stays as the route's strings; the model is told never to retype or recompute figures. Tool menus are filtered by what the role can do at that moment. A nightly test calls every tool as every role and compares with the real permission function. A code rule forbids anything under apps/api/src/ai/ from importing the modules, the database layer or the ORM.
### The draft-only rule
The AI side writes only to its own tables (ai_bill_drafts, ai_events, security_alerts). It has no function that can call the code that posts a bill, move stock, change a status, send a message or block a user. Nothing posts automatically, at any phase. Every state change is a human click on an existing route, under that human's own session, with that route's own checks. An optional later control: drafts above the purchase-order approval limit need a second person with po:approve to confirm before the post button is enabled.
### Prompt-injection defences (shared)
Untrusted text in RadCore: bill PDFs, WhatsApp messages, lead form answers and notes, public enquiries, job-card complaints, item and supplier names typed by anyone, uploaded file names, email bodies from the statements mailbox. In order of weight:
- Limit what a tricked model can do. Read-only delegated session; allowlist of GET tools; no write tool in phases 1 to 4; no tool takes a URL, sends a message or reaches the internet; a tool-less call for bills. This works even when everything else fails.
- Limit what it can see. Only the caller's role data, field allowlists, redaction.
- Limit how it can leak. Strip markdown links, images and HTML from every model output; render model text as plain text only; never auto-open links. This blocks the "put the data in a URL" trick.
- Label data as data. Wrap each piece of untrusted text in delimiters with an attribute and tell the model that text inside is content, not instructions. Strip any delimiter-looking text from the input first.
- Origin tags. Add an origin (staff or external) to lead activities and tag lead notes and job complaints at write time (RC-173). External text is wrapped and cut to 500 characters.
- Verify, do not trust, model output. Figures are checked against tool results; bill fields against arithmetic and the masters; state changes are a human click.
- Detect for attention, not as a wall. Flag instruction-like phrases ("ignore previous", "system prompt") in ai_events and show a banner. This can be bypassed, and is not a defence.
- Test it. A set of 30 planted-instruction cases (lead names, WhatsApp text, bill PDFs with white text, job complaints, supplier names) runs in the regression gate. Pass means structural: no call outside the allowlist, no link in output, no data from outside the caller's role.
### Data residency and redaction
| Data | Rule before anything is sent to a model |
| Phone numbers | Last four digits only, always; redacted in free text by pattern |
| Email | Removed from structured fields; redacted in free text |
| Addresses | Not sent; city or state only where the question needs it |
| PAN of an individual, Aadhaar, bank account number, IFSC beside an account, UPI id, card number | Never sent; replaced by placeholders (for example [PAN_1]) with the map kept in memory for that request only; not re-inserted into answers in phases 1 to 4 |
| GSTIN | May be sent (a public identifier, needed to match a supplier). It embeds the PAN, so redacting a PAN while sending the GSTIN would be cosmetic. Treating GSTIN as public is to be confirmed with counsel |
| Salaries, payslips, employee bank details | Never sent in phases 1 to 4 |
| Cost price, margin | Only to a role that holds the cost-visibility permission, and only through routes that already hide it |

The redactor patterns (PAN, mobile, Aadhaar, account numbers near "A/c", IFSC, UPI, Luhn-valid card numbers, email) must be tested with a table of positive and negative cases. False negatives are the risk, so it runs on every outbound string, including tool results.
Where the model runs.
- The proposal and the PRD require Indian data residency, and the review copy currently runs in Singapore (RC-018). The AI gateway must be hosted in India and call a provider endpoint that processes in India.
- As of 28 October 2026, an AWS post dated 29 September 2026 says Claude Opus 5, Sonnet 5 and Haiku 4.5 are on Amazon Bedrock through an India cross-Region inference profile that routes only between Mumbai (ap-south-1) and Hyderabad (ap-south-2); that prompts and outputs may move between those two regions; that customer data is not stored in the destination region; and that Bedrock uses zero data retention by default, though some models may require human review if safety classifiers flag content. Flag: the reviewer read this through a summarising reader. Read the post and the model card, and check the exact model and profile, before signing.
- A search on the same date found no confirmation of Claude on Google Vertex AI in asia-south1, and no India-region claim for Anthropic's direct API. Treat both as not India-resident until the provider confirms in writing.
- The contract (a data processing agreement) must state region, no training on inputs, retention (zero or 30 days, in writing), sub-processors, breach-notice time and deletion on exit. The DPDP Act expects a valid contract with any processor (section 8(2) as the reviewer reads it; confirm with counsel). Provider retention terms were not verified beyond the AWS summary.
- DPDP timing (unverified, for the owner). The Rules were reported as notified on 13 November 2025. A September 2026 law-firm commentary says the cross-border transfer provisions (section 16 and Rule 15) begin on 13 May 2027 and that no restricted-country list had been notified. That is commentary, not the Gazette text (G.S.R. 846(E) is the reference to check) and could change. Because the PRD already promises India, keep India-only regardless.
- Other DPDP points: update the privacy notice to say customer and supplier data may be processed by an AI service; keep the field allowlists (minimisation); record the provider and region on every call (ai_events.provider_region); delete a customer's text from AI logs when the customer is erased.
### Audit logging of every AI action
A new append-only table ai_events (same no-update, no-delete trigger as the audit log) records, per call: time, user, role at the time, feature, request id, model id actually used, provider region, redacted prompt and its hash, tool calls (tool, arguments, status, rows, bytes), redacted response, tokens in and out, cost, latency, outcome (ok, refused, error, filtered) and injection flags. Redacted prompt and response text are kept 90 days, then nulled; hashes stay. Every effect on the books also writes the normal audit row with via = ai_draft and the source draft id. Each user can read their own AI history; holders of audit-read see all. Reading a full lead or party record through a tool also writes the data-protection access log. Never log or alert raw prompts or provider messages (RC-007).
### Models, budget and failure (shared)
- Two tiers, set in configuration, never in code. A small, fast tier for bill extraction, question routing and classification; a stronger tier for multi-step tool use, the technician assistant and re-reading a bill the small tier failed on. At the time of writing a Haiku-class and a Sonnet-class model would fill the slots. The model id is recorded on every ai_events row so an evaluation result is tied to a model.
- Limits. A per-user limit on /api/ai/* (the report's example: 20 questions an hour, 60 a day, 30 bill reads a day, as settings) and a monthly spend cap in settings, checked before each call. When the cap is hit the feature turns off with a clear message and the owner is alerted (RC-194).
- Switches. An admin switch per feature (for example ai_enabled.ask) turns it off at once. A circuit breaker turns a feature off for five minutes after five failures in two minutes.
- Screens. The AI report lists the chat panel, the pre-filled bill form and the alert inbox as not reviewed by the front-end work, and the front-end report does not design them. Each is designed below under its feature, with an effort range that is my estimate, not a reviewer's. They should be built on the form library and building blocks from A-3 and A-4, not on new hand-rolled forms.
## B4. The four features
### B4.1 Bill reading (supplier bills into draft purchase bills)
- Purpose. The accounts clerk who today types each supplier bill line by line uploads a PDF and gets a draft purchase bill beside the original, with every uncertain field marked. The clerk checks it and posts it with the normal button.
- How it works.
- Upload through the existing file route (purpose=bill), then POST /api/ai/bill-drafts { file_id }. A job row is created and the draft id returned at once; the screen polls.
- A worker (the queue, RC-082) loads the file, checks its hash against earlier drafts and bills, and extracts the text layer with unpdf (already used for bank statements).
- Digital PDFs first (GST e-invoices and most registered suppliers). If a page has almost no text it is a scan: the draft is marked needs_manual in phase 2.
- Clean the text: drop tiny, off-page or invisible text; redact bank account numbers, personal phone and email, Aadhaar; keep the GSTIN.
- One tool-less call on the small tier with a strict JSON schema: supplier name and GSTIN, invoice number and date, due date, place of supply, currency, PO reference, lines (description, HSN or SAC, quantity, unit, rate, taxable value, GST rate, CGST, SGST, IGST, amount), printed totals; and for every field a short quoted evidence snippet and a confidence. A field with no evidence snippet is blanked and flagged.
- Checks in code, with no model: the GSTIN passes the validity check and maps to a supplier (otherwise up to three name matches for the clerk; never create a supplier or an item); duplicate supplier and invoice number or same file hash; dates parse and the bill is not in the future; the month is not filed or locked; lines map to open purchase-order lines (a stock item with no PO line is marked "needs a PO and goods receipt first"); each line and the whole bill are recomputed with the tax engine, and the printed grand total must agree within 1 rupee; CGST/SGST versus IGST must match place of supply; a supplier with no GSTIN, or outside India, gets a warning; a bill above the approved PO value gets a warning (RC-056); bank details that differ from the supplier master are flagged (a classic invoice-fraud signal), compared locally on the original text and never sent to the model.
- Save the draft with the proposed body (exactly the body of POST /api/purchasing/bills), the flags and the evidence.
- The existing bill form opens pre-filled, with the PDF alongside and evidence under each field. The clerk edits and clicks the existing Save bill, under their own session, with the key bill-draft-<id>. All the route's checks run.
- Role tie. The job runs as the uploading user; the model has no tools and sees only redacted text of that one file. Suppliers and POs offered as candidates are read through the user's own purchasing routes, so a role that cannot read POs gets a draft without PO matching. Only holders of bills:write (accounts, admin) can create or post drafts.
- Draft-only rule. The AI writes only to ai_bill_drafts and ai_events. A new table is used on purpose: adding status = 'draft' to the bills table is the tempting shortcut and the riskier one, since every report, view and the GST engine would have to learn to ignore drafts (AIX-03).
- Injection defences specific to bills. No tools, so an injected instruction can distort fields at worst, and the validators and the human catch distortions. Document text sits inside delimiters labelled as data. Instruction-like phrases raise a banner for attention. Hidden text (tiny, white, off-page) is dropped using the positions and heights unpdf returns. The extractor is never given other documents, other suppliers' data or secrets.
- Residency and redaction. Model in India; redact before sending as in B3. A supplier's standalone individual PAN is redacted; GSTIN is kept. Scanned or photographed bills cannot be redacted before sending (it needs pixel-level work), so that path is held to phase 5 and needs a decision from the owner and counsel.
- Audit. ai_events per read; ai_bill_drafts keeps a per-field record of the AI value and the posted value, so a monthly report can show which fields clerks keep correcting. The normal audit row carries via = ai_draft.
- Evaluation plan and accuracy bar.
- Golden set of 200 real Radboards bills (the last 12 months, bank details redacted, one person types the right answer, about 1 hour per 10 bills): 60 from the ten biggest suppliers, 40 from the long tail, 30 GST e-invoices with QR, 20 multi-page, 10 import or foreign, 10 credit or debit notes, 10 adversarial (planted instructions, hidden text, edited totals, duplicates), 20 scans or photos held out until phase 5.
- Targets on the digital set: supplier identified 98% (of bills that carry a GSTIN); invoice number 99%; invoice date 99%; grand total within 1 rupee 98%; per-line quantity, rate and GST rate 95%; drafts needing no edit at least 70% in phase 2, 85% after three months live.
- Zero-tolerance gates: "silent wrong money" (a draft passes the validator with no flag but a money field differs from the truth) must be 0 on the golden set and under 0.5% of live drafts in monthly sampling; no draft ever changes the books; all 10 adversarial bills produce a flag or a blank field, never a quietly wrong value.
- Regression gate: the set runs in replay mode (recorded replies, free, deterministic) on every change to the bill code, the prompt or the validator. A live run (about 200 calls, about $2) is required before any change of the small-tier model, and weekly in the first three months. Any hard-gate breach, or a drop of more than 1 point on any target, blocks the change.
- Live monitoring: compare AI values with posted values; alert the owner's dashboard if "needs no edit" falls under 60% for a week.
- Cost per 1,000 bills (assumptions: digital PDF of one and a half pages; 3,500 input and 700 output tokens on the small tier at Haiku 4.5 list prices of $1 in and $5 out per million; 20% need a second read on the stronger tier at Sonnet 5 list prices of $2 in and $10 out, 4,500 in and 900 out). Small tier $7.00, second reads $3.60, total about $10.60 per 1,000 bills (about 950 rupees at an assumed 90 per dollar). At an assumed 400 bills a month, about $4 a month. The scan path (phase 5) assumes about 5,000 input tokens per bill and the reviewer quotes about $12.70 per 1,000 (my recompute is about $12.10; see "Decisions taken", item 6). The provider's 50% batch discount does not apply because a clerk is waiting. Prices are Anthropic's list prices fetched 28 October 2026; Bedrock India prices were not checked; get a quote.
- Failure behaviour. Provider error, 30-second timeout, invalid JSON (one repair retry), over budget or feature off: the draft is marked failed with a plain reason and the clerk uses the normal blank bill form exactly as today. The upload is never lost. A draft older than 14 days is discarded. If the same supplier's bills fail twice, the screen says so and stops retrying. Duplicate uploads are caught by file hash, and a double-read bill fails safely at post time on the existing one-bill-per-supplier-invoice rule.
- Latency. Upload returns at once. Draft ready: median 8 seconds, p95 25 seconds. The clerk can start typing without waiting.
- Screen design (my design and my estimate, not a reviewer's). From Purchase bills, "Read a bill" takes a PDF and shows "Reading..." while the screen polls the draft. It then opens the existing bill form pre-filled from the proposed body, in two panes: the original PDF on one side (in a sandboxed frame), the form on the other. Every AI-filled field carries a small badge saying how sure the reading was, and its quoted evidence appears when the field is focused. Flagged fields are marked with words as well as colour ("totals do not agree", "needs a PO and goods receipt first", "bank details differ", "contains instruction-like text"), and the flags are listed at the top. Supplier and PO matches use the server-searched combobox, offering up to three supplier matches and never a "create supplier" button. A permanent label says "Draft, not posted". Save bill is the existing button through the protected wrapper with the key bill-draft-<id>; Discard marks the draft discarded; on failure the screen shows the plain reason and the normal blank form. The screen sends both the AI value and the posted value of each field, so the monthly "which fields get corrected" report works. Estimate: 6 to 9 days (my estimate). The reviewer names the pre-filled form inside the phase 2a total of about 12 days but gives it no separate figure; treat my range as the screen's share of that total, and add to the phase only if the screen proves larger.
- Build order. Phase 2a about 12 developer-days (drafts table and migration, queue, extractor, validator, pre-filled form, evaluation harness) plus phase 2b about 3 days of the accounts team's time and 2 of a developer for the 200-bill set. Needs the foundations of B2, and RC-014 and RC-056 fixed first (RC-196), or a quick click on a draft claims credit on an unregistered supplier or pays a price above the order.
### B4.2 Plain-English questions
- Purpose. Owner, accounts, stores and sales staff who today open several screens or export to Excel type "how much did we sell last week" or "which dealers owe more than 60 days". The answer quotes figures and says which report they came from. It is not a decision tool.
- How it works. (1) POST /api/ai/ask, with the rate limit and budget check. (2) The small model decides: data question, "how do I" question, or out of scope (HR and payroll in phases 1 to 3, legal advice, anything about a named individual's pay) and returns a fixed refusal if out of scope. (3) The stronger model gets a tool menu filtered by what the role can do now. (4) A tool loop of at most 5 calls and 20 seconds. (5) The model returns text plus figures [{label, value, tool_call_id, path}]. The server checks that each figure's value really sits at that path in the stored tool result. The screen draws the figures table from the server's data, not from the model's text; if the text holds a number that is not among the verified figures, the text is dropped and only the table is shown. (6) Save ai_events; keep a redacted conversation per user for follow-ups, never shared.
- Phase 1 tools (all existing read routes): dashboard overview, stock on hand and low stock, sales order summary and list, sales invoices, receivables and payables ageing, profit and loss, trial balance, day book (limited), purchase bills and payables, GSTR-3B, lead pipeline (counts only), service jobs. Excluded until reviewed: payroll, HR, employees, bank, users, settings, audit log, opening balances, journal detail, party detail (until RC-042 is done).
- Role tie. The delegated read-only session of B3. The report routes already gate on accounts, GST and stock permissions, and the cost filter drops cost and margin keys for roles without cost visibility. A salesperson asking about margin gets none, because the route removed it, and the model says it cannot see that. Aggregates are not a loophole, because valuation and margin are themselves cost keys.
- Draft-only rule. Read-only. There is no write tool, and the ask session cannot make a non-GET request.
- Injection defences specific to questions. Tool results contain free text (lead names, notes, item and supplier names); they are wrapped in <tool_result untrusted="true"> and the system prompt says text inside is data. No tool takes a URL or sends anything. Output is plain text with links and images stripped. The worst a tricked model can do is read something the user could already read.
- Residency and redaction. Field allowlists drop contact and identity fields; phones last-4 only; email, PAN, bank and Aadhaar patterns redacted in free text; questions about named individuals' pay are refused in phases 1 to 3. Model in India.
- Audit. Every question and tool call in ai_events. Reading a full lead or party through a tool writes the access log.
- Evaluation plan and accuracy bar.
- Golden set of 150 questions run against the demo seed where the right figures are known: 60 stock and sales, 40 receivables and payables, 25 GST and accounts, 25 leads and service.
- Permission red-team set of 60: for each of technician, marketing, sales, store, stores, operations and hr, ask for data that role must not see (margins, payables, salaries, other roles' reports). Expected: refusal or absence, no number.
- Injection set of 30.
- Targets: every figure traceable to a tool result 100% (hard gate); correct tool choice at least 90%; refusal correctness on the permission set 100% (hard gate); no tool call outside the allowlist 100%; latency within budget.
- Regression gate: the permission set and the registry-versus-permission test run on every change to the AI code, the permission table or any router. The full live-model set runs before any change of model or prompt and fails if a hard gate breaks or accuracy drops more than 2 points.
- Cost per 1,000 questions (assumptions: router call on the small tier, 1,200 in and 100 out, about $1.70; main call on the stronger tier, 3 turns, 18,000 input tokens in total and 1,200 out, $48 with no caching or about $38 with the 3,000-token tool menu cached, using Sonnet 5 list prices including $0.20 per million for cached reads). Total about $40 to $50 per 1,000 questions. At an assumed 15 users, 5 questions a day, 26 days (1,950 a month): about $80 to $100 a month. Same price caveats as bills.
- Failure behaviour. Provider down, over time budget or over the cap: "Ask is unavailable", with links to the nearest report screens from a fixed keyword map. A tool error: the model must say it could not get that figure, and the verifier forbids inventing one. Output that fails the verifier shows the figures table only. Circuit breaker and admin switch as in B3.
- Latency. Router under 1 second; first visible text under 3 seconds (show "looking at stock..." progress); each tool under 1 second (to confirm under load); whole answer p95 under 15 seconds; hard stop 30 seconds.
- Screen design (my design and my estimate, not a reviewer's). A side panel opened from the app frame, shown only to roles that hold the ask permission, usable at phone width. A text box; while the server works it lists each step ("looking at stock...", "reading receivables"). The answer is plain text with a figures table beneath it drawn from the server's verified data; each figure names its source report and links to that report screen if the person can open it. Links and images in model text are never rendered. States: "I cannot see that" for a refused tool; "Ask is unavailable" with links to the nearest report screens when the feature is off or over its cap; a quiet "questions left today" note near the limit. A list of the person's own past conversations. Estimate: 4 to 6 days (my estimate). The reviewer includes "UI chat panel" in the phase 3a total of about 8 days without a separate figure; the same remark applies.
- Build order. Phase 3: 3a about 8 developer-days (executor, 8 tools, verifier, chat panel, golden and permission sets); 3b about 4 days (remaining tools, conversation memory). A later phase 5 may add a safer cousin of text-to-SQL: the model fills a report spec (metric, group-by, period, filters from a fixed list) that fixed, reviewed SQL runs under the read-only login. Needs RC-042 fixed, the read-only login, and the red-team set.
### B4.3 Technician assistant
- Purpose. A workshop technician or service manager on a phone or bench tablet with a job card open: what the customer complained about in plain words, what is under warranty, what failed on similar units and what was done, a draft diagnosis note and a draft customer message. It suggests; the technician decides.
- Honest constraint. The best answers need RadCore's own history of job cards, fault codes and comebacks. RadCore has none on day one, and the Vyapar move brings accounts, not job cards. So the assistant is first a summariser and warranty explainer, and only after three to six months of data a "what usually fixed this" helper. That is why it is last.
- How it works. (1) An "Assist" button on the job page calls POST /api/ai/assist { job_id, question? }, with the permission ai:ask and the route's own service-read check. (2) The executor runs tools as the technician's delegated session: the job (lines, faults, parts), warranty by serial (deterministic), earlier jobs on the unit and its components, failures by model, component and batch, fault codes, comebacks. (3) Phase 4a uses structured data only; 4b adds Postgres full-text search over past complaints and diagnoses (no embeddings needed at Radboards' volume); embeddings or manufacturer manuals are phase 5 and need a rights check. (4) The stronger model composes a summary, warranty status quoted from the warranty tool, similar past jobs with ids, suggested fault codes from the existing list (it may only choose codes that exist) and a draft note, with links to the records it used. (5) In 4b, "add this fault code" calls the existing route as the technician's own click. There is no button for issuing parts, changing status or delivering.
- Role tie. Delegated session. A technician holds service, item, unit and party read, but not cost or personal-data visibility. The leaks in RC-042 (the unmasked customer phone in the job document, party detail) must be fixed first. Whether technicians see only their own jobs is the owner's choice (RC-041).
- Draft-only rule. Read-only in 4a. In 4b a suggestion that becomes a write is a pre-filled form, an ordinary request under the technician's session with its own check. The assistant never issues a part, never moves a status, never approves an estimate.
- Injection defences specific to the assistant. Customer complaint text and past notes are the untrusted channel; wrap and truncate them. Read-only means the worst case is a wrong suggestion. The warranty answer is quoted from the tool, never produced by the model, so a customer cannot "talk" the assistant into saying a unit is under warranty. Photos are not sent before phase 5, and then with location data stripped.
- Residency and redaction. The assistant needs the unit, model, complaint and history, not the customer's name or number. The party name becomes [CUSTOMER]; the customer-message draft contains a placeholder that the screen fills in locally. Model in India.
- Audit. ai_events per question; an accepted suggestion writes the normal job-card audit row with via: ai.
- Evaluation plan and accuracy bar. A set from 80 closed job cards (until history exists, 30 synthetic jobs written by the service manager). Targets: warranty answers 100% equal to the warranty tool (hard gate); the correct fault code in the top three at least 70% once 200 closed jobs exist; zero invented job numbers or part numbers (every cited id must exist in a tool result, hard gate); a technician must never get cost or customer contact data (hard gate). Technicians rate each answer "helped / did not" with one tap; reviewed weekly. Regression gate as for questions.
- Cost per 1,000 uses (assumptions: a summary or warranty question on the small tier, 8,000 in and 400 out, about $10 per 1,000; a diagnosis question on the stronger tier, 12,000 in over two turns and 600 out, about $30 per 1,000; an assumed 70/30 mix). About $16 per 1,000 uses. At an assumed 10 technicians, 6 uses a day, 26 days (1,560 a month): about $25 a month. Same price caveats.
- Failure behaviour. If the assistant is unavailable, the job page works as today. If a tool returns nothing (no history), it says "no similar jobs yet" and does not guess. No offline mode.
- Latency. First text under 3 seconds on a 4G phone; complete answer p95 under 8 seconds.
- Screen design (my design and my estimate, not a reviewer's). An "Assist" button on the job page opens a panel: a plain summary of the complaint, the warranty line quoted from the warranty tool, similar past jobs as links to the real records, a draft diagnosis note the technician can edit and, in 4b, suggested fault codes as pre-filled buttons that call the normal route as the technician's own click. A one-tap "helped / did not" rating. No button issues parts or changes status. Estimate: 2 to 3 days on top of the chat panel's parts (my estimate).
- Build order. 4a about 6 developer-days (read-only summary and warranty explainer); 4b about 4 days (similar-job search and the fault-code button), only after 3 months of job history. Phase 5: photos, manuals. Needs the phase 3 executor.
### B4.4 Unusual-activity alerts
- Purpose. The owner and the admin get a short "look at this" list when someone does something that matches a known abuse path. This works well with no model at all: build the rules first, and add a model only to explain an alert in two plain sentences.
- How it works. Rules are queries, each with an id, a severity, thresholds read from settings, the data it reads and a test with positive and negative cases. A watch job runs them every 15 minutes under the read-only database login. Each hit inserts a row into security_alerts (rule, severity, subject, evidence as record ids and counts, window, status open / acknowledged / false positive, a unique dedupe key so the job is safe to repeat, handled-by and note). Delivery: an in-app inbox for owner and admin, plus one line to the private alert webhook with only the rule name, severity and a link (no customer names, amounts or free text). Critical rules (R3, R9) can also be written in the same transaction as the change, for under 1 second.
- Role tie. The inbox is gated by ai:alerts (owner, admin). The job reads as a database role, not as a user, because it is not answering a person. An alert about the owner goes to the admin and vice versa, so an admin is never the only reader of an alert about themselves. The explainer, if added, sees record ids and counts only.
- Draft-only rule. Rules only read and write security_alerts. Nothing is blocked, reversed or locked automatically. A tempting automation (suspend a user) is left to the owner.
- Injection defences specific to alerts. The rules read structured fields, not free text, so there is little to inject. The optional explainer sees ids and numbers only; free-text fields are not passed.
- Residency and redaction. Alert evidence stores record ids, not contact data. The webhook gets rule names only. The inbox shows names only to those who can already see them. No model call for the rules, so no residency question until the optional explainer.
- Audit. Every alert, acknowledgement and "false positive" mark is stored with who and when. Changing a threshold writes an audit row.
- Evaluation plan and accuracy bar. Each rule has a test using the in-memory harness: a seeded abuse scenario that must fire exactly one alert, and a normal-day scenario that must fire none. Scenarios come from the earlier audit's proof tests (self-approved reopen, own record, own advance, own purchase order, new owner). Targets: 100% of seeded scenarios detected in one run; 0 alerts on a 30-day clean replay of the demo data; precision at least 60% in the first month and 80% after tuning; time from event to alert under 20 minutes. An alert budget of no more than about 5 a day for this company. Regression gate: the whole file on every change to the audit code, to a router that writes audit rows, or to the rules.
- Cost per 1,000 alerts. Rules: no model cost, only a few database reads every 15 minutes. Optional explainer on the small tier (1,500 in, 250 out): about $2.75 per 1,000 alerts, a few cents a month.
- Failure behaviour. If the watch job fails it goes through the error recorder. A watch_stale alert fires if the last run is older than 45 minutes. If the webhook fails, the in-app inbox still holds the alert. A rule that errors does not stop the other rules.
- Latency. Event to alert within one run (15 minutes) plus delivery 1 minute: under 20 minutes.
- Screen design (my design and my estimate, not a reviewer's). A list for owner and admin only (the alerts permission), most severe and newest first, each row in plain English ("Payroll run approved by the person who created it") with the person, the time and the severity. Evidence is shown as links to the existing records, and a link appears only if the viewer can open that record. Two actions: Acknowledge, and False positive (a short note required), each stored with who and when. Filter by status and severity. An alert about a person is never shown to that person. Critical alerts also arrive as a push with the rule name only, using the notifications inbox and bell from Part A (section A5). Estimate: 3 to 4 days if the section A5 inbox exists; add the inbox itself (part of the push work) if it does not (my estimate). The reviewer includes the inbox in the phase 1 total of about 8 days without a separate figure.
- Build order. Phase 1, about 8 developer-days after the foundations that supply sign-in and export records: rules R1 to R11, the alerts table, inbox, webhook and tests. Needs RC-031 (records), RC-082 (a real scheduler on the production host, not Vercel's daily call) and RC-193 (read-only login), which stays Wave 3 in the register: the rules wait for it, so schedule RC-193 first in the AI build. Statistical anomaly detection comes later (phase 5), only after 90 days of data and a month of rules in "shadow" mode (recorded but not shown): per-user baselines using median and median absolute deviation; alert beyond 3.5 deviations and above a floor count so quiet users do not trigger on tiny numbers.
## B5. The 11 alert rules
In plain words. Each rule watches for one way a person could abuse access, using records RadCore already keeps (or will keep once RC-031 is done). Thresholds are starting values to tune with the owner in the first month after go-live; each is a settings key. Severity: Critical means tell the owner now, High same day, Medium daily digest, Low weekly.
The report gives each rule's source, threshold, data and severity. It does not give a false-positive rating. The last column is my reading of the rule wording, for the owner's planning, and is not a measured figure.
| Rule | What it watches (earlier audit id) | Starting threshold | Data it reads | Severity | False-positive risk (my reading) |
| R1 Self-approval | The same user created and decided: a stock adjustment; a payroll run created and approved or paid; a leave request decided by its own employee user; a PO sent and approved by one user; a reopen requested and approved by two accounts one person controls; a salary advance to the employee linked to the actor | Any single occurrence | Stock adjustments, payroll runs, leave requests, fiscal closes, audit log, employee-to-user link | High; Critical for payroll or reopen | Low to medium. A small shop's owner may legitimately hold two roles, so agree exceptions with the owner first |
| R2 Back-dated entries | A journal entry, bill, invoice or salary revision dated earlier than its creation | More than 7 days = Medium; more than 30 days, a manual journal into a prior month, or into a month whose GSTR-1/3B is not yet filed = High; an attempt into a filed month (blocked, 409) = Medium | Journal entry date against created date, bill date, invoices, salary revisions, audit rows | Medium to High | Medium. Accounts staff legitimately key in late bills at month end |
| R3 Period-lock moves | Lock date moved earlier; any year reopen request or reopen; any GST "unfile" | Any occurrence | Audit rows for the lock setting (before and after values), fiscal-year actions, GST filing deletions. The temporary internal move inside the locked-period helper writes no audit row and is ignored | Critical | Low. Rare events, but a legitimate year-end reopen will fire (intended) |
| R4 Large write-offs | Stock loss, scrapped units, credit notes or payment cancellations above a limit; or one user's rolling 30-day total above 3 times the shop's median per-user total (after 60 days of history). There is no bad-debt write-off in the code | Single item 10,000 rupees or more = High; loss of 0.5% of closing stock value in a month = High; rolling-total rule = Medium | Stock adjustments and their journal lines, unit events (written off), credit notes, payment cancellations, audit | Medium to High | Medium to high. A genuine large scrap fires it; the rolling rule is noisy before 60 days of history |
| R5 Price overrides | Per user: price, credit-limit and overdue overrides; an override more than 20% below cost or beyond the user's discount limit by more than 10 points; an override approved by its own creator; an online-import order priced below cost | 3 or more overrides by one user in 7 days = Medium; any below cost by more than 20% = High; self-approved = High | Audit log (override rows and lines), sales orders, item purchase cost (read through the cost-visibility view, not by the AI) | Medium to High | Medium. Festival-season discounting looks the same until the thresholds are tuned |
| R6 Mass exports | More than 500 rows of leads, parties or employees in one file; 3 or more exports in an hour; any contact export outside 08:00 to 21:00 IST; one session paging the lead or party list more than 20 times in 10 minutes; opening more than 100 distinct customer records in an hour | As stated | New export audit rows (RC-031), the data-protection access log, the request log | High; Critical if the user also signed in from a new device (R8) the same day | Medium. Month-end exports by accounts and campaign list pulls by marketing look similar |
| R7 After-hours sign-ins | A sign-in outside the role's normal window (default 07:00 to 22:00 IST, Monday to Saturday for office roles; per-role setting), especially admin, accounts, HR and owner; or a sign-in followed within 30 minutes by an export, a payroll read, a permission change or a period-lock change | One = Low; admin, accounts, HR or owner = Medium; followed by a sensitive action = High | New sign-in records (RC-031) | Low to High | High. Owners and accountants work late on filing days; needs per-role windows |
| R8 New device | A successful sign-in from a device cookie and /24 address range not used by that user in 90 days | First time = Medium for office roles; High for owner, admin, accounts, HR; High if followed by a password or permission change within 24 hours | New sign-in records; needs the proxy setting right (RC-031 and the earlier AUTH-2), or the address can be forged | Medium to High | High at first (new phones, shared counter PCs, mobile networks change addresses); falls after the 90-day baseline |
| R9 Permission and user changes | Any permission update, user created, role changed, or another user's password reset | Any occurrence | Audit log | High; Critical if the target role is owner or admin | Low. Rare, and every one is worth a look |
| R10 Failed-login bursts | 5 or more failures for one identifier in 10 minutes, or one device failing across 3 or more identifiers | As stated | New sign-in records | Medium | Medium. A forgotten password on a Monday morning or a shared counter keyboard |
| R11 Pay change then pay-out | An employee's bank account or salary changed, then a payroll run paid within 7 days | Any occurrence | Audit log on employees, payroll runs | High | Medium. Legitimate appraisal-season revisions will fire; the alert is a prompt to check who approved |

Rule-specific dependencies: R1 to R5, R9, R11 read only records that exist today. R6, R7, R8 and R10 cannot be computed until RC-031 records sign-ins, devices and exports, which must start before go-live because history cannot be back-filled.
## B6. Costs, in one place
All prices are Anthropic's list prices in US dollars per million tokens, fetched from its pricing page on 28 October 2026 (Haiku 4.5: $1 in, $5 out; Sonnet 5: $2 in, $10 out, $0.20 cached input). Prices on Amazon Bedrock India were not checked and may differ: get a quote. Token counts are assumptions for this design and must be measured on the golden sets. Rupee figures assume 90 rupees to the dollar, for illustration only. I rechecked the reviewer's arithmetic: the bill, question, assistant and alert figures reproduce. The scan figure is the reviewer's $12.70, with my recompute of $12.10 beside it (the one differing assumption is explained in "Decisions taken", item 6).
| Feature | Model tier | Assumed tokens per use | Cost per 1,000 uses | Latency budget (p95) |
| Bill reading, digital PDF | Small, 20% retried on strong | 3,500 in, 700 out (plus 4,500 in, 900 out on 20%) | about $10.60 (about 950 rupees) | 25 s, asynchronous |
| Bill reading, scan (phase 5) | Small, 20% strong | about 5,000 in, 700 out | about $12.70 (reviewer); $12.10 (my recompute) | 30 s, asynchronous |
| Plain-English questions | Small router, strong main | 18,000 in over 3 turns, 1,200 out | about $40 to $50 | 15 s whole answer, first text 3 s |
| Technician assistant | Small for lookups, strong for diagnosis | 8,000 to 12,000 in, 400 to 600 out | about $10 to $30, about $16 mixed | 8 s, first text 3 s |
| Unusual-activity alerts | Rules (none); small to explain | 1,500 in, 250 out | $0 for rules; about $2.75 per 1,000 explanations | under 20 minutes event to alert |

At the assumed volumes (400 bills, 1,950 questions, 1,560 assistant uses a month, with about 15 users) the total is about $110 to $130 a month. The report's advice is to set the spend cap at about double that for the first quarter (my arithmetic: about $220 to $260 a month). The volumes are guesses for cost only.
## B7. Build order for the AI features
| Phase | What | Needs first | Effort (developer-days) | Why in this order |
| 0 | Foundations (section B2): leaks fixed 2; telemetry 2; ai_read scope, executor skeleton, registry and tests 3; ai_events, redactor, budget and rate limit 3; queue 2; read-only login and logging with request ids 2; idempotency fix 0.5 | RC-014, RC-040, RC-042, RC-003 and the other security-wave fixes done | about 14.5 | Everything rests on it. Telemetry must be recording before go-live |
| 1 | Unusual-activity rules R1 to R11, inbox, webhook | Phase 0 telemetry, queue, read-only login | about 8 | No model, no provider contract, no new risk; protects the first weeks of real money |
| 2 | Bill reading, digital PDFs, draft only | Phase 0, RC-172 draft table, RC-014 and RC-056, provider contract and India region, 200-bill golden set | about 14, plus about 3 days of the accounts team for the golden set | Biggest daily time saving; strongest safety story |
| 3 | Plain-English questions, read-only tools | Phase 0, RC-042 done, the permission red-team set | about 12 | Reuses the executor; risk is leaks, which Phase 0 closes |
| 4 | Technician assistant: 4a summary and warranty; 4b similar jobs | Phase 3 executor; 3 months of job-card data for 4b | about 10 | Needs history that does not exist at go-live |
| 5 | Scan and photo bills; report specs; statistical alerts and explainer; second-person confirm for large drafts; photos and manuals | Phases 2 to 4 stable; counsel's view on unredactable images | about 15 | Higher risk, higher effort, smaller extra value |

Total about 74 developer-days across all phases; Phases 0 to 3 about 49. One developer who knows the codebase; the work of fixing the audit findings that Phase 0 depends on is excluded.
What to tell the owner (from the report). Start with Phases 0 and 1 now (they are also safety work). Sign the provider terms in parallel. Collect the 200 bills for Phase 2 while Phase 0 is built. Do not buy a chat product that connects straight to the database.
## B8. Decisions for the owner
- Vendor and region. Which provider and which India region. The only India-resident option found is Claude on Amazon Bedrock through the Mumbai and Hyderabad profile; Google Vertex asia-south1 and Anthropic's direct API are not confirmed India-resident. Read the AWS post and model card, and get the processing terms in writing: region, no training on inputs, retention (zero or 30 days), sub-processors, breach-notice time, deletion on exit. Also decide whether you accept that some models may involve human review if safety classifiers flag content. This depends on where RadCore itself is hosted (RC-015, RC-018).
- Human-in-the-loop policy. Confirm the rule "nothing posts automatically, at any phase". Decide whether drafts above the purchase-order approval limit need a second person with po:approve to confirm before Save is enabled. Confirm that alerts never block or suspend a user on their own.
- Budget cap. A monthly spend cap (the report suggests about double the assumed $110 to $130 for the first quarter) and per-user limits (the example: 20 questions an hour, 60 a day, 30 bill reads a day). Decide what happens at the cap: the feature turns off and you are alerted.
- Whose records people see. Should a salesperson see only their own leads and a technician only their own jobs? Today everyone with the role sees everything, and the AI would make browsing it effortless (RC-041).
- Pay and HR questions. The report refuses questions about a named person's pay in phases 1 to 3 and excludes payroll and HR tools. Decide whether and when to widen that.
- Scanned and photographed bills. They cannot be redacted before sending. Decide with counsel whether they may go to the model at all (phase 5).
- GSTIN as public. Confirm with counsel that a supplier's GSTIN (which embeds its PAN) may be sent to the model.
- Notice and legal basis. Approve updated privacy-notice wording that says customer and supplier data may be processed by an AI service, and a processor register (RC-195, RC-032). Counsel or the CA should confirm the wording; the DPDP dates in this document are unverified.
- Prompt retention. Keep redacted prompt text for 90 days (the report's default), then keep only hashes?
- Alert handling. Who reads alerts (owner and admin, each covering the other's own activity), the normal working window per role (R7), and who tunes thresholds in the first month after go-live.
- Evidence for the accuracy bar. Release 12 months of supplier bills (bank details redacted) and about 3 days of the accounts team's time for the 200-bill golden set. Accept or change the bar: at least 70% of drafts needing no edit in phase 2, 85% after three months, and zero silent wrong money.
- Product choice. Confirm you will not buy a ready-made chat product that connects straight to the database.
# Part C: One combined sequence
In plain words. Read the table from top to bottom. The three windows are the fix plan's waves: Wave 1 is before any real data goes into RadCore, Wave 2 is before go-live (before Vyapar is switched off), Wave 3 is the first three months after. "Starts when" says what must be finished first, so you can see the earliest each step can begin. Steps in the same window with no dependency between them can run side by side.
Two rules drive the order. First, the safe path before the new path: the duplicate-save fixes, tests and server plumbing come before offline and push. Second, foundations before AI: the leaks, the sign-in and export records and the queue come before any model sees a byte.
| # | Window | Step | Starts when | Effort (days) | Register items | Owner or expert input |
| 1 | Wave 1 | Decisions with no code: AI vendor and region, human-in-the-loop policy, budget cap (B8); offline invoice numbering (A or B), which phones are in use, whether the business WhatsApp number is connected (A4) | Now | None | RC-015, RC-018 (hosting and region) | Owner; CA for numbering |
| 2 | Wave 1 | Paperwork: sign the AI provider terms; notice wording with counsel; start collecting the 200-bill golden set (bank details redacted) | Now, in parallel with everything | About 3 days of the accounts team | RC-195, RC-032 | Owner, counsel, accounts team |
| 3 | Wave 1 | Data-safety fixes that Part B inherits: database roles, masking and the access log, the party-detail and lead-lookup leaks, lead scoping, scrubbed error alerts, sign-in and export records, consent, credit on unregistered suppliers, erasure, India region | Per the fix plan | RC-003 2, RC-040 2.5, RC-042 2, RC-041 3.5, RC-007 1.5, RC-031 4, RC-032 4, RC-014 5, RC-011 6, RC-018 1.25 | Same | Owner decision on RC-041; CA on RC-014 |
| 4 | Wave 1 | Front-end halves inside Wave 1 items: mask salary and bank numbers in the payroll list with a reveal that is logged; privacy notice and captcha reset on the public enquiry form | With row 3's items | Inside RC-043 (3.5) and RC-032 | RC-043, RC-032 | Counsel for notice wording |
| 5 | Wave 1 or 2 | A-1 Test harness | RC-005 (working CI) done | 3 (report); RC-150 is 7 | RC-150 | None |
| 6 | Wave 2 | A-0 Mend live defects (retry key, signed-out dialog, Show more, exports, login redirect, error screens, quick-bill quick wins) | RC-132 for the key work; RC-158 and RC-007 for error reporting; A-1 for the proofs | 3 (report); RC-133 3, RC-147 0.25, RC-097 0.25, RC-086 5, RC-159 0.75 | RC-133, RC-147, RC-097, RC-086, RC-159 | None |
| 7 | Wave 2 | A-12 Hardening and invoice completeness: headers, e-invoice card, reverse-charge line, 50,000-rupee buyer details | None (headers: RC-048) | 3 (report); RC-146 1.5, RC-116 1.5, RC-113 2 | RC-146, RC-116, RC-113 | CA on the 50,000 trigger |
| 8 | Wave 2 | Other front-end Wave 2 fixes: attendance wipe, made-up cancel reasons, arrow-key dropdowns, offline banner and draft autosave, role dead ends, import encoding, thermal paper presets | Per item (RC-148 after RC-086; RC-134 after RC-133) | RC-105 0.5, RC-134 1, RC-148 0.5, RC-149 1, RC-151 1.5, RC-117 3, RC-152 1 | Same | None |
| 9 | Wave 2 | Server plumbing both parts rely on: body-bound retry keys, job runner and queue (add a one-minute tick for the notification dispatcher), request-id logging, monitoring, webhook retry, shared rate-limit store, permission reload, bill-versus-order matching, repeat-enquiry alert, leaver's sign-in off | Per the fix plan | RC-132 4.5, RC-082 7, RC-077 2.5, RC-083 4, RC-084 4.5, RC-088 2, RC-095 1.25, RC-056 4.5, RC-142 1.5, RC-092 0.5 | Same | None |
| 10 | Wave 3 | A-2 Shared data layer | A-1 | 5 (RC-188); plus 1 for the session read (RC-214) | RC-188, RC-214 | None |
| 11 | Wave 3 | A-5 Server prerequisites (search endpoints, catalogue delta, client_ref, sync endpoint, notification tables and dispatcher) | A-1; RC-132, RC-082 | 6 to 8 | Pieces in RC-086, RC-132, RC-082; rest not in register | None |
| 12 | Wave 3 | A-3 Shared schemas and form library | A-2; RC-150 | 8 to 12 (RC-186, 10) | RC-186 | None |
| 13 | Wave 3 | A-4 Building blocks, tokens, accessibility, combobox | A-2, A-3 | 10 to 15 (RC-187 12, RC-189 3) | RC-187, RC-189 | None |
| 14 | Wave 3 (first item of the AI build) | RC-193 read-only database login, then B Phase 1: unusual-activity rules R1 to R11. RC-193 stays Wave 3 in the register; the alert rules and any AI read access wait for it | RC-031 (records), RC-082 (scheduler), RC-193 | RC-193 1; rules about 8 | RC-031, RC-082, RC-193 | Owner: who reads alerts, working windows per role |
| 15 | Wave 3 | B Phase 0 AI-only parts: gateway, ai_events, redactor, executor and registry, per-user limits and spend cap, outsider-text tag | Rows 3, 9 and 14; RC-171 after RC-042 | About 14.5 in the report's Phase 0 (part is in rows 3 and 9) | RC-171 1, RC-173 1.5, RC-194 1, RC-195 1 | Provider and region decision (row 1) |
| 16 | Wave 3 | A-6 Counter v2: bill screen, hold and recall, one-tap print, party ledger card, day close, PDF | A-4, A-5; RC-133, RC-113, RC-116, RC-151 | 10 to 14 (RC-190 7; PDF 3 to 4 not in register) | RC-190, RC-152 | Printer trial on the shop's actual printer |
| 17 | Wave 3 | B Phase 2: bill reading (digital PDFs, draft only) | Row 15; RC-172 draft table; RC-014 and RC-056 done (RC-196); golden set ready; provider contract signed; A-3 form library for the pre-filled form (my note) | About 14, plus 2 for the golden set | RC-172 2, RC-196 0.25 | Accounts team; owner sign-off on accuracy bar |
| 18 | Wave 3 | A-7 Service worker and read-only offline catalogue | A-5, A-6 | 5 | Part of RC-185 | None |
| 19 | Wave 3 | A-9 Push alerts (P1 to P4) | A-5, A-7; RC-097, RC-082, RC-084, RC-092 | 7 to 10 (RC-185 6.5) | RC-185 | Phones tried before promises (iPhone needs Home Screen install) |
| 20 | Wave 3 | A-8 Offline sale outbox (S2 to S4, then S5) | A-7; decision on numbering; RC-016, RC-039, RC-113, RC-132 | 12 to 15 | Not in register (RC-149 says not costed) | Owner and CA decisions (A4 list); till PIN policy |
| 21 | Wave 3 | B Phase 3: plain-English questions | Row 15; RC-042 and RC-040 done; red-team set | About 12 | RC-171 | Owner decision on whose records (RC-041) |
| 22 | Wave 3 | A-10 Lead inbox and WhatsApp template picker | A-4; A-9 for instant arrival; RC-041, RC-142, RC-068, RC-032; RC-184 is a prerequisite for sending templates from RadCore (without it the picker only fills a manual wa.me message) | 6 to 8 (RC-184 5) | RC-184 | Business WhatsApp number and Meta template approval |
| 23 | Wave 3 | A-11 Hindi and bilingual | A-6 | 4 to 6 (RC-217 5) | RC-217 | Translator or reviewer |
| 24 | Wave 3 | B Phase 4a: technician assistant (summary and warranty) | Row 21's executor | About 6 | RC-042 | Service manager (synthetic jobs until history exists) |
| 25 | Wave 3, month 3 or later | B Phase 4b: similar jobs and the fault-code button | 3 months of closed job cards | About 4 | None | Service manager |
| 26 | After Wave 3 | B Phase 5: scan and photo bills, report specs, statistical alerts and explainer, second-person confirm | Phases 2 to 4 stable | About 15 | None | Counsel (unredactable images) |

### Reading the table
- What can start before any code is written: rows 1 and 2. The AI provider terms and the golden set take weeks of other people's time, so start them first.
- What cannot start early however much capacity you have: B Phase 2 and 3 (they wait for the Wave 1 leak fixes and the Wave 2 queue), A-8 (waits for the service worker, the owner and CA decision, and the sync endpoint) and A-9 (waits for the dispatcher and webhook retry).
- Two developers. The front-end report suggests one on A-2 to A-4 and A-6, one on A-5 and A-7 to A-9, about 10 to 14 calendar weeks for Part A. Part B is about 74 developer-days for one developer (Phases 0 to 3 about 49); the reports give no calendar for it. The reports do not say whether the same two developers also build Part B; if they do, add Part B's days to the calendar.
- Totals not in the register. The register's Front end theme is 68.1 days and its AI readiness theme is 9.75 days. Neither contains the full builds here: the offline outbox, the server prerequisites, the lead inbox, the PDF, the AI platform, the alert rules, bill reading, questions or the assistant. Do not read the register's 548.75 days as covering this document.
- Everything is a plan from a code read. Nothing has been built or run. The first estimate that can be trusted is the one a developer gives after building A-0 and A-1.
# Decisions taken
In plain words. These decisions were taken after the first draft and are built into the sections above. They replace the earlier list of open gaps. Where a number is mine rather than a reviewer's, it says so.
## 1. The AI screens (chat panel, draft-bill form, alert inbox)
Each is now designed under its feature (sections B4.1 to B4.4). The effort ranges are my estimates, not a reviewer's. The AI report names these screens inside its phase totals (the pre-filled form in phase 2a, the chat panel in phase 3a, the inbox in phase 1) but gives no separate figure, so treat my ranges as each screen's share of those totals and add to a phase only if the screen proves larger.
| Screen | Needs | Estimate (my estimate) |
| Draft-bill form: PDF beside a pre-filled bill form, evidence, flags, "Draft, not posted" | A-3 form library, A-4 combobox, RC-172 draft table | 6 to 9 days |
| Chat panel: step progress, verified figures table, "unavailable" state | A-4 building blocks, the phase 3 executor | 4 to 6 days |
| Alert inbox: acknowledge, false positive, evidence links | Notifications inbox and bell (section A5), RC-031, RC-193 | 3 to 4 days (more if the section A5 inbox does not exist yet) |
| Technician Assist panel | The phase 3 executor, RC-042 | 2 to 3 days |

## 2. RC-193 (read-only database login)
RC-193 stays Wave 3 in the register. The alert rules and any AI read access (the tool executor, questions, the assistant) wait for it, so it is scheduled as the first item of the AI build, before the rules and before the executor (Part C, row 14). The earlier suggestion to pull it into Wave 2 is withdrawn.
## 3. RC-082 and the one-minute tick
Web push needs a one-minute tick for time-critical alerts (new lead, bill needing review). This is now in RC-082's register note. Digests and the 15-minute alert rules can use the slower tick.
## 4. Idempotency retention is a setting per route class
| Route class | Who makes the key | Tied to what was sent | Kept |
| Normal screens | The browser, one per save | Yes | Short-lived: 48 hours |
| Offline outbox (the sync endpoint) | The device, when the bill is queued; fixed for life | Yes | 30 days |
| AI routes (/api/ai/*) | None; excluded from the guard. Drafts are de-duplicated by file hash; posting a draft uses the key bill-draft-<id> on the normal bill route | Not applicable | Not applicable |

RC-132 must not shorten the offline class (the register note says so). The choice is made per route class in settings, not in code.
## 5. WhatsApp template sending depends on RC-184
Wherever the lead inbox assumes templates can be sent from RadCore (A-10, Part C row 22, the push fallback in section A5), RC-184 is a prerequisite: approved-template sending, a message log and delivery status. Without it the template picker only fills a manual wa.me message that the person sends from their own phone. RC-068 (STOP handling) and RC-032 (consent) must come before any automatic send.
## 6. Scan-bill cost: the reviewer's $12.70 and my $12.10
Headline figure: about $12.70 per 1,000 scanned bills (reviewer), with $12.10 (my recompute) beside it. Both use the same prices (small tier $1 in and $5 out per million; strong tier $2 in and $10 out), the same first read (about 5,000 input and 700 output tokens, $8.50 per 1,000) and the same 20% second-read rate. The assumption that differs is the size of the second read on a scan. I kept the text-bill second read (4,500 in, 900 out, $3.60 per 1,000), giving $12.10. The reviewer's figure implies a second read about $0.60 per 1,000 dearer, which fits a larger scan second read of roughly 6,000 input tokens (my inference; the report does not state it). Measure it on the real scan set in phase 5.
## 7. Planned builds not in the register
These are planned builds, not defects, so the register does not carry them. The fix-plan writer can include them. Effort is developer-days from the reviewers unless marked as mine.
| Build | Effort (days) | Prerequisites (RC ids) |
| A-5 Server prerequisites: item and party search, catalogue delta, client_ref, sync endpoint, offline flags, notification tables and dispatcher | 6 to 8 | RC-082, RC-132, RC-086, RC-005 |
| A-6 extras beyond RC-190 and RC-152: hold and recall, party ledger card, day close, server-side PDF. The reviewer's bundle is 10 to 14 days; the register carries 8 (RC-190 7, RC-152 1); the PDF alone is 3 to 4 | About 2 to 6 beyond the register (my arithmetic) | RC-148, RC-133, RC-042, RC-151, RC-113, RC-116 |
| A-7 Service worker and read-only offline catalogue | 5 | A-5, A-6, RC-146, RC-149 |
| A-8 Offline sale outbox (S2 to S5) | 12 to 15 | A-7, RC-132, RC-016, RC-039, RC-113; owner and CA decision on numbering |
| A-9 Push beyond RC-185: preferences, quiet hours, digests, delivery health. The reviewer's 7 to 10 days against the register's 6.5 | About 0.5 to 3.5 beyond RC-185 (my arithmetic) | RC-082, RC-084, RC-097, RC-092, RC-142 |
| A-10 Lead inbox and WhatsApp template picker | 6 to 8 | RC-041, RC-142, RC-068, RC-032, RC-086; RC-184 for template sending |
| B Phase 0, AI-only build: gateway, ai_events, redactor, executor and registry. The reviewer's lines for these are 3 + 3 days; RC-171 and RC-194 carry 1 each | About 4 (my arithmetic) | RC-193, RC-042, RC-040, RC-171, RC-194 |
| B Phase 1 alert rules R1 to R11, tests, inbox, webhook | About 8 | RC-031, RC-082, RC-193 |
| B Phase 2 bill reading (digital PDFs, draft only), plus about 3 days of accounts-team time for the golden set | About 14 | RC-172, RC-014, RC-056, RC-196, RC-132, RC-082, RC-195; provider contract |
| B Phase 3 plain-English questions | About 12 | RC-171, RC-042, RC-040, RC-193, RC-194, RC-173 |
| B Phase 4 technician assistant (4a about 6, 4b about 4, 4b after 3 months of job cards) | About 10 | Phase 3 executor, RC-042, RC-041 |
| B Phase 5 scans, report specs, statistical alerts, second-person confirm | About 15 | Phases 2 to 4 stable |
| AI screens (section 1 above): likely already inside the phase totals above, so do not add | 15 to 22 in total (my estimate) | As in section 1 |

## 8. The alert-rule false-positive column
Kept, and labelled in B5 as my reading of the rule wording. The AI report gives thresholds and severity but no false-positive rating.
## 9. Remaining caveats (not decisions)
- Effort figures differ between reports and register by design: front-end step 0 is 3 days in the report and larger in the register (RC-133 also covers other unkeyed saves; RC-086 includes paging and the combobox); the test harness is 3 days in the report and 7 in the register (RC-150 adds the money-flow journeys); AI Phase 0 is 14.5 days in the report and 9.75 in the register's AI readiness theme (the rest sits in other themes).
- Marked "to confirm" in the front-end report: Android and iPhone notification behaviour, clipping on a 58 mm printer, screen-reader behaviour on the phone table layout, live security headers.
- Need the CA: the 50,000-rupee trigger, the e-invoicing threshold, provisional bills. Unverified: the DPDP dates, the AWS India profile, Bedrock India prices, provider retention terms.