# RadCore v2 plan

5 November 2026 · coordinator · **approved by Sarthak on 5 Nov 2026.** Decisions recorded: **N1** Drizzle ORM; **N2** module-wise libraries (lib-common plus one library per module) and proven npm libraries instead of hand-written code; **N3** `radcore-erp` made private (done 5 Nov); **N4** v2 only in `radcore-erp` on `dev`, with v1 on `erp/main` as read-only reference.

**Sources read:** *RadCore application plan* (PDF, 4 Nov); 02 Technical report; 02b Restricted security appendix (handling rules only, see §1); 03 Fix plan (register RC-001 to RC-222); 05 Hosting recommendation; 06 Front-end and AI design notes; 07 Go-live checklist (GL-001 to GL-248); 08 Handover call pack (decisions D-01 to D-23); 10 Questions for the CA and counsel. The v1 documents on `erp/main` (`docs/`) are used as the description of behaviour, not as code to copy.

## 1. What changes from the first plan

| You asked | How the plan does it |
|---|---|
| Start again on `dev`, because v1 had many bugs | `dev` starts empty. Every one of the 222 register items, which are v1's bugs, becomes an **acceptance criterion** on the v2 ticket that builds that part. That ticket must prove v2 doesn't have the bug, using the register's own proof rewritten as a v2 test. The bugs get designed out instead of fixed later. |
| Less code: put the functions in a library | **`packages/core`** holds every business rule and calculation: money, GST, dates, IDs, payroll maths, posting rules, schemas. The API and the web app both call it. **Routes are declared as data** (`defineRoute`: permission, input schema, service), so one generic handler does sign-in, checks, transaction, audit and saved-once for all of them. **Proven npm libraries** replace v1's hand-written parsers, crypto, job loop and UI widgets (ADR-003). M1 is mostly these shared pieces, so the modules after it stay small. |
| A good backend with an ORM, not raw SQL | **ADR-002**: every query goes through the ORM or a repository function. SQL is allowed only in migrations and named database views (the ledger's triggers and CHECKs need it there). A lint rule fails any PR with SQL strings elsewhere. My pick of ORM is in decision N1. |
| Notes on tickets to track changes | Every ticket has a **Notes (change log)** section. Each session adds a dated line when it starts, opens a PR, gets a verdict, changes approach, or merges, and I keep it current. Technical detail goes in the collapsible *Agent notes* section. Discussion goes in comments. |
| Check every connection | §2. |

**Restricted appendix:** its exploit steps never go into Linear, a PR, or git. Tickets refer to it only by RC number.

## 2. Connections checked today

| What | Result |
|---|---|
| The five sessions | All replied: architect, backend, ui, auditor, e2e-playwright. backend and ui worktrees sit on the empty `dev` commit `e19d0e6`, which is right for a fresh start. |
| Linear | Connected as jainsarthak0205 (admin). Workspace **Radboards-ERP**, team **RAD**, statuses Backlog → Todo → In Progress → In Review → Done. No projects yet; only the 3 default labels. Ready. |
| GitHub sign-in | `gh` is signed in as **sarthakradboards-hash**, admin on `radcore-erp`. |
| ⚠ `radcore-erp` visibility | **Public.** The register calls this Serious (RC-006). The technical report and fix plan describe live weak points, so nothing from these documents goes into the repo until it is private (decision N3). |
| ⚠ Branch protection | None on `dev` or `main`: anyone with access can push straight in (RC-051). Fixed in M0-01. |
| CI on `dev` | None. v1's `ci.yml` is only on `main`. Built fresh in M0-08. |
| ⚠ Commit identity | Commits here are recorded under a personal email address (blanked from this copy, RAD-18). v1's notes say Vercel blocked deploys for exactly this, because the owning account is sarthakradboards-hash. M0-01 sets a repo-level identity. |
| `radboards` remote | A private, separate Service Desk repo. The same empty `dev` commit was pushed there too. This plan doesn't use it (decision N4). |
| v1 review copy | https://radcore-erp.vercel.app is live in Singapore (v1, sample data). It can stay as a demo; M8-09 retires it before real data (RC-018). |
| Not checkable yet | AWS (no account yet), Meta, WhatsApp, Shopify and the statements mailbox (never connected in v1). |

## 3. Milestone order

```
M0 Foundations ─► M1 Platform ─► M2 Masters & ledgers ─┬─► M3 Selling ──┬─► M5 Accounts & GST ─┐
                                                       └─► M4 Buying ───┤   M6 People/ops/svc ──┼─► M8 gates ─► go-live ─► M9
                       M8-01..07 hosting (devops, from end of M1) ──────┴─► M7 Integrations ────┘
```

- M3 and M4 run side by side. So do M5, M6 and M7. Each pair or trio opens together when the one before is nearly done.
- The hosting tickets M8-01 to M8-07 start right after M1 in their own session, so staging exists for e2e and the gates aren't waiting on infrastructure.
- **Real data** (users, a real Vyapar file) enters only after Gate 0 (M8-20 to M8-22) passes, as the checklist requires (GL-228).
- M9 is a menu: none of it opens without your yes.

## 4. Decisions you need to make, by milestone

**Before M0** (new, from today's direction):

| # | Decision | My recommendation |
|---|---|---|
| N1 | Which ORM | **Drizzle ORM** used as an ORM (typed queries and relations, no SQL strings). The ledger needs CHECKs, views, partitioned tables and append-only triggers, which Drizzle's schema expresses natively. Prisma is the alternative: a nicer API for relations, but it would push those rules into hand-written migration SQL and needs its own typed-SQL feature for the reports. If your senior prefers Prisma, the plan doesn't change, only ADR-002. |
| N2 | What "library" means | Confirm: (a) one shared `packages/core` for all business functions, **and** (b) proven npm libraries instead of hand-written code. |
| N3 | Make `radcore-erp` private | Yes, now. You can run `gh repo edit sarthakradboards-hash/radcore-erp --visibility private --accept-visibility-change-consequences`, or tell me to and I'll run it. |
| N4 | Scope of the repos | v2 lives only in `radcore-erp` on `dev`. The Service Desk repo stays separate (its job cards are rebuilt as the Service section). v1 on `erp/main` is read-only reference. |

**Owner decisions already in the handover pack** (D-xx), placed where they block:

| Before | Decisions |
|---|---|
| M1 | **D-01** hosting (default: Mumbai hybrid); **D-19** who needs a second sign-in factor (default: every money, payroll or permissions role); **D-20** who sees salaries and bank numbers |
| M2 | **D-02** one company or several (default: one); **D-10** foreign currency and imports in v1 (default: in, if there are regular imports); **D-15** batch tracking (default: traceability only) |
| M3 | **D-11** who sees all leads (default: own and unowned; managers all); **D-21** small business rules (bill-vs-PO tolerance 2%, payslip link life, Shopify edits); **D-09** counsel engaged for the privacy notice |
| M5 | **D-08** CA engaged; the first CA answers on turnover (CA-01), filing frequency (CA-03) and unregistered-supplier credit (CA-04); **D-03** e-invoice in scope; **D-06** second approver; **D-16** cut-over date and unpaid invoices one by one |
| M6 | **D-13** payroll statutory layer: build or buy (default: buy); **D-14** payroll and leave policy (after the labour adviser); **D-12** how long to keep personal data |
| M7 | The business WhatsApp number on the Cloud API (and the coexistence choice); Meta app; Shopify access |
| M8 | AWS account (hosting rec D11), domain (D6), backup retention (D4); **D-17** data leaving India; **D-18** on-call and acceptable loss; the user list; the Vyapar exports |
| M9 | **D-04** AI; **D-22** offline counter rules |

**No longer apply after the restart:** D-23 (accept the review branch), and the wave budgets in D-05 and D-07. Those were priced for fixing v1. I'll re-estimate from real pace after M1.

## 5. Sessions: do we need more?

The work is **197 tickets: 126 backend, 29 ui, 26 architect, 16 e2e**. One backend session is the bottleneck.

| When | Add | Why |
|---|---|---|
| Start of M1 | **backend-2** | M1 has 31 independent library tickets in separate files. |
| End of M1 | **devops** | Runs M8-01 to M8-07 (AWS, images, backups, monitoring) alongside the build. |
| Start of M3 and M4 | **backend-3**, **ui-2** | Selling and buying in parallel, one backend each, with backend-1 finishing M2 tails. |
| When there are 5 or more implementers | **auditor-2** | One auditor can't review every PR from five writers without becoming the queue. |

Peak: 10 sessions. Two writers never get tickets that touch the same files.

**Ticket template** (every ticket in Linear):

```
## Goal            one sentence
## Acceptance criteria
## Covers          RC / GL / flow ids
## References      document and section
## Waits on        decision ids
## Notes (change log)
- 2026-11-05 coordinator: created.
+++ Agent notes
files, tests, proof commands (filled in by the session)
+++
```

**Coverage:** all **222/222** register items (RC-001 to RC-222), all **248/248** go-live checklist lines (GL-001 to GL-248) and all **12/12** user flows in the plan PDF each appear in exactly one ticket. §7 is the index. The D-xx decisions and the CA, counsel and labour questions are decisions and questions, not requirements. They're tracked in §4 and come to you, not to tickets.


## 6. Every ticket

Labels are worked out from the ticket: the role, `user-facing` (needs e2e-playwright PASS), `needs-decision`, `gate`, and `wave-N` (the earliest register wave among the items it covers). "Waits on" names the decision.


### M0: Foundations and guardrails (10 tickets)

Repo, CI, architecture decisions, docs in the repo. Nothing else can start before this.

| ID | Role | Ticket | Acceptance criteria | Covers | Doc reference | Waits on |
|---|---|---|---|---|---|---|
| M0-01 | architect | Repository guardrails | dev and main protected (PR only, required CI, no force-push); PR template with ticket link and auditor / e2e / coordinator boxes; branch-name check <ticket-id>-<slug>; Dependabot, secret scanning and push protection on; repo-level commit identity set. Proof: a direct push to dev is refused. | RC-006 | Fix plan W1; Tech report Theme 2 | - |
| M0-02 | architect | ADR-001 layers: module-wise libraries, thin routes | Packages: packages/lib-common (money, dates, ids, base schemas), one library per module (lib-crm, lib-sales, lib-stock, lib-purchasing, lib-accounts, lib-gst, lib-hr, lib-payroll, lib-ops, lib-service, lib-integrations) holding that module's rules, schemas and services behind a public index; packages/db (Drizzle schema per module, migrations, repositories); apps/api (routes declared as data, one generic handler); apps/web. A dependency rule in CI fails a PR with a cycle, a deep import past a library's index, rules in a route, or db imported from web. No file over 400 lines. | RC-175 | Tech report Theme 12; Design notes A2; decision N2 | - |
| M0-03 | architect | ADR-002 Drizzle ORM and data access | Drizzle ORM (decision N1); every query goes through the ORM or a repository; raw SQL only in migrations and named views; ESLint rule fails sql`` or query strings outside packages/db/migrations; ban dangerouslySetInnerHTML; host check on outside paging URLs. | RC-221 | Your senior's ORM advice; RC-221 | - |
| M0-04 | architect | ADR-003 libraries over hand-written code | Approved list for money, validation, logging, jobs, hashing, MFA, CSV/Excel, PDF, mail, UI primitives, tables, forms, tests, each with the hand-rolled v1 code it replaces. Unused-dependency and Node-version check (knip, engines) in CI. | RC-220 | Tech report Theme 4; Design notes A3; decision N2 | - |
| M0-05 | architect | ADR-004 runtime and hosting target | Long-running server plus worker on AWS Mumbai hybrid (D-01 default); files in S3; jobs in Postgres queue; no Vercel for real data. States what changes if D-01 differs. | RC-015 | Hosting rec §1, §10.2; Handover D-01 | D-01 |
| M0-06 | architect | ADR-005 database conventions | Precision for money, quantity and rates; CHECK on every numeric; index on every FK; lookup tables instead of growing enums; created/updated by and at; business date vs posted time on ledgers; append-only and monthly-partitioned logs; camelCase on the wire end to end. | - | Tech report Theme 3; ARCHITECTURE v1 §8 | - |
| M0-07 | backend | Monorepo skeleton | npm workspaces from ADR-001, TypeScript strict, ESLint rules from ADR-002/003, Vitest, dev compose with PostgreSQL 16 and MinIO bound to localhost with generated passwords, Node pinned. Proof: fresh clone, npm ci, npm run dev, npm test all pass. | RC-198 | Fix plan RC-198 | - |
| M0-08 | backend | CI pipeline | Typecheck, lint, unit, API tests on PostgreSQL 16 (same major as production), migrations up from zero, job timeouts, runner image and actions pinned by SHA, coverage report; every register proof test lives in the normal suite. Required on dev. | RC-005, RC-019, RC-071, RC-154 | Fix plan W1/W2 | - |
| M0-09 | e2e | Playwright harness in CI | Starts API and web from the repo, runs one smoke test, keeps traces on failure, axe scan step; runs on every PR that touches apps/web. | RC-150 | Design notes A1, A7 | - |
| M0-10 | architect | Source documents into docs/ | Plan, technical report, fix plan (register as a table), hosting, design notes, go-live checklist and CA questions in docs/; the restricted security appendix stays out of git; docs/register.md lists RC-001..222 with the ticket each maps to. | - | All documents | - |

### M1: Platform: the shared library, engines and app shell (40 tickets)

Everything every module reuses: money, dates, schemas, ORM conventions, auth, permissions, audit, jobs, files, imports, lists; the UI kit and data layer.

| ID | Role | Ticket | Acceptance criteria | Covers | Doc reference | Waits on |
|---|---|---|---|---|---|---|
| M1-01 | backend | Library: money and numbers | Decimal arithmetic, rounding rules, rates to 6 places, quantities by unit precision, amount in words, lakh/crore grouping; same functions used by API and web; lint bans float maths on money. | RC-008, RC-215 | Register; Design notes A1 | - |
| M1-02 | backend | Library: dates and financial year | IST today, server time, strict real-date check (no 31 Feb), FY of a date, period helpers, timezone-safe follow-up times. | RC-168, RC-204 | Register | - |
| M1-03 | backend | Library: identity formats | GSTIN checksum and state, PAN, phone normalisation, state-code lookup table, case-insensitive unique email and SKU in the database. | RC-045 | Register | - |
| M1-04 | backend | Library: shared schemas and typed client | Each route is declared once (input schema, output type, permission); the web client is typed from it; one test proves a bad GSTIN is refused by both the API and the web form from the same import. | RC-186 | Design notes A-3 | - |
| M1-05 | backend | DB: schema helpers | Column helpers for money, qty, rate with automatic CHECKs; CI check that every FK has an index; audit columns; role names unique (no store vs stores); lookup tables. | RC-024, RC-029, RC-044 | ADR-005 | - |
| M1-06 | backend | DB: three logins | Owner (migrations only), app (no UPDATE/DELETE on ledgers, no DDL), read-only; the app container never holds the owner password. Proof: app login cannot drop, alter or delete a journal line. | RC-003, RC-193 | Tech report 5.5 | - |
| M1-07 | backend | DB: migration runner | Runs once under an advisory lock, in a transaction, forward-only, as a step before the app starts; tested from zero and as an upgrade. | RC-052 | Register | - |
| M1-08 | backend | API: one generic route handler | defineRoute does sign-in, permission, schema check, one transaction with statement/lock/idle timeouts, error codes (never message matching), camelCase output without a per-row conversion layer. | RC-080, RC-199, RC-216 | ADR-001 | - |
| M1-09 | backend | API: saved-once (idempotency) library | Key bound to a hash of the body; retention per route class (48 h screens, 30 days sync); stored answers carry no tokens; clean-up job. Proof: same key with a different body is refused. | RC-132 | Design notes decision 4 | - |
| M1-10 | backend | API: config and process | Config validated at start (refuses weak secrets and missing env); graceful shutdown waits for requests and stops the worker; crashes and DB blips do not kill the process; health check touches the database. | RC-078, RC-079, RC-081 | Register | - |
| M1-11 | backend | API: logging and errors | Structured logs with request id and levels; personal data and tokens scrubbed from logs, error log and alerts; browser errors collected; alert de-duplication by route template. | RC-007, RC-077, RC-158 | Tech report 5.7 | - |
| M1-12 | backend | Audit engine in the database | Every insert, update and delete audited by trigger with the acting user; updated_at/updated_by maintained; audit and access logs append-only and partitioned by month. | RC-030, RC-046 | Tech report Theme 3 | - |
| M1-13 | backend | Security events audited | Sign-in, failed sign-in, password change, MFA change, every export and download write an audit row. | RC-031 | Register | - |
| M1-14 | backend | Sign-in and passwords | Argon2id; length and breached-password rules; first admin created without printing a password; users set their own password from an invite link (admin never knows it); lockout per account and per address in a shared store. | RC-021, RC-089, RC-090 | Security appendix E3 | - |
| M1-15 | backend | Second sign-in factor | TOTP with recovery codes, required for the roles chosen in D-19. | RC-055 | Handover D-19 | D-19 |
| M1-16 | backend | Sessions | Server-side sessions with idle and absolute expiry; a person sees and ends their sessions; admin ends anyone's; role or password change ends them. | RC-091 | Register | - |
| M1-17 | backend | Permissions enforced in services, with record scope | Checks live in the service layer, not only routes; scope hooks (own records vs all) per role; no route returns more than the role may see. | RC-042, RC-171 | AI notes B2 | - |
| M1-18 | backend | Permission admin without self-escalation | Only admin grants admin; nobody changes their own role; matrix changes take effect across processes at once and are audited. | RC-033, RC-095 | Security appendix E4 | - |
| M1-19 | backend | Permission manifest test | A declared table of route to permission, independent of the code; CI fails when a route lacks its check or the table. | RC-153 | Register | - |
| M1-20 | backend | Maker-checker library | Requester cannot approve; approver's login must predate the request; approval is of the exact version seen (hash). Used by every approval in M2 to M6. | RC-037 | Tech report Theme 6 | - |
| M1-21 | backend | Request guards | Origin required on writes; per-user and public rate limits in a shared store sized for real customers. | RC-088, RC-165, RC-194 | Register | - |
| M1-22 | backend | Personal-data masking and who-looked log | Masking applies to lists, lookups, exports and email columns for roles without pii:read; who-looked log is append-only and the app login cannot delete it. | RC-040 | Register | - |
| M1-23 | backend | Public links library | Tokens stored hashed, never copied; expiry, revocation, scope; no-index and no-store headers. | RC-047 | Register | - |
| M1-24 | backend | Secrets library | Envelope encryption with key versions and rotation; minimum key length; expiry watch for outside tokens; tokens never in URLs. | RC-213 | Register | - |
| M1-25 | backend | File store | S3 (MinIO in dev); streamed uploads; type checked by content; per-kind access; size limits; retention and deletion; private files never cached. | RC-096, RC-191 | Hosting rec D5 | - |
| M1-26 | backend | Background jobs | Postgres-backed queue in a separate worker process: retries, timeouts, overlap guard, one-minute tick, dead-letter alert. | RC-082 | Design notes A-5 | - |
| M1-27 | backend | Webhook framework | Store the raw delivery first, acknowledge fast, process from the queue with retry, replay protection, alert on stuck events. | RC-084 | Register | - |
| M1-28 | backend | File import library | CSV any delimiter and encoding, Excel; streamed with a size cap; Indian number format ('9,111.00' is 9111); strict dates with per-row errors; parsing in a worker thread with time and memory caps. | RC-117, RC-118 | Security appendix E7 | - |
| M1-29 | backend | Lists, search and export library | Paging in the database; server search with trigram index and escaped wildcards; date filters that use indexes; complete streamed exports with no silent cap; CSV cells safe against formula injection. | RC-160, RC-202, RC-203 | Register | - |
| M1-30 | backend | Settings store | Typed settings table, separate from job state and the period lock; read once per request. | RC-161 | Register | - |
| M1-31 | backend | Test helpers | Fake clock; production code paths under test (real rate limits, real hash cost setting); factories; every test runs on its own. | RC-155, RC-156, RC-222 | Register | - |
| M1-40 | ui 👁 | App shell | Session read on the server; menu built from permissions with no dead-end screens; error, loading and not-found screens that keep typed work; text through an i18n layer (English now); full-screen viewport; dark mode. | RC-151, RC-159, RC-214, RC-217, RC-219 | Design notes A1, A6 | - |
| M1-41 | ui 👁 | Design tokens and accessibility | Light and dark tokens with a contrast test; labels, focus, live 'Saved' messages; axe shows zero serious issues. | RC-189 | Design notes A6 | - |
| M1-42 | ui 👁 | Data layer | TanStack Query behind one hook; debounced search, cancels stale requests, bounded cache; bell, session and permissions refresh each minute; retry key reset only on success; offline banner and draft autosave. | RC-133, RC-149, RC-188 | Design notes A-2 | - |
| M1-43 | ui 👁 | UI kit: forms and dialogs | Radix dialogs/menus; forms on React Hook Form with the shared schemas and field errors; one reason dialog for every cancel or reverse. | RC-134, RC-187 | Design notes A-4 | - |
| M1-44 | ui 👁 | UI kit: tables and pickers | Server-paged, sortable table; combobox with server search (finds party 2,050 of 2,100); selects never act on arrow keys; saved board/list choice applied before first draw. | RC-086, RC-148, RC-218 | Design notes A-4 | - |
| M1-45 | ui 👁 | Sign-in screens | Sign-in, MFA, invite and change password, sessions page; signed-out dialog cannot be dismissed and keeps typed work; redirect only to own site. | RC-097, RC-147 | Design notes A-0 | - |
| M1-46 | ui 👁 | Web security headers | CSP and security headers on every screen; public token pages no-index and no-store; links opened with noopener. | RC-146 | Design notes A-12 | - |
| M1-47 | ui 👁 | Admin: users, roles, permissions, audit trail | Screens for M1-14 to M1-18 and the audit viewer. | - | Plan p.4-6 roles | - |
| M1-50 | e2e 👁 | Auth and permission journeys | Sign-in, MFA, lockout, signed-out recovery keeps typed work, unsafe redirect refused, a revoked permission hides its button on another tab within a minute. | - | Design notes A7 | - |

### M2: Masters and ledgers (17 tickets)

Company, items, parties, tax rates, price lists; the journal, numbering, stock and serial-unit engines, and the books check.

| ID | Role | Ticket | Acceptance criteria | Covers | Doc reference | Waits on |
|---|---|---|---|---|---|---|
| M2-01 | architect | Ledger and posting design | Chart of accounts; posting table for every document (from v1 ARCHITECTURE §6 and the register); valuation rules; unit model (whose, what condition, promised to whom); hand-worked figures for each. | - | v1 ARCHITECTURE §6; Tech report Theme 11 | - |
| M2-02 | backend | Company profile and single-entity fence | One legal entity (D-02 default); a second cannot be created; no invoice until the company GSTIN, address and state are set (no silent Maharashtra). | RC-010, RC-112 | Handover D-02 | D-02 |
| M2-03 | backend | Journal engine | Post and reverse only; debits equal credits at commit; journal lines and posted documents append-only in the database (bills, payments, expenses, payslips included); lock checked under lock; gap-free journal numbers; manual journals cannot touch GST, TDS, GRNI or payroll accounts. | RC-004, RC-093, RC-206 | Tech report 5.6 | - |
| M2-04 | backend | Numbering engine | Gap-free per series and year under a row lock; one query per number; series config cached. | RC-200 | Register | - |
| M2-05 | backend | Stock engine | In, out and transfer with a business date; moving average excludes rejected, job-work and demo stock; negative-stock mode leaves no phantom value; one documented lock order and a concurrency test on PostgreSQL. | RC-025, RC-053, RC-062, RC-205 | Register | - |
| M2-06 | backend | Units by serial | Database stops a unit being on a shelf twice; whose / condition / promised kept apart; append-only unit events; every path goes through the units engine. | RC-026, RC-027 | Register | - |
| M2-07 | backend | Books integrity check | One consistent snapshot comparing stock ledger to books by account, item and place; every journey test ends with it. | RC-063 | Register | - |
| M2-08 | backend | Mutation testing on money | Stryker on money, GST and posting functions, score at least 80%, including a non-zero round-off invoice. | RC-069 | Register | - |
| M2-09 | backend | Fault injection | A failure forced halfway through a save leaves no journal, stock or number behind. | RC-157 | Register | - |
| M2-10 | backend | Items and units of measure | Items, categories, HSN, pictures, barcode, serialised flag; quantity decimals follow the unit (no 1.5 Nos). | RC-162 | v1 PROGRESS 7.6 | - |
| M2-11 | backend | Parties | Customers, dealers, franchisees, suppliers; GSTIN, PAN, composition flag, state; credit terms only with parties:manage. | - | v1 PROGRESS 7.13 | - |
| M2-12 | backend | GST rates by date | Rates by HSN with start dates, 22 Sep 2025 change seeded; newest applicable rate wins over an older longer code. | RC-115 | Register | - |
| M2-13 | backend | Price lists with approval | Tax-inclusive or exclusive lists; rates take effect only after approval (maker-checker); discount limits per role. | - | Plan p.13 | D-21 |
| M2-14 | backend | Locations, employees master, masters workbook | Locations (store, stores, rejected, service bay, demo, franchisee, in transit); basic employee master; one workbook export that honours the cost and pay filters. | RC-164 | Plan p.7; v1 PROGRESS 7.13 | - |
| M2-15 | ui 👁 | Masters screens | Products (cards and list, product page), parties, locations, price lists with approval queue, GST rates. | - | Plan p.9 Admin | - |
| M2-16 | ui 👁 | Chart of accounts and journal screens | Accounts, manual journal with reason, journal list. | - | Plan p.8 Accounts | - |
| M2-17 | e2e 👁 | Masters journey and cost hiding | Admin creates item, party, price list; approval by another person; each role sees costs only if allowed. | - | Plan p.4-6 | - |

### M3: Selling (25 tickets)

CRM, walk-ins, quick bill, orders, invoices, credit notes, payments, vehicle bookings, print and PDF.

| ID | Role | Ticket | Acceptance criteria | Covers | Doc reference | Waits on |
|---|---|---|---|---|---|---|
| M3-01 | architect | Sales document and date rules | Order, delivery, invoice, advance and credit-note rules with the CA questions they wait on; when goods may leave before invoicing; advances and GST. | - | Register RC-111; CA questions A1-A2 | - |
| M3-02 | backend | Lead capture core | One capture path for manual, walk-in, form and webhooks; phone de-duplication under a lock; a repeat enquiry alerts the owner and sets a follow-up; outsider text kept apart from staff notes. | RC-142, RC-173 | Plan flow 2 | - |
| M3-03 | backend | Public form and lead webhooks | Website form, Google, Meta, WhatsApp inbound on the webhook framework; captcha and limits on every door; the Google key is not the campaign token. | RC-054 | Security appendix E6 | - |
| M3-04 | backend | Consent and privacy notice | Notice version and purpose stored; consent only from the person's own form or message; withdrawal recorded. | RC-032 | Register; CA questions group B | D-09 |
| M3-05 | backend | Pipeline | Stages, owner, follow-ups, follow-up plans, quick replies, lost reasons, deal value, score; who sees whose leads per D-11. | RC-041 | Plan p.8 CRM | D-11 |
| M3-06 | backend | CRM setup | Lead sources, campaign links and QR, ad spend and cost per lead, quick-reply templates audited, manual WhatsApp send limit and opt-out check; 'ignore' cannot set aside orders. | RC-211, RC-212 | Plan p.8 | - |
| M3-07 | backend | Credit and price checks library | Credit limit and overdue checked at confirm, delivery, invoice and hand-back; below-cost uses average or landed cost; discount limit per role; overrides audited. | RC-061, RC-131 | Plan flow 3 | - |
| M3-08 | backend | Quotes, orders and deliveries | Draft to confirmed, part deliveries, close short, take back delivered goods before invoicing, delivery challan; document dates bounded and in the right FY. | RC-111, RC-125 | Plan flow 3 | - |
| M3-09 | backend | Invoices | Issue from deliveries; issuer details frozen on the invoice; Rule 46 particulars; buyer details above the B2C cash limit; GST, cess, place of supply, round-off; issued invoice immutable. | RC-022, RC-113 | Plan p.2 rules | - |
| M3-10 | backend | Credit notes, cancellations and refunds | Time limit for credit notes; discount credit note; restock by serial clears the unit's sale; taking back a cancelled credit note costed right; counter cash refund; cancelling records a refund, never deletes receipts. | RC-110, RC-126, RC-128, RC-207 | Register | - |
| M3-11 | backend | Quick bill | Customer, order, invoice, stock, payment and journal in one transaction; split payments; unpaid part on credit; saves under 2 seconds. | - | Plan flow 1 | - |
| M3-12 | backend | Payments and allocation | Receipts and payments, allocation to invoices, advances, part payments, TDS held back; cash warnings at Rs 2 lakh a day and Rs 10,000 paid. | RC-114 | Plan p.10 | - |
| M3-13 | backend | Vehicle bookings, test rides, delivery checklist | Test rides on demo units; booking advance holds the unit; holds known to the stock engine; cancelling a booking resets the lead and explains the advance; checklist files validated. | RC-122, RC-127, RC-208 | Plan flow 2 | - |
| M3-14 | backend | Invoice and estimate links | On the links library: expiry, revoke, permission to create; an estimate link cannot approve work by itself. | RC-048 | Register | - |
| M3-15 | backend | To collect and party statement | Reminders with amounts and links, including balances not on a bill. | - | Plan p.8 | - |
| M3-16 | backend | Print and PDF | Server-made PDF for invoice, challan, receipt, quote; A4 and 80 mm thermal presets; no browser headers. | RC-152 | Design notes A-6 | D-21 |
| M3-20 | ui 👁 | CRM screens | Leads (mine and all), drag board, lead page timeline, quick replies, follow-ups, plans, sources, campaigns and QR, ad spend. | - | Plan p.8 | - |
| M3-21 | ui 👁 | Walk-in tablet form | Phone first, repeat-customer lookup, outcome; 'Buying now' opens the quick bill filled in. | - | Plan flow 1 | - |
| M3-22 | ui 👁 | Counter quick bill | Keyboard and scanner first, type-ahead items, customer balance, one-tap thermal print, hold and recall. | RC-190 | Design notes A-6 | - |
| M3-23 | ui 👁 | Sales screens | Quotes, orders, deliveries, invoices, credit notes in the record layout (status bar, related-record buttons, count cards). | - | v1 ARCHITECTURE §9 | - |
| M3-24 | ui 👁 | Payments and To collect screens | Receipts, payments, allocation, reminders. | - | Plan p.8 | - |
| M3-25 | ui 👁 | Vehicle booking screens | Test rides, booking, delivery checklist. | - | Plan flow 2 | - |
| M3-30 | e2e 👁 | Journey: walk-in buys at the counter | Timed under 2 minutes from phone number to printed invoice. |  Flow 1 | Plan flow 1 | - |
| M3-31 | e2e 👁 | Journey: a lead becomes a sale | Enquiry, quick reply, test ride, booking, delivery checklist, invoice with advance set off. |  Flow 2 | Plan flow 2 | - |
| M3-32 | e2e 👁 | Journey: a dealer order | Credit stop and override, part delivery, IGST invoice, payment over two invoices. |  Flow 3 | Plan flow 3 | - |

### M4: Buying and stock (14 tickets)

Purchase orders, inward and QC, bills with matching, returns, transfers and counts, job work, imports, currency. Runs beside M3.

| ID | Role | Ticket | Acceptance criteria | Covers | Doc reference | Waits on |
|---|---|---|---|---|---|---|
| M4-01 | backend | Purchase orders | Approval above the role's limit (maker-checker); foreign supplier treated as import. | - | Plan flow 5 | - |
| M4-02 | backend | Goods receipt and QC | Accepted and rejected split; serials at QC (a sold serial cannot be received); batches per D-15. | RC-028 | Plan flow 5 | D-15 |
| M4-03 | backend | Purchase bills | Draft state with the bill file attached; supplier invoice number, date and GSTIN; duplicate check both ways; bill held against PO and receipt with tolerance; price difference handled. | RC-023, RC-056, RC-172 | Register | D-21 |
| M4-04 | backend | Input-credit rules on bills | No input credit from unregistered, composition or foreign suppliers. | RC-014 | CA questions CA-04 | CA-04 |
| M4-05 | backend | Supplier returns and debit notes | Only billed rejects are debited, against their own bill; a return can be undone. | RC-129 | Register | - |
| M4-06 | backend | Transfers, counts, adjustments | Approval by another person; rejected stock cannot go back to the shelf without QC; transfers can be undone; an item listed twice in a count is merged. | RC-123, RC-124 | Plan flow 7 | - |
| M4-07 | backend | Job work | Challan, receipts (back, used, lost), serialised outputs create their units, charges, cost filter for operations. | RC-130 | v1 PROGRESS change log 13 Oct | - |
| M4-08 | backend | Imports and landed cost | Shipments through stages; duty, IGST at customs; customs-agent GST claimed, not costed; costs spread with a preview. | RC-106 | Plan flow 6 | D-10 |
| M4-09 | backend | Foreign currency | Currency list and rate table; foreign amount kept; exchange difference posted. | RC-009 | Handover D-10 | D-10 |
| M4-10 | ui 👁 | Purchasing screens | PO, approval queue, inward and QC, bills with match view, returns. | - | Plan p.8 | - |
| M4-11 | ui 👁 | Stock screens | Stock by place, transfers, counts, adjustment approval, units by serial, job work, imports. | - | Plan p.8 | - |
| M4-12 | e2e 👁 | Journey: buying goods | PO with approval, bill, count in, QC with rejects, return with debit note, payment. |  Flow 5 | Plan flow 5 | - |
| M4-13 | e2e 👁 | Journey: importing goods | Shipment, duty, IGST, agent bill, landed cost preview and post. |  Flow 6 | Plan flow 6 | - |
| M4-14 | e2e 👁 | Journey: keeping stock right | Transfer with reason, count with difference, nothing changes until approved. |  Flow 7 | Plan flow 7 | - |

### M5: Accounts, GST and moving from Vyapar (23 tickets)

Expenses, bank, TDS, GST returns and locks, reports, year close, Vyapar import and the parallel-month report.

| ID | Role | Ticket | Acceptance criteria | Covers | Doc reference | Waits on |
|---|---|---|---|---|---|---|
| M5-01 | architect | GST design | GSTR-1 sections, 3B with set-off, settlement entries, reverse charge; each mapped to the CA question that confirms it. | - | CA questions A1-A6 | D-08 |
| M5-02 | backend | Expenses | Categories post only to allowed accounts; blocked-credit and state checks on input GST; bill attached. | RC-058 | Register | - |
| M5-03 | backend | Reverse charge | Liability and credit booked for imported services and notified supplies. | RC-057 | Register | CA |
| M5-04 | backend | GSTR-1 sections | Nil-rated, exempt, advances, e-commerce, amendments and 0% sales filed right. | RC-107 | Register | - |
| M5-05 | backend | GSTR-1 portal file | Validated against GSTN's own schema; Table 13 right. | RC-059 | Register | - |
| M5-06 | backend | GSTR-3B | All tables, cross-head set-off, credit brought forward. | RC-108 | Register | - |
| M5-07 | backend | GST settled in the books | Monthly settlement entry; each return ties to the ledger. | RC-109 | Register | - |
| M5-08 | backend | Filed-month lock | Locks every door (invoices, notes, bills, expenses, journals, customs IGST); records what was filed (ARN, snapshot); current month cannot be marked filed; undo by owner or admin with reason. | RC-012 | Register | - |
| M5-09 | backend | Period lock and year close | Lock moves forward freely, back only with maker-checker; reopening a year needs a second person; close waits for postings in flight. | RC-039, RC-163 | Handover D-06 | D-06 |
| M5-10 | backend | TDS | Sections and rates, thresholds, higher no-PAN rate, deducted when the bill is booked, deposits. | RC-060 | Register | CA |
| M5-11 | backend | Bank statement import | CSV, Excel and PDF through the import library, PDFs in the worker; duplicates by bank reference and running balance, not just amount and day. | RC-135, RC-136 | Plan flow 9 | - |
| M5-12 | backend | Bank statement mail | Sender proved by aligned DKIM/DMARC; one rule maps to one account; file stored before the database; junk limits; retention. | RC-066, RC-137, RC-144 | Security appendix E8 | - |
| M5-13 | backend | Reconciliation | Matching uses reference, narration and party, not amount and date alone; auto-match in the worker; one entry over several lines; unmatching reverses a booked fee. | RC-087, RC-145, RC-210 | Security appendix E9 | - |
| M5-14 | backend | Reports | Day book, ledgers, ageing (with 'not on a bill'), trial balance, P&L, balance sheet, cash and bank book, stock valuation, profit by bill and customer, HSN; paged in the database; under 1 second at 50,000 rows. | RC-176 | Plan p.7 speed targets | - |
| M5-15 | backend | E-invoice fields | IRN, acknowledgement and QR entered and printed; a live IRN blocks cancelling. | RC-116 | Handover D-03 | D-03 |
| M5-16 | backend | Vyapar opening balances | Parties, items with stock, account balances via the import library; dry run; opening stock on the cut-over date, approved by someone else, closed after use. | RC-038 | Plan flow 12 | D-16 |
| M5-17 | backend | Vyapar unpaid invoices one by one | Old invoices brought in so they can be returned, credited or chased. | RC-120 | Handover D-16 | D-16 |
| M5-18 | backend | Parallel-month reconciliation | Daily side-by-side of sales, tax, receipts, payments, party balances, cash, bank and stock with a differences log. | RC-121 | Go-live checklist §4 | - |
| M5-19 | ui 👁 | Accounts screens | Expenses, bank reconciliation, transfers, TDS, financial years, period lock. | - | Plan p.8 | - |
| M5-20 | ui 👁 | GST and report screens | Returns, portal file, filed marks; every report as table or chart. | - | Plan p.9 | - |
| M5-21 | ui 👁 | Moving from Vyapar screens | Upload, dry-run errors per row, compare. | - | Plan flow 12 | - |
| M5-22 | e2e 👁 | Journey: a month in accounts | Receipts, payments, expenses, bank match, GSTR-1 and 3B, mark filed, lock. |  Flow 9 | Plan flow 9 | - |
| M5-23 | e2e 👁 | Journey: moving from Vyapar | Masked rehearsal files: dry run, import, compare. |  Flow 12 | Plan flow 12 | - |

### M6: People, operations, service, dashboards (25 tickets)

HR, attendance, leave, payroll, operations, workshop, privacy jobs, dashboards. Runs beside M5.

| ID | Role | Ticket | Acceptance criteria | Covers | Doc reference | Waits on |
|---|---|---|---|---|---|---|
| M6-01 | architect | Payroll scope design | What is built and what is bought (D-13), policies (D-14), statutory items in scope. | - | Handover D-13, D-14 | D-13, D-14 |
| M6-02 | backend | Hiring | Openings, applicants, interviews; hiring creates the employee without salary or sign-in, which need employees:manage. | RC-094 | Plan p.9 HR | - |
| M6-03 | backend | Employees, salary and bank | Salary history by date; bank details encrypted and masked; a bank change audited with before and after and needs a second person; reveals logged. | RC-036, RC-043 | Security appendix E19 | D-20 |
| M6-04 | backend | Attendance | Register and import; clock-in with location check, time window, missing clock-out and night shift rules; HR's mark wins; holiday calendar; weekly-off rule. | RC-099, RC-101, RC-178 | Plan flow 10 | D-14 |
| M6-05 | backend | Leave | Types, balance checked when asked, accrual, carry forward, encashment, leaver pro-rata; approver is not the person asking. | RC-179 | Plan flow 10 | D-14 |
| M6-06 | backend | Payroll calculation | Paid by the day across a raise; rules as they stood that month; a reopened month reverses in its own month; changes into an approved month refused. | RC-013, RC-098, RC-100 | Register | - |
| M6-07 | backend | Payroll approval and self-pay guards | Preparer, approver and payer are different people; approval is of the exact figures seen; no advance to yourself; nobody unlinks their own employee record. | RC-034, RC-035 | Security appendix E4, E18 | D-06 |
| M6-08 | backend | Salary structure, PF and ESIC | Structure, UAN and ESIC numbers, contribution periods, employer parts. | RC-104 | Register | D-13 |
| M6-09 | backend | Professional tax, LWF and the statutory notice | PT by state slab including February; LWF; screens say which statutory items are not modelled. | RC-102, RC-103 | Register | D-13 |
| M6-10 | backend | Payslips and the bank list | Payslip links revocable and short-lived, no net pay in the WhatsApp text; bank list leaves out people without account details. | RC-049, RC-166 | Register | - |
| M6-11 | backend | Leaving the company | Sign-in switched off; final settlement of advances, leave and notice. | RC-092, RC-180 | Register | - |
| M6-12 | backend | Payroll tests pinned | Statutory figures pinned by hand-worked tests. | RC-167 | Register | - |
| M6-13 | backend | Operations | Routines make tasks by job, never on opening a screen; task board moves; projects; allocation safe against two people at once; project owner rules; assets and maintenance. | RC-177, RC-209 | Plan flow 11 | - |
| M6-14 | backend | Workshop job cards | Take-in by serial; warranty from sale date for vehicle and parts; estimate approved from a link; a fitted part cannot be deleted; cancelling the service bill does not restock fitted parts; hand-back goes through the credit check. | RC-064 | Plan flow 8 | - |
| M6-15 | backend | Supplier warranty claims | No duplicates, capped; supplier credit booked from a document with GST. | RC-182 | Plan flow 8 | - |
| M6-16 | backend | Erasure and retention | Anonymise and erase on request; retention jobs per D-12; audit keeps references, not copies. | RC-011 | Handover D-12 | D-12 |
| M6-17 | backend | Dashboards and home | Sales, marketing, accounts, stores, HR, operations, owner summary, home 'waiting at each step'; read-only. | - | Plan p.9 | - |
| M6-20 | ui 👁 | HR screens | Openings, applicants, employees, attendance register that never wipes unsaved marks, leave. | RC-105 | Plan p.9 | - |
| M6-21 | ui 👁 | Payroll and My work screens | Runs, approval, payslips; My work with clock-in, leave, tasks, payslips. | - | Plan p.6 | - |
| M6-22 | ui 👁 | Operations screens | Boards, projects, allocation, assets. | - | Plan p.9 | - |
| M6-23 | ui 👁 | Workshop screens | Job card, estimate page, claims, service reports. | - | Plan p.9 | - |
| M6-24 | ui 👁 | Dashboards and home screens | Charts with tables behind them. | - | Plan p.9 | - |
| M6-25 | e2e 👁 | Journey: a vehicle in the workshop | Take-in, diagnosis, estimate link, warranty and paid parts, hand-back bill, supplier claim. |  Flow 8 | Plan flow 8 | - |
| M6-26 | e2e 👁 | Journey: a payroll month | Clock-ins, leave, run, approve by another person, pay, payslip link. |  Flow 10 | Plan flow 10 | - |
| M6-27 | e2e 👁 | Journey: daily operations | Routine creates tasks, ticked in My work, maintenance rolls forward. |  Flow 11 | Plan flow 11 | - |

### M7: Integrations (10 tickets)

Shopify, Amazon/Flipkart, WhatsApp, Meta and Google on the webhook framework, with recorded real payloads.

| ID | Role | Ticket | Acceptance criteria | Covers | Doc reference | Waits on |
|---|---|---|---|---|---|---|
| M7-01 | backend | Real payload fixtures | Recorded real payloads for every source, run through the production path (inbox, queue, service). | RC-143 | Register | external accounts |
| M7-02 | backend | Shopify orders | Cancel before create handled; replays refused; test orders, wrong totals or tax held; delivery address per order; channel item map used. | RC-067, RC-139, RC-140, RC-141 | Security appendix E10 | - |
| M7-03 | backend | Shopify edits, payments, refunds | Later edits and refunds applied (rule from D-21); orders paid online recorded as paid. | RC-085, RC-138 | Register | D-21 |
| M7-04 | backend | Shopify stock push | Available stock per SKU pushed by a debounced job. | RC-183 | Register | - |
| M7-05 | backend | Amazon and Flipkart reports | Import needs its own permission; blank prices refused; orders held for review. | RC-065 | Security appendix E11 | - |
| M7-06 | backend | WhatsApp opt-out | STOP recorded as opt-out, never as a new consenting lead. | RC-068 | Register | - |
| M7-07 | backend | WhatsApp sending | Approved templates; delivered, read and failed statuses; a timeout is 'unknown', not 'not sent'. | RC-184 | Register | WhatsApp number |
| M7-08 | backend | Meta and Google connection checks | Check-connection buttons; token expiry warnings; catch-up fetch of missed leads. | - | v1 PROGRESS 13 Oct | - |
| M7-09 | ui 👁 | Integration screens | Source status, stuck events with retry, Shopify item map. | - | Plan p.9 | - |
| M7-10 | e2e 👁 | Journey: an online order | Shopify order in, delivered, invoiced, one stock number; marketplace report import. |  Flow 4 | Plan flow 4 | - |

### M8: Hosting, release and go-live gates (26 tickets)

AWS Mumbai, backups and recovery, monitoring, release pipeline, then Gate 0, Gate 1, the parallel month, Gate 2 and switch-off.

| ID | Role | Ticket | Acceptance criteria | Covers | Doc reference | Waits on |
|---|---|---|---|---|---|---|
| M8-01 | backend | Infrastructure as code | Terraform for VPC, EC2, RDS, S3, IAM, Secrets Manager in Mumbai; host hardening, SSH, firewall, time, patching written down. | RC-076 | Hosting rec §10.3 | AWS account |
| M8-02 | backend | Production images | Multi-stage, compiled JS, no dev dependencies, base images pinned by digest and refreshed, built in CI and pushed to ECR. | RC-072, RC-073 | Register | - |
| M8-03 | backend | Runtime settings | Caddy access log, headers, size and time limits, keep-alive aligned with Node; container memory/CPU limits, log rotation, read-only filesystem; RDS parameters (checksums, slow-query and lock logging). | RC-020, RC-074, RC-075, RC-201 | Register | - |
| M8-04 | backend | Release pipeline | Deploy only tagged, green builds; migration as its own step with owner credentials; rollback tested; backup, restore, Caddy and update exercised in CI. | RC-051, RC-174, RC-192 | Register; decision N5 | - |
| M8-05 | backend | Backups | RDS point-in-time 35 days; encrypted logical dumps with a public key, upload-only identity, S3 versioning and Object Lock; files versioned, not re-archived; keys kept off the server. | RC-001, RC-002, RC-016, RC-070 | Tech report 5.1-5.3 | Hosting rec D4 |
| M8-06 | backend | Restore drill | Scheduled; on data of real shape; checks files; all-or-nothing; books check after. | RC-017 | Tech report 5.4 | - |
| M8-07 | backend | Monitoring | Uptime probe from a separate server; health that touches the database; heartbeats; disk and crash alerts; error tracker in Mumbai. | RC-083 | Register | - |
| M8-08 | architect | Recovery runbook and on-call | Recovery targets, runbook, named on-call (D-18), one rehearsal. | RC-050 | Handover D-18 | D-18 |
| M8-09 | architect | Data residency | Residency register; Singapore review copy retired; Mumbai staging on sample data. | RC-018 | Hosting rec §5, D9 | D-17 |
| M8-10 | e2e | Every route behaviour-tested | CI compares the route manifest with the routes the tests hit; none unexercised. | RC-197 | Register | - |
| M8-11 | backend | Connect the real accounts | Meta, Google forms, WhatsApp, Shopify, statements mailbox on staging, then production. | - | Plan p.17 step 3 | external accounts |
| M8-12 | backend | Real users and company data | Users and roles, company profile, dealer prices and terms loaded and checked. | - | Plan p.7 | user list |
| M8-13 | backend | Rehearse on a real Vyapar file | Masked real export through dry run and import on staging; file shape fixed where it differs. | RC-119 | Register | Vyapar exports |
| M8-20 | architect | Gate 0: version, host, repo hygiene | Evidence for every line; owner and a second person sign. | GL-001..GL-013 | Go-live checklist §2.1-2.3 | - |
| M8-21 | architect | Gate 0: database integrity | Evidence for every line. | GL-014..GL-029 | Go-live checklist §2.4 | - |
| M8-22 | architect | Gate 0: money rules, access, personal data | Evidence for every line. After this, real data may enter. | GL-030..GL-050 | Go-live checklist §2.5-2.6 | - |
| M8-23 | architect | Gate 1: data migration | Evidence for every line. | GL-051..GL-065 | Go-live checklist §3.1 | - |
| M8-24 | architect | Gate 1: hosting, backups, monitoring | Evidence for every line, alerts proved by failing something on purpose. | GL-066..GL-087 | Go-live checklist §3.2-3.4 | - |
| M8-25 | architect | Gate 1: access, integrations, security, CI | Evidence for every line. | GL-088..GL-110 | Go-live checklist §3.5-3.8 | - |
| M8-26 | architect | Gate 1: books behave, parallel-month tools | Evidence for every line. | GL-111..GL-122 | Go-live checklist §3.9-3.10 | - |
| M8-27 | architect | The parallel month | Daily, weekly and month-end routine kept with evidence; every difference explained. Calendar month, not hours. | GL-123..GL-151 | Go-live checklist §4 | - |
| M8-28 | architect | Gate 2: GST and close | Evidence for every line. | GL-152..GL-168 | Go-live checklist §5.1-5.2 | - |
| M8-29 | architect | Gate 2: payroll, bank, e-invoice, DPDP, operations, rollback, go/no-go | Evidence for every line. | GL-169..GL-202 | Go-live checklist §5.3-5.9 | - |
| M8-30 | architect | Switch-off day | Day before and switch-off steps in order. | GL-203..GL-215 | Go-live checklist §6.1-6.2 | - |
| M8-31 | architect | First-week watch | Daily list for seven days after switch-off. | GL-216..GL-227 | Go-live checklist §6.3 | - |
| M8-32 | architect | Stop conditions review | Any one of these means do not switch off; reviewed at go/no-go. | GL-228..GL-248 | Go-live checklist §7.1 | - |

### M9: After go-live (only what you pick) (7 tickets)

Wave 3 builds: TDS returns, salary TDS, e-invoice portal link, push alerts, offline counter, Hindi, AI.

| ID | Role | Ticket | Acceptance criteria | Covers | Doc reference | Waits on |
|---|---|---|---|---|---|---|
| M9-01 | backend | TDS returns and certificates | Quarterly return file, certificates, interest and late fee. | RC-181 | Register W3 | CA |
| M9-02 | backend | Salary TDS (section 192) | Regime, declarations, projection, return data, or handed to the bought payroll product. | RC-169 | Register W3 | D-13 |
| M9-03 | backend | E-invoice and e-way bill portal link | Through a GST service provider; moves into M5 if the CA says e-invoicing applies. | RC-170 | Register W3; Handover D-03 | D-03 |
| M9-04 | ui | Push alerts | Lead and task alerts to phones with the app closed; preferences and quiet hours. | RC-185 | Design notes A-9 | - |
| M9-05 | ui | Offline counter | Provisional bills queued and synced per D-22. | - | Design notes A-7, A-8 | D-22 |
| M9-06 | backend | AI foundations | Legal basis and notice, gateway, limits and spend cap, read-only tools only. | RC-195 | AI notes B2-B3 | D-04 |
| M9-07 | backend | Bill reading | Supplier PDF to a draft bill a person checks; never posts by itself. | RC-196 | AI notes B4 | D-04 |

## 7. Coverage index: register item to ticket

| RC | Wave | Ticket | Item (shortened) |
|---|---|---|---|
| RC-001 | W1 | M8-05 | Backups fail open: the only copy is an unencrypted dump on the same disk as the database, and nothing says so |
| RC-002 | W1 | M8-05 | Backup keys and cloud credentials sit beside the data, so ransomware or a stolen server can read or erase ever |
| RC-003 | W1 | M1-06 | The database owner password sits in the API container environment, and the app login keeps UPDATE and DELETE r |
| RC-004 | W1 | M2-03 | Posted bills, payments, expenses and payslips can be changed or deleted with plain SQL, deleting a payroll run |
| RC-005 | W1 | M0-08 | The real-PostgreSQL CI job fails before any test runs, and the real-database suite builds a new database for e |
| RC-006 | W1 | M0-01 | The repository is public, and nothing watches dependencies or scans for secrets while Next.js published 22 adv |
| RC-007 | W1 | M1-11 | Failed database queries put names, phone numbers, PAN and bank details, and link tokens into the error log, th |
| RC-008 | W1 | M1-01 | Prices and unit costs are limited to 2 decimals, so a rate such as 0.375 cannot be entered and foreign unit pr |
| RC-009 | W1 | M4-09 | Foreign-currency documents keep only the rupee figure; the foreign amount is re-derived by division, and there |
| RC-010 | W1 | M2-02 | The second legal entity is half-built and an admin can create one today; purchases, payments, stock, reports,  |
| RC-011 | W1 | M6-16 | There is no way to erase, anonymise or time-limit personal data, and the audit log and event tables keep full  |
| RC-012 | W1 | M5-08 | The filed-month GST lock guards only half the doors, nothing records what was filed, and the current month can |
| RC-013 | W1 | M6-06 | Reopening a month books the reversal into today's month, and re-approving or reopening a past month re-reads t |
| RC-014 | W1 | M4-04 | Input credit is claimed on bills from suppliers with no GSTIN, from composition dealers and from foreign suppl |
| RC-015 | W1 | M0-05 | Choose the production host: the code is written for a long-running server and loses limits, jobs and uploads o |
| RC-016 | W1 | M8-05 | There is no point-in-time recovery: a server loss restores to last night, and invoice numbers already given to |
| RC-017 | W1 | M8-06 | The restore drill passes on an empty database, never checks uploaded files, is not scheduled, and the document |
| RC-018 | W1 | M8-09 | "Data stays in India" is true only on paper: the only running copy is pinned to Singapore and several data flo |
| RC-019 | W1 | M0-08 | Committing the audit proof tests as they are would turn npm test and CI red |
| RC-020 | W1 | M8-03 | PostgreSQL runs on image defaults: no data checksums, no tuning, no slow-query or lock-wait logging, and a 10- |
| RC-021 | W1 | M1-14 | The first admin can be created locked out, and the generated password is printed into build or container logs |
| RC-022 | W1 | M3-09 | An issued invoice does not freeze who issued it: old invoices reprint with today's company name, GSTIN, addres |
| RC-023 | W1 | M4-03 | Duplicate-bill protection is wrong in both directions, and a bill stores neither the supplier's invoice date n |
| RC-024 | W1 | M1-05 | 119 of 159 numeric columns and 61 of 110 tables have no CHECK, so none of the arithmetic identities is enforce |
| RC-025 | W1 | M2-05 | The stock ledger has no business date, so back-dated documents and period-end stock reports use the posting ti |
| RC-026 | W1 | M2-06 | Serial numbers: nothing in the database stops a unit being on the shelf twice, and some paths skip the rules |
| RC-027 | W1 | M2-06 | One status column answers three questions (whose is it, what condition, is it promised), so a customer's scoot |
| RC-028 | W1 | M4-02 | Batches are a label: stock going out names no batch, a receipt line holds one batch, and different suppliers'  |
| RC-029 | W1 | M1-05 | 124 of 214 foreign keys have no index |
| RC-030 | W1 | M1-12 | The audit trail depends on about 185 hand-written audit() calls; updated_at is not maintained and updated_by d |
| RC-031 | W1 | M1-13 | 33 of the 230 write routes leave no audit entry, including every login, password change and almost every expor |
| RC-032 | W1 | M3-04 | The consent record is thin and forgeable: no notice or purpose stored, a stranger can record consent for someo |
| RC-033 | W1 | M1-18 | Someone given user-management rights can make themselves an administrator, and the Permissions screen can gran |
| RC-034 | W1 | M6-07 | A payroll user can pay themselves a cash advance, and an admin can unlink their own employee record to escape  |
| RC-035 | W1 | M6-07 | One payroll user can prepare, adjust, approve and pay a month for everyone else, and the approver approves fig |
| RC-036 | W1 | M6-03 | A change of someone's bank account is not in the audit trail and needs no second person |
| RC-037 | W1 | M1-20 | The person who makes a change can usually also approve it: adjustments, purchase orders, price lists, service  |
| RC-038 | W1 | M5-16 | The Vyapar opening stock import stays open forever, posts stock on the day of import, lets Accounts approve it |
| RC-039 | W1 | M5-09 | One accountant can move the period lock back over open months, and a closed year can be reopened with a lock t |
| RC-040 | W1 | M1-22 | Personal data masking and the "who looked" log cover the detail page but not lists, the phone lookup, exports  |
| RC-041 | W1 | M3-05 | Any salesperson can pull the whole lead and phone list in pages of 5,000 and edit any lead |
| RC-042 | W1 | M1-17 | Routes an AI tool would call already return data beyond the caller's role, and rows are not scoped to the pers |
| RC-043 | W1 | M6-03 | Salary and full bank account numbers are listed for every employee at once, are plain text everywhere, and nob |
| RC-044 | W1 | M1-05 | 52 enums, 24 ADD VALUE migrations, and two roles called store and stores |
| RC-045 | W1 | M1-03 | Uniqueness, format and lookup gaps: duplicate emails and SKUs by case, GSTIN and PAN formats, and state codes  |
| RC-046 | W1 | M1-12 | Plan for the big append-only tables: partition the three logs by month now, while they are empty |
| RC-047 | W1 | M1-23 | Public link tokens are stored in plain text and copied into other tables |
| RC-048 | W1 | M3-14 | Invoice and estimate links never expire, cannot be switched off, can be created by anyone who can read invoice |
| RC-049 | W1 | M6-10 | Payslip links show salary, deductions and IFSC to anyone with the link, cannot be revoked, and the WhatsApp te |
| RC-050 | W2 | M8-08 | There is no disaster-recovery objective, runbook, on-call arrangement or rehearsal, and the whole business sit |
| RC-051 | W2 | M8-04 | Nothing stops a red or untested commit from reaching the live server: main is unprotected and the server build |
| RC-052 | W2 | M1-07 | The migration runner is not safe on a live database, and the "way back" that update.sh prints does not work |
| RC-053 | W2 | M2-05 | Item locks block unrelated inserts, two lock-order inversions can deadlock concurrent saves, and the latest lo |
| RC-054 | W2 | M3-03 | The public enquiry form's captcha and strict rate limit are bypassed through the website-form webhook, and the |
| RC-055 | W2 | M1-15 | No second factor on the accounts that move money, run payroll or change who can do what |
| RC-056 | W2 | M4-03 | A supplier bill is never held against the purchase order or goods received, tax is recomputed at the PO rate,  |
| RC-057 | W2 | M5-03 | There is no reverse charge anywhere |
| RC-058 | W2 | M5-02 | Expenses claim input credit with no blocked-credit check or state check, and an expense category can point at  |
| RC-059 | W2 | M5-05 | The GSTR-1 file has never been checked against the portal's rules, at least three things look likely to be rej |
| RC-060 | W2 | M5-10 | TDS is typed in by hand at payment time, with no thresholds, no higher no-PAN rate, and not at the time the bi |
| RC-061 | W2 | M3-07 | The dealer's credit limit and overdue bills are checked once, when the order is confirmed; delivery, invoice a |
| RC-062 | W2 | M2-05 | Negative-stock mode leaves a phantom stock value that never clears |
| RC-063 | W2 | M2-07 | The books-healthy check compares one total and reads six separate snapshots, so most stock-versus-books leaks  |
| RC-064 | W2 | M6-14 | A part already fitted can be deleted from a job card, so stock and cost have gone but nothing is ever billed,  |
| RC-065 | W2 | M7-05 | Any sales user can create confirmed orders at any price through the marketplace import; blank prices become Rs |
| RC-066 | W2 | M5-12 | A statement can be filed under the wrong bank account when two accounts share a mail rule |
| RC-067 | W2 | M7-02 | A Shopify cancellation that arrives before its order lets the cancelled order in, and a replayed signed body c |
| RC-068 | W2 | M7-06 | A WhatsApp "STOP" is not recognised: from an unknown number it creates a consenting lead, from a known lead it |
| RC-069 | W2 | M2-08 | The money tests are weaker than they look: estimated mutation score 52 percent on the 25 most critical functio |
| RC-070 | W2 | M8-05 | The backup script re-archives the whole uploads folder every day, so a single server runs out of disk within t |
| RC-071 | W2 | M0-08 | CI hygiene: no job timeouts, floating runner image, actions pinned by tag, no coverage or lint, and the Vercel |
| RC-072 | W2 | M8-02 | The production image carries every development dependency, runs TypeScript through tsx at each start, and is b |
| RC-073 | W2 | M8-02 | Base images are unpinned and never refreshed, so the server gets no operating-system, Node, PostgreSQL or Cadd |
| RC-074 | W2 | M8-03 | Caddy records no access log, adds no security headers, limits no request size or time, and config changes may  |
| RC-075 | W2 | M8-03 | No memory or CPU limits, no log rotation, no read-only filesystem or dropped capabilities: one runaway contain |
| RC-076 | W2 | M8-01 | There is no host baseline and no infrastructure as code: hardening, patching, SSH, firewall, time and disk are |
| RC-077 | W2 | M1-11 | Application logging is bare console.log: no request log, request id, levels, retention rule, scrubbing, or cap |
| RC-078 | W2 | M1-10 | A database restart, network blip or stray unhandled error can end the API process |
| RC-079 | W2 | M1-10 | Stopping the API cuts requests short: shutdown does not wait for requests or stop the scheduler, and the stop  |
| RC-080 | W2 | M1-08 | No lock, statement or connection timeouts: one stuck transaction or heavy report can freeze billing for everyo |
| RC-081 | W2 | M1-10 | The server starts with whatever settings it is given: nothing validates configuration, a missing NODE_ENV puts |
| RC-082 | W2 | M1-26 | Background jobs: the 15-minute in-process loop has no queue, retry, timeout, watchdog or overlap guard, the PR |
| RC-083 | W2 | M8-07 | Nobody outside the server watches the server: the health check says ok without touching the database, there is |
| RC-084 | W2 | M1-27 | Stuck webhook events are never retried or reported, so an expired Meta token silently loses leads, and webhook |
| RC-085 | W2 | M7-03 | Shopify edits, payments and refunds after the first message are thrown away |
| RC-086 | W2 | M1-44 | Lists, pickers and exports silently stop at a fixed size: Show more fails, past 5,000 rows nothing can be reac |
| RC-087 | W2 | M5-13 | Bank statement auto-matching is quadratic, runs on the web thread inside an open transaction, and a year of st |
| RC-088 | W2 | M1-21 | Rate limits count in process memory so they reset on restart and are not shared between servers, and the publi |
| RC-089 | W2 | M1-14 | Password guessing is limited per address only, in memory, with no per-account lockout, and successful sign-ins |
| RC-090 | W2 | M1-14 | Password rules are weak, the admin chooses and knows everyone's password, and bcrypt ignores everything after  |
| RC-091 | W2 | M1-16 | A session never really ends, and nobody can see or end other sessions |
| RC-092 | W2 | M6-11 | Recording that an employee has left does not switch off their sign-in |
| RC-093 | W2 | M2-03 | Manual journals can post to the GST, TDS, GRNI and payroll accounts, which the GST return never sees |
| RC-094 | W2 | M6-02 | HR can set a new employee's salary and link a sign-in through Hire, and can change leave policy and attendance |
| RC-095 | W2 | M1-18 | The permission matrix is cached per process, so a revoked permission stays granted on a second server copy, an |
| RC-096 | W2 | M1-25 | Anyone signed in can upload and open "other" and picture files with no limit, attachments are never deleted, a |
| RC-097 | W2 | M1-45 | After sign-in, a crafted next link such as /\evil.example sends the person to another website |
| RC-098 | W2 | M6-06 | A salary change back-dated into an approved or paid month, and attendance or leave changes for such a month, a |
| RC-099 | W2 | M6-04 | A self clock-in can still overrule HR's absent mark, because HR edits never clear the self-marked flag |
| RC-100 | W2 | M6-06 | A raise in the middle of a month is averaged over the month, so uneven attendance is paid at the wrong rate |
| RC-101 | W2 | M6-04 | Weekly offs are paid even if the person was absent every working day, and public holidays have no calendar |
| RC-102 | W2 | M6-09 | Professional tax is a flat number per person (no state slabs, no February figure, charged on any earnings) and |
| RC-103 | W2 | M6-09 | Overtime, bonus, gratuity, minimum wages and other statutory pay items are not modelled at all, and the payrol |
| RC-104 | W2 | M6-08 | PF and ESIC are worked from a made-up "Basic = 50% of gross": no real salary structure, no UAN or ESIC number, |
| RC-105 | W2 | M6-20 | On the attendance register, approving a leave request or any refresh silently wipes the marks typed but not ye |
| RC-106 | W2 | M4-08 | GST on customs-agent, port and trucking charges paid in cash is added to the cost of the goods instead of clai |
| RC-107 | W2 | M5-04 | GSTR-1 leaves out nil-rated and exempt supplies, advances, e-commerce supplies and amendments, and mis-files 0 |
| RC-108 | W2 | M5-06 | The GSTR-3B screen has two lines, no cross-head set-off, and ignores the credit brought forward |
| RC-109 | W2 | M5-07 | GST is never settled in the books, and nothing ties each month's return to the ledger |
| RC-110 | W2 | M3-10 | A credit note can reduce output tax at any age, and a price discount cannot be a credit note at all |
| RC-111 | W2 | M3-08 | Invoice, credit note and receipt dates are unbounded, goods are delivered before they are invoiced, advances c |
| RC-112 | W2 | M2-02 | An invoice can be issued while the company's own GSTIN, address and state are blank, and the state silently de |
| RC-113 | W2 | M3-09 | The printed invoice misses some Rule 46 particulars, a dealer saved without a GSTIN is reported as a consumer, |
| RC-114 | W2 | M3-12 | Cash has no limit: receipts of Rs 2 lakh or more in a day and payments above Rs 10,000 go through unmarked |
| RC-115 | W2 | M2-12 | No GST rate rows are loaded for the 22 September 2025 rate change, and a newer short-code rate loses to an old |
| RC-116 | W2 | M5-15 | E-invoice IRN, acknowledgement and QR cannot be entered or printed |
| RC-117 | W2 | M1-28 | The importers cannot read the files the sources produce: no Excel, comma-only CSV, UTF-8 only, and a 1 MB cap |
| RC-118 | W2 | M1-28 | A CSV statement with an unquoted "9,111.00" is imported as Rs 9, rows with unreadable dates vanish, and one cr |
| RC-119 | W2 | M8-13 | The Vyapar import has never been tried on a real Vyapar file, and the file shape is an assumption |
| RC-120 | W2 | M5-17 | Unpaid bills are not brought in one by one from Vyapar, so old invoices cannot be returned, credited or chased |
| RC-121 | W2 | M5-18 | The Vyapar compare screen is a three-list snapshot, not a parallel-month reconciliation |
| RC-122 | W2 | M3-13 | A hold on stock stays open after the goods leave from another place or with another serial, and the stock engi |
| RC-123 | W2 | M4-06 | A physical count that lists an item twice applies the difference twice |
| RC-124 | W2 | M4-06 | Rejected stock can be moved back to the sellable shelf, and a transfer cannot be undone |
| RC-125 | W2 | M3-08 | A part-delivered order can never be closed, and delivered goods cannot be taken back unless they are first inv |
| RC-126 | W2 | M3-10 | A cash sale returned across the counter cannot be refunded in the books, and cancelling an invoice deletes its |
| RC-127 | W2 | M3-13 | Cancelling a vehicle booking leaves the lead booked for good and the customer's advance sitting unexplained |
| RC-128 | W2 | M3-10 | A unit that comes back into stock keeps its sale: customer warranty stays on, and a sold serial can be receive |
| RC-129 | W2 | M4-05 | A supplier return debits the supplier whether or not the rejected goods were ever billed, picks the latest bil |
| RC-130 | W2 | M4-07 | Job work can bring in a serialised finished good without creating its units, so it sits in stock but can never |
| RC-131 | W2 | M3-07 | The "below cost" check compares with the last purchase rate, which any goods receipt can overwrite, and ignore |
| RC-132 | W2 | M1-09 | The "saved once" guard is optional, ignores what was sent, keeps whole answers (with link tokens) for a day, a |
| RC-133 | W2 | M1-42 | A failed save gets a fresh retry key, and several money and stock saves, including Receive goods and Save bill |
| RC-134 | W2 | M1-43 | Cancellations and reversals record a made-up reason instead of the person's |
| RC-135 | W2 | M5-11 | PDF and email statement parsing run inside the web server's own thread with no time or memory cap, and the PDF |
| RC-136 | W2 | M5-11 | A genuine bank row can be dropped as "already present" when an in-and-out of the same amount repeats on a day |
| RC-137 | W2 | M5-12 | Statement mail intake loses files on a database error, can be starved by junk mail, and grows without bound |
| RC-138 | W2 | M7-03 | A Shopify order that was paid online becomes an unpaid invoice, so customers who already paid can be chased |
| RC-139 | W2 | M7-02 | A returning Shopify customer's new delivery address is not recorded anywhere on the order |
| RC-140 | W2 | M7-02 | Shopify test orders, mismatched totals and wrong tax rates are all taken in as confirmed orders |
| RC-141 | W2 | M7-02 | Items are matched by SKU text only; the channel item map is built but never read |
| RC-142 | W2 | M3-02 | A reply or repeat enquiry from a lead that already exists makes no sound: no alert, and often no follow-up |
| RC-143 | W2 | M7-01 | The integration tests use hand-made payloads, enshrine today's gaps and never run the production path |
| RC-144 | W2 | M5-12 | A look-alike or forged sender still gets a bank statement mail imported and matched against real receipts |
| RC-145 | W2 | M5-13 | Bank lines are matched to the books on amount and date alone, including lines that arrived by email |
| RC-146 | W2 | M1-46 | No browser security headers on any screen or public page, the token pages can be indexed and cached, and new t |
| RC-147 | W2 | M1-45 | The "Signed out" dialog can be dismissed into an invisible dialog that freezes the whole page |
| RC-148 | W2 | M1-44 | Drop-downs that act the moment their value changes: arrow keys add items to a bill or reconcile a bank line |
| RC-149 | W2 | M1-42 | The app has no offline behaviour at all: a dropped connection shows "Failed to fetch" and unsaved work lives o |
| RC-150 | W2 | M0-09 | The web app has no automated test, no linter and no CI step of its own, and no end-to-end test covers the five |
| RC-151 | W2 | M1-40 | Some roles can open a screen they cannot complete (Operations job work, marketing walk-in), and some forms are |
| RC-152 | W2 | M3-16 | Printing depends entirely on the browser's print dialog: no paper size for the thermal roll, browser headers o |
| RC-153 | W2 | M1-19 | The permission sweep checks the code against itself: deleting a permission check from a route makes the sweep  |
| RC-154 | W2 | M0-08 | The default test engine differs from production: PostgreSQL 17 in memory with one connection, fresh installs o |
| RC-155 | W2 | M1-31 | Production code paths run differently under test: rate limiters are off, webhooks are awaited, passwords hash  |
| RC-156 | W2 | M1-31 | Some tests depend on the date they run, use if around assertions, or sleep |
| RC-157 | W2 | M2-09 | No test makes the server fail halfway through a save, so "all or nothing" is tested only for clean refusals |
| RC-158 | W2 | M1-11 | Error tracking is home-made, blind to the browser, and its alert de-duplication is keyed on the full URL and r |
| RC-159 | W2 | M1-40 | No error screen, loading screen or not-found page anywhere, and a render error shows Next's blank error page a |
| RC-160 | W2 | M1-29 | Searching by part of a name cannot use an index, and the database has no trigram support |
| RC-161 | W2 | M1-30 | The settings table holds configuration, hot job state and the period lock in one key space |
| RC-162 | W2 | M2-10 | Nothing ties a quantity to the item's unit of measure, so a Nos item can be ordered in fractions |
| RC-163 | W2 | M5-09 | Closing a year or moving the lock does not wait for postings in flight, and postJournal checks the lock after  |
| RC-164 | W2 | M2-14 | Cost prices reach Operations through job work, and the masters workbook skips the cost filter |
| RC-165 | W2 | M1-21 | The cross-site check lets a request with no Origin header through |
| RC-166 | W2 | M6-10 | The bank list includes people with no account number or IFSC |
| RC-167 | W2 | M6-12 | The regular tests do not pin the statutory payroll numbers, and the proofs of the open payroll holes live in a |
| RC-168 | W2 | M1-02 | The shared date check accepts days that do not exist (31 February), so a bad date reaches the database and ret |
| RC-169 | W3 | M9-02 | Salary TDS (Section 192) is not calculated: it is a flat monthly number someone types, with no PAN, regime, de |
| RC-170 | W3 | M9-03 | No e-invoice or e-way bill integration: a live IRN does not stop a cancel |
| RC-171 | W3 | M1-17 | Permission checks live only in the route files and response filters, so any AI layer that calls service functi |
| RC-172 | W3 | M4-03 | A purchase bill has no draft state and posts to the books the moment it is created, and no bill file is linked |
| RC-173 | W3 | M3-02 | Free text from outsiders (WhatsApp, lead forms, complaints) is stored in the same fields as staff notes, so an |
| RC-174 | W3 | M8-04 | CI never exercises the deploy path: backup, restore, Caddy and the update script are not run |
| RC-175 | W3 | M0-02 | Seven files of 700 to 1,400 lines mix routes, SQL and business rules, so the background worker cannot reuse a  |
| RC-176 | W3 | M5-14 | Lists and reports add up a whole ledger before they keep 100 rows, so 8 of the 15 heaviest screens take 1 to 1 |
| RC-177 | W3 | M6-13 | Opening the home screen, the owner dashboard or any task screen writes to the database |
| RC-178 | W3 | M6-04 | Clock-in is not verified: location is advisory and sent by the phone, any time of day counts, a missing clock- |
| RC-179 | W3 | M6-05 | The leave module is a single flat allowance: no types, no balance check when leave is asked for, no carry forw |
| RC-180 | W3 | M6-11 | Leaving the company has no final settlement: advances are stranded, and leave, notice and gratuity are not han |
| RC-181 | W3 | M9-01 | The TDS flow stops at the deposit: no quarterly return file, no certificates, no interest or late fee, and the |
| RC-182 | W3 | M6-15 | Supplier warranty claims are not de-duplicated or capped, and the supplier's credit is booked without a docume |
| RC-183 | W3 | M7-04 | Available stock is not pushed back to Shopify, so the store can sell goods RadCore has already sold |
| RC-184 | W3 | M7-07 | WhatsApp sending: a timeout says "nothing was sent" when it may have been, there are no approved templates, an |
| RC-185 | W3 | M9-04 | Lead alerts exist only while a tab is open, and the phone notification call is the wrong one |
| RC-186 | W3 | M1-04 | The screens share no validation with the API and have no typed contract with it |
| RC-187 | W3 | M1-43 | ui.tsx has outgrown itself, and money screens work around its Form |
| RC-188 | W3 | M1-42 | The data layer re-fetches on every keystroke, shows the previous answer under a new filter, and never refreshe |
| RC-189 | W3 | M1-41 | Accessibility (WCAG 2.2 AA): several failures touch every screen type |
| RC-190 | W3 | M3-22 | Quick bill is not yet a Vyapar-speed counter screen |
| RC-191 | W2 | M1-25 | Attachments live inside Postgres on Vercel, with a 4 MB cap, and are read whole into memory |
| RC-192 | W3 | M8-04 | On Vercel the migration runs inside every branch build as the database owner while the old version keeps servi |
| RC-193 | W3 | M1-06 | The only database login can write everywhere, and there is no read-only login or replica |
| RC-194 | W3 | M1-21 | Authenticated routes have no per-user rate limit or spend cap |
| RC-195 | W3 | M9-06 | No recorded legal basis or notice for AI processing |
| RC-196 | W3 | M9-07 | Two known accounting defects (credit on unregistered suppliers, bills at the wrong price) would be made easier |
| RC-197 | W3 | M8-10 | 57 of 402 routes are not exercised by any behaviour test; 32 are never named at all, including price-list appr |
| RC-198 | W3 | M0-07 | The development compose file publishes PostgreSQL on every network interface with a known password |
| RC-199 | W3 | M1-08 | The camelCase-to-snake_case layer burns CPU on every row: 3.8 seconds of one core for a 50,000-row answer |
| RC-200 | W3 | M2-04 | Settings, the default company and account ids are looked up again for every document; a numbered document cost |
| RC-201 | W3 | M8-03 | Node closes idle connections after 65 seconds but Caddy keeps them for 2 minutes, so an occasional request can |
| RC-202 | W3 | M1-29 | Date filters on timestamps convert every row, so they cannot use an index |
| RC-203 | W3 | M1-29 | Small input-handling gaps: search wildcards are not escaped, the 5,000-row page applies to every role, and pho |
| RC-204 | W3 | M1-02 | Follow-up times use the device's time zone on the older screens, and "today" comes from the device clock |
| RC-205 | W3 | M2-05 | The moving average includes rejected, job-work and demo stock |
| RC-206 | W3 | M2-03 | Journal entry numbers are a database sequence, so they have gaps |
| RC-207 | W3 | M3-10 | Taking back a cancelled credit note is recorded as another "sales return in", and a re-delivered line is coste |
| RC-208 | W3 | M3-13 | The vehicle delivery checklist accepts any file as the photo or signed note, ignores the order's state, and a  |
| RC-209 | W3 | M6-13 | Resource allocation can be over-booked by two people at the same moment, and project owners can reassign owner |
| RC-210 | W3 | M5-13 | Unmatching a bank line leaves a booked bank fee behind, and one book entry can never be split over two bank li |
| RC-211 | W3 | M3-06 | Smaller CRM points: the manual WhatsApp send has no per-user limit or opt-out check, templates change without  |
| RC-212 | W3 | M3-06 | The lead-sources "ignore" button can set aside a Shopify or marketplace order |
| RC-213 | W3 | M1-24 | Integration tokens and the secret box: no expiry watch, the Meta token travels in the URL, one Shopify secret, |
| RC-214 | W3 | M1-40 | The first-load JavaScript is fine; the render waterfall is the real cost |
| RC-215 | W3 | M1-01 | Money decisions in the browser use JavaScript floating point, though the shared Decimal helpers exist |
| RC-216 | W3 | M1-08 | Two small design smells that will bite later: matching on an error message, and a module-level retry key |
| RC-217 | W3 | M1-40 | Hindi and other-language readiness: numbers and dates are right, text is hard-coded English |
| RC-218 | W3 | M1-44 | A saved "board or list" choice is applied after the first draw, so the wrong view is fetched first |
| RC-219 | W3 | M1-40 | The iPhone home-screen app may draw under the notch: the viewport does not ask for the full screen |
| RC-220 | W3 | M0-04 | Dependencies are declared but unused, one drags in ten old packages, and nothing checks the manifests or the N |
| RC-221 | W3 | M0-03 | Small follow-ups recorded beside verified controls: a lint rule against raw SQL and dangerouslySetInnerHTML, a |
| RC-222 | W3 | M1-31 | Story tests depend on order and share a mutable record of ids, so a single test cannot be run on its own |