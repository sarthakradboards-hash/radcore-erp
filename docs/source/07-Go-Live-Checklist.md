RADCORE TECHNICAL REVIEW
RadCore go-live checklist
Radboards Pvt Ltd
29 October 2026
Reviewed commit  194e288
Contents
The conditions to meet before Vyapar is switched off. Prepared for Radboards Pvt Ltd for the owner and the developer to use on the day. It is built from the technical review of RadCore at commit 194e288, the 222-item fix register (master-register.md), and the area reports in RadCore-Review\areas\. Date of this version: 29 October 2026.
This is a working document, not legal or tax advice. Wherever a legal figure or rule is not settled, the line says so and names who must settle it (chartered accountant, counsel or labour adviser). The checklist never fills such a gap with a guess.
Size of the checklist: 248 lines.
| Part | Lines | Count |
| Gate 0 (section 2) | GL-001 to GL-050 | 50 |
| Gate 1 (section 3) | GL-051 to GL-122 | 72 |
| Parallel month routine (section 4) | GL-123 to GL-151 | 29 |
| Gate 2 (section 5) | GL-152 to GL-202 | 51 |
| Switch-off day plan (section 6.1 and 6.2) | GL-203 to GL-215 | 13 |
| First-week watch list (section 6.3) | GL-216 to GL-227 | 12 |
| Stop conditions (section 7) | GL-228 to GL-248 | 21 |
| All lines | GL-001 to GL-248 | 248 |

# 1. How to use it
## 1.1 The five stages and who signs
The PRD plans a month of RadCore running beside Vyapar. This checklist wraps that month in two gates and adds a gate before any real data goes in.
| Stage | What it unlocks | Lines | Signed by |
| Gate 0 (section 2) | Any real data entering RadCore, including a real Vyapar file | GL-001 to GL-050 (50 lines) | Developer, Owner, and a second person who did not build the fixes |
| Gate 1 (section 3) | The start of the parallel month | GL-051 to GL-122 (72 lines) | Developer, Owner, Accounts; HR for the staff and pay set-up; CA for the opening tie-out |
| The parallel month (section 4) | Proof that RadCore and Vyapar say the same thing | GL-123 to GL-151 (29 lines, repeated daily, weekly and at month end) | Accounts, Owner, CA |
| Gate 2 (section 5) | Switching Vyapar off | GL-152 to GL-202 (51 lines) | Owner, Developer, Accounts, HR, filing owner, CA, counsel, labour adviser |
| Switch-off day and first week (section 6) | Running on RadCore alone, with a way back | 13 plus 12 lines | Owner, Developer, Accounts |

Section 7 lists the stop conditions: 21 single conditions, any one of which means Vyapar is not switched off. Section 8 is the sign-off table.
Gate 0 holds every Wave 1 item of the register (the 49 things to fix before any real data). Gates 1 and 2 hold every Critical and Serious Wave 2 item (31) and the money, tax, payroll, privacy and operations conditions the reviews found. Appendix A shows where each of the 80 register items is checked. Appendix C shows where each of the 43 deployment-checklist lines of the operations review went.
## 1.2 What "pass" means
A line passes only when all four of these are true:
- The command printed the result stated in the line, or the screen shows the state stated, or the document exists and is signed.
- The evidence named in the last column is saved in the evidence folder under the line's id (see 1.5).
- The person named in Who verifies has initialled and dated the line.
- For lines about money, access, backups or personal data, the person who verifies is not the person who built the change. If there is one developer, the Owner or a named outside technical reviewer is the second person and initials too.
A line that is "nearly done" is open. A line that passed and then had its subject changed (a new release that touches it) is open again.
## 1.3 The status box
| Box | Meaning |
| ☐ | Open. Not yet verified. |
| ☑ | Pass. The four conditions above are met. |
| [!] | Tried and failed. Fix it, run it again, save new evidence. |
| [~] | Accepted by the Owner in writing, with the reason, a compensating control and a date. Allowed for two cases only: (a) a feature Radboards does not use, which has been switched off with the switch verified, on any line; (b) in Gates 1 and 2 only, a line that is not marked STOP, does not check a Critical or Serious Wave 2 item (Appendix A shows which), and where the Owner knowingly takes the risk. Never on a STOP line. Never on a Gate 0 line for case (b). |

The word STOP next to a line id means the line is cited in section 7 as a stop condition. Section 7 also holds group-wide stops: any open Gate 0 line stops the switch-off, and so does any open line that checks a Critical or Serious Wave 2 item.
## 1.4 Who is who
| Role | Who |
| Owner | The founder |
| Dev | The developer who runs the server |
| Accounts | The finance user who does the day-to-day books |
| HR | The person who runs payroll |
| Store lead, Sales lead | The people who run the stores and the lead desk |
| CA | The chartered accountant. The proposal recommends the CA's sign-off on the tax rules. |
| Labour adviser | For PF, ESIC, professional tax and the other pay rules |
| Counsel | A lawyer, for the DPDP Act 2023 questions |
| Filing owner | The named person who holds the GST portal login and files |
| Second person | Someone who did not build the item being checked |
| Host | The hosting provider's support |

## 1.5 Evidence
Make a folder go-live-evidence with one sub-folder per line id (GL-007). Save command output as a text file with the command written on the first line; save screenshots with the date visible; scan signed pages. Mask phone numbers, bank numbers and PAN in anything saved (the folder is itself personal data). Keep the whole folder in the off-site backup. The signed go-live record points to this folder.
## 1.6 Commands and conventions
- Commands assume the self-hosted route from the review: cd /opt/radcore and C="docker compose --env-file .env.production -f compose.prod.yml". If the hosting decision (the line for RC-015 in Gate 0) chooses a managed database, run the SQL with psql "$DATABASE_URL" and replace each docker compose exec check with the provider console screenshot named in the evidence column.
- Test commands are run from apps/api, for example npx vitest run test/audit/db.audit.test.ts -t "D-05". The proof tests named in the lines live in apps/api/test/audit/. After the line for RC-019 they run in the form the developer chose (marker removed, or npm run test:audit); use the same test names.
- DOMAIN, B, DUMPS and OWNER/REPO are placeholders: the production domain, a bucket name, the dumps bucket and the GitHub repository.
- Several lines accept "or the feature is switched off and the switch is verified". That keeps an unused integration (Shopify, Meta lead intake, statement by email) from blocking go-live while making sure it is really off.
## 1.7 Unsettled figures
Lines mark any legal or tax figure that is not settled with the word unsettled and the question number from the review (for example "CA Q1" is question 1 in area-13-money-compliance.md section 11). Examples are the e-invoice turnover limit, the e-way bill limit, the TDS table, the PF and ESIC limits, the DPDP start dates and the retention years. Appendix B lists them together. A figure that appears in this document is a figure the reviewers found in secondary sources, not law.
# 2. Gate 0: before ANY real data enters the system
"Real data" includes a real Vyapar export file, a real customer, a real employee. A rehearsal import with a masked Vyapar file (names, phones, GSTIN and bank numbers replaced) may be run earlier on a developer machine; that is a suggestion of this checklist and is not a register item.
Gate 0 is the register's Wave 1: data shape, immutability, secrets, backup and restore, anything that lets one person approve or pay themselves, and anything that exposes personal data. These cannot be cleaned up after real records exist.
## 2.1 Version under test
| ID | Condition | Source | Who verifies | How to verify | Evidence to save | Status |
| GL-001 | The release tag that will go live is chosen and written down. Every check in this gate is run against that tag, never against a developer's local branch. | area-10 App D #11; proposal-vs-reality (commit 194e288) | Dev | On the server: git describe --tags prints the tag; gh run list --branch main --limit 5 shows that tag's CI run. | Tag name and CI run link in the evidence log. | ☐ |

## 2.2 Host, backups and recovery
| ID | Condition | Source | Who verifies | How to verify | Evidence to save | Status |
| GL-002 | Production host decided and recorded (reviewers recommend AWS Mumbai: one server, PostgreSQL 16 on RDS or the compose database, S3 for files). The backup and restore scripts work on that host, not only on one compose project. | RC-015 (ARC-16, HST-10) | Owner decides, Dev builds | Signed decision note. From a clean checkout on the production VM run the rewritten restore drill (deploy/restore-drill.sh): it prints "restore drill passed" and leaves no scratch instance. A request after idle starts in under 1 second. | Signed decision note; drill output. | ☐ |
| GL-003 STOP | Production database, uploads and every backup bucket are in India. The Singapore review copy refuses a non-demo database. The residency register (area-10 App E.2) is filled and signed. | RC-018 (OPS-10, HST-01); area-10 App D #1 and #21 | Dev; Owner signs the register | aws s3api get-bucket-location --bucket B prints ap-south-1 (or ap-south-2 for the second repository) for every bucket in the register; aws s3api get-public-access-block --bucket B shows all four settings true; open the Vercel URL and try to sign in against a real database: refused. | Command outputs; signed register; screenshot of the refusal. | ☐ |
| GL-004 STOP | Backups cannot silently run unencrypted or on the same disk only: the backup refuses to start without an encryption key and an off-site bucket; the script defects (wrong file deleted on failure, world-readable files, ignored errors, drifting schedule, unchecked dump) are fixed. | RC-001 (OPS-01, OPS-14) | Dev; Second person re-runs | docker compose config with only the five README values exits non-zero and names the missing bucket and key; npx vitest run test/audit/infra.audit.test.ts -t "INFRA-6|I-03" passes; shellcheck deploy/*.sh is clean; pg_restore --list on the newest dump succeeds. | Command outputs. | ☐ |
| GL-005 | The keys do not sit beside the data. Dumps go to a versioned bucket with Object Lock (compliance, 35 days); the host credentials cannot delete or overwrite a dump; .env.production is mode 600 and a secret inventory has a row per variable; a recovery sheet exists and a second person has used it. | RC-002 (OPS-05, OPS-23); area-10 App D #2, #3, #10, #20 | Dev; Owner; Second person | stat -c '%a %U' .env.production prints 600 root; aws s3api get-bucket-versioning --bucket B shows Enabled; aws s3api get-object-lock-configuration --bucket DUMPS shows COMPLIANCE and 35 days; aws s3 rm s3://DUMPS/weekly/<file> with the host keys is denied; the second person restores a test backup using only the recovery sheet; npx vitest run test/audit/infra.audit.test.ts -t "INFRA-7" passes. | Outputs; initialled recovery sheet; secret inventory. | ☐ |
| GL-006 STOP | Point-in-time recovery works and is current, so a server loss does not mean "restore to last night" and issued invoice numbers are not reused. | RC-016 (OPS-02, HST-02); area-10 App D #4 to #8 | Dev; Owner witnesses the drill | Self-hosted route: docker compose exec -T -u postgres db pgbackrest --stanza=radcore check exits 0; select now() - last_archived_time from pg_stat_archiver; is under 2 minutes; systemctl list-timers 'radcore-*' shows full, diff, dump and files timers; restic snapshots --latest 1 is under 26 hours old; bash deploy/restore-test.sh --pitr exits 0 and the report shows the canary within 60 seconds of the target. Managed route: console screenshot of the recovery window plus a restore to a point in time into a scratch instance. After the drill the last invoice number equals the last one printed. | Command outputs; drill report; note of the last invoice number. | ☐ |
| GL-007 STOP | The restore drill cannot pass on an empty database, checks uploaded files, runs on a schedule and reports every run. The written restore steps are all-or-nothing and work on a fresh server. | RC-017 (OPS-03, OPS-13, OPS-33); area-10 App D #38 | Dev; Second person | Feed the drill an empty custom-format dump: it exits 1 with "restored counts below manifest"; npx vitest run test/audit/infra.audit.test.ts -t "D-03" passes; someone who did not write the runbook restores on a fresh VM from the steps alone; the first scheduled report in the reports bucket shows every check passed. | Drill output; first report; name of the second person. | ☐ |
| GL-008 | PostgreSQL has data checksums, slow-query and lock-wait logging, and a stop deadline longer than 10 seconds. | RC-020 (OPS-28); area-10 App D #14 | Dev | docker compose exec db psql -U postgres -tAc "show data_checksums" prints on; show log_min_duration_statement prints 500ms; show archive_mode prints on. | Outputs. | ☐ |
| GL-009 | The owner (superuser) password is not in the API container. The application login cannot UPDATE, DELETE or TRUNCATE the ledgers. | RC-003 (OPS-04, ENG-22); area-10 App D #13 | Dev | docker compose exec api env | grep -c MIGRATION_DATABASE_URL prints 0; select rolsuper from pg_roles where rolname='radcore_app' prints f; as radcore_app update stock_movements set qty = 1 fails with a permission error; the tests at test/audit/db.audit.test.ts lines 433 and 457 pass. | Outputs. | ☐ |
| GL-010 | The first admin is created with a working password that must be changed at first sign-in. No password is printed in any log. Demo data is off. | RC-021 (SCA-22, HST-12); area-10 App D #41 | Dev | docker compose logs api | grep -c "password:" prints 0 (after log rotation); grep -c '^SEED_DEMO_DATA=false' .env.production prints 1; sign in as the first admin and the change-password prompt appears; tests A-09 and D-11 in test/audit pass. | Outputs; screenshot of the prompt. | ☐ |

## 2.3 Repository and release hygiene
| ID | Condition | Source | Who verifies | How to verify | Evidence to save | Status |
| GL-011 | The real-PostgreSQL CI job runs and passes, so the concurrency tests actually execute. | RC-005 (TST-01, TST-16) | Dev | gh run list --workflow ci.yml --limit 10 --json name,conclusion shows ten consecutive postgres runs green; the job log reports the 8 concurrency tests passed; the full run finishes in under 3 minutes on a 2-CPU runner. | Run list output. | ☐ |
| GL-012 | The audit proof tests are committed without turning npm test or CI red. | RC-019 (TST-13) | Dev | npm test is green with apps/api/test/audit/ committed; on a scratch branch fix one defect and exactly that test changes state. | Test output. | ☐ |
| GL-013 STOP | The repository is private. Secret scanning with push protection, Dependabot and an npm audit job in CI are on. Any secret that ever sat in the repository history while it was public has been rotated (rotation rule added by this checklist). | RC-006 (LIB-01, SCB-13) | Dev; Owner | gh repo view --json visibility prints PRIVATE; .github/dependabot.yml exists and the first Monday opens a grouped pull request; a throwaway branch that sets next to 16.4.0 turns the audit job red; the secret-scanning alert list is empty or every alert is rotated. | Command outputs; list of rotated secrets. | ☐ |

## 2.4 Database integrity and data shape
| ID | Condition | Source | Who verifies | How to verify | Evidence to save | Status |
| GL-014 | Posted bills, payments, expenses and payslips cannot be changed or deleted with plain SQL. Deleting a payroll run does not wipe its payslips. The four database rules have no holes. | RC-004 (DAT-04, DAT-11) | Dev | npx vitest run test/audit/db.audit.test.ts -t "D-05|DB-3|D-02|D-06|D-16|DB-1|DB-2" is green (D-05 has 14 tests); the payroll-run cascade probe passes. | Test output. | ☐ |
| GL-015 | An issued invoice keeps the seller details it was issued with. Changing the company name or GSTIN later does not change a reprint. | RC-022 (DAT-09) | Dev | On a test copy: issue an invoice, change the company name and GSTIN, fetch the print data: the old values come back (new test in the register). | Test output; before and after print screenshot. | ☐ |
| GL-016 | Duplicate supplier bills are caught correctly: the same invoice number in different case or spacing is refused, a number reused in a new year is accepted. Each bill stores the supplier's invoice date and GSTIN. | RC-023 (DAT-13, TRD-21) | Dev | Book INV-12 then "inv-12 " for the same supplier and year: 409; book 0001 in the next year: accepted; npx vitest run test/audit/trade.audit.test.ts -t "S-16" passes. | Test output. | ☐ |
| GL-017 | The database enforces the arithmetic: CHECK constraints on invoice and bill totals, line identities, GST split, slabs, non-negative amounts, payslip net pay, GSTIN and PAN format. | RC-024 (DAT-10) | Dev | npx vitest run test/audit/db.audit.test.ts -t "D-04" (7 tests) is green and npm run test -w @radcore/api passes on PostgreSQL with the constraints in place. | Test output. | ☐ |
| GL-018 | The stock ledger carries a business date, so back-dated documents and period-end stock reports use the document date. | RC-025 (DAT-12) | Dev | npx vitest run test/audit/db.audit.test.ts -t "D-07" is green; a sale dated into last month leaves ledger stock value at that month-end equal to the journal's Stock in Hand. | Test output. | ☐ |
| GL-019 | A serial number cannot be on the shelf twice, and no code path skips the serial rules. | RC-026 (DAT-06) | Dev | A second +1 receipt of one unit is refused at COMMIT; a serial of " lower " is refused; two open reservations on one unit give error 23505. | Test output. | ☐ |
| GL-020 | A customer's scooter in the workshop is not treated as our stock, and a returned unit does not keep its old sale. | RC-027 (DAT-07) | Dev | A sold scooter taken into the workshop keeps custody "customer" and its pack is not listed by chargeDue(); a credit note for the original sale marks the unit as ours again. | Test output. | ☐ |
| GL-021 | Decision recorded: does Radboards track batches? If yes, stock out names a batch and a receipt line can hold several lots. If no, the owner records "batches not used". | RC-028 (DAT-08) | Owner decides, Dev builds | Signed decision. If tracked: receive two lots, deliver 100 of lot 1, v_batch_on_hand shows lot 1 as received minus 100, and a recall query by batch returns the delivery and the invoice. | Signed decision; query output. | ☐ |
| GL-022 | The foreign keys that queries use are indexed. | RC-029 (DAT-14) | Dev | npx vitest run test/audit/db.audit.test.ts -t "D-13" is green; the 5.3-G query in the data-model report returns only the who-did-it columns. | Test output. | ☐ |
| GL-023 | updated_at is maintained by the database, updated_by exists, and a generic row-audit trigger covers the business tables, so a change made outside the app still leaves a trail. | RC-030 (DAT-15, ENG-10) | Dev | Update a party in SQL and find one row in the audit table with the session user; after update items set mrp = 1 the updated_at has moved without the app. | SQL output. | ☐ |
| GL-024 | Enums that gate logic are kept, the rest are text with CHECK, and the roles "store" and "stores" are merged. | RC-044 (DAT-17) | Dev | select typname, count(*) from pg_enum e join pg_type t on t.oid = e.enumtypid group by 1 shows only posted_status, invoice_doc_type, invoice_status, payment_direction, movement_type and reservation_status; no user has role "store". | Query output. | ☐ |
| GL-025 | Duplicate emails and SKUs by case are refused, GSTIN and PAN formats are checked, and state codes come from a lookup. | RC-045 (DAT-19) | Dev | npx vitest run test/audit/db.audit.test.ts -t "D-16|D-15" is green. | Test output. | ☐ |
| GL-026 | The three big log tables are partitioned by month while still empty. | RC-046 (DAT-22) | Dev | select relname, relkind from pg_class where relname in ('audit_log','access_log','error_log') shows p for each. | Query output. | ☐ |
| GL-027 | Prices and unit costs hold more than 2 decimals; a rate of 0.375 is stored exactly. | RC-008 (DAT-01) | Dev | npx vitest run test/audit/db.audit.test.ts -t "D-12" is green; a PO for 100,000 at 0.375 bills 37,500.00. | Test output. | ☐ |
| GL-028 | Foreign-currency documents keep the foreign amount, the rate and the rupee amount. CA has confirmed year-end revaluation treatment (CA Q32, unsettled until answered). | RC-009 (DAT-02) | Dev; CA | A USD 10,000 bill at 84.00 paid in $4,000 at 83.50 and $6,000 at 83.40 leaves a foreign balance of exactly 0.00 and a gain of exactly 5,600.00 rupees (register test). CA note on Q32 filed. | Test output; CA note. | ☐ |
| GL-029 | Decision recorded: v1 is single company (Option A, recommended for go-live) or the second entity is fully built (Option B). For Option A the "Add a company" form is hidden and creating one is refused. Owner states whether a second GSTIN is likely within a year. | RC-010 (DAT-03, ARC-15, TRD-20) | Owner decides, Dev builds | Option A: as admin, POST /api/masters/entities answers 409 with the flag off and the Admin form is gone. Option B: the two-entity story test passes. | Signed decision; response or test output. | ☐ |

## 2.5 Money, GST and payroll rules
| ID | Condition | Source | Who verifies | How to verify | Evidence to save | Status |
| GL-030 | The filed-month GST lock guards sales documents when either GSTR-1 or GSTR-3B is filed. What was filed is recorded, and the current month cannot be marked filed. | RC-012 (ENG-03, FIN-07, FIN-27) | Dev; CA reviews the behaviour | Tests ACCT-1, F-01b, ACCT-7 pass. On a test copy mark October filed, edit data directly, call GET /api/gst/filings/check: it reports one difference with the amount. | Test output; check response. | ☐ |
| GL-031 | No input credit is claimed on bills from suppliers with no GSTIN, composition dealers or foreign suppliers with a blank state. Every supplier has a registration type. | RC-014 (FIN-02, FIN-03, TRD-04) | Dev; CA confirms the rule (CA Q4) | Tests ACCT-8 (grand 1,00,000, ITC 0) and F-02 pass; a bill from a supplier without GSTIN posts no input tax lines; a bill with entered tax 1,790 against computed 1,800 posts 1,790 and flags the mismatch. | Test output; CA note on Q4. | ☐ |
| GL-032 | Moving the period lock back needs the owner. A year reopen moves the lock as recorded. A lock date of 2099 is refused. | RC-039 (SCA-12, FIN-12) | Dev | Tests ACCT-5 and F-03b pass; an accountant moving the lock earlier gets 403 and the owner 200. | Test output. | ☐ |
| GL-033 | A payroll reopen or re-approval of a past month uses that month's rules, PT, PF and leave policy and books the reversal on the booked date. | RC-013 (PPL-03, PPL-06) | Dev | Test "H-01 reopen + re-approve keeps the PT in force in March" passes; a reopen after the lock date is refused before anything changes. | Test output. | ☐ |
| GL-034 | Opening stock is dated at the cut-over date, cannot be approved by the person who raised it, and the opening import closes for good once the owner closes it. | RC-038 (FIN-09, ENG-02, ENG-15) | Dev | Tests ACCT-4 (two) and ACCT-6 pass; trade.audit.test.ts S-11 (both) pass; importing items with as_of the last day of the previous month shows stock value at that date. | Test output. | ☐ |
| GL-035 | A payroll user cannot pay themselves a cash advance, and unlinking one's own employee record does not escape the self-pay checks. | RC-034 (SCA-05, PPL-01, PPL-02) | Dev | Tests "H-11 HR cannot pay themselves a salary advance", PEOPLE-1 and PEOPLE-2 pass; an advance above the limit stays pending until a different user approves. | Test output. | ☐ |
| GL-036 | The person who prepares or adjusts a payroll run cannot approve it, the approver approves the exact figures shown, and the person who approved cannot pay above the owner's threshold. | RC-035 (SCA-06, PPL-07) | Dev | Test "H-11 the person who adds 15,000 arrears to a payslip cannot also approve the run" passes; approving with a stale expected_version returns 409. | Test output. | ☐ |
| GL-037 | A change of an employee's bank account is in the audit trail and needs a second person. | RC-036 (PPL-04) | Dev | Change a bank account via PUT /payroll/staff/:id and read audit_log for pay_details: old and new last-four are recorded. | Query output. | ☐ |

## 2.6 Access control, audit and personal data
| ID | Condition | Source | Who verifies | How to verify | Evidence to save | Status |
| GL-038 | Every login, password change and export leaves an audit row with address and device. | RC-031 (ENG-09, SCA-20, AIX-04) | Dev | The four E-17 tests in auth.audit.test.ts pass; the "every mutating route is audited or on the exemption list" test passes; one login and one CSV export each add one row. | Test output. | ☐ |
| GL-039 | Nobody with user-management rights can create an owner or take over the owner. The Permissions screen refuses to grant non-delegable powers and conflicting pairs. | RC-033 (SCA-03, SCA-24) | Dev | The two failing A-01 tests in auth.audit.test.ts pass; granting users:manage to hr returns 400; granting stock:approve to stores returns 400. | Test output. | ☐ |
| GL-040 | The person who makes a change cannot also approve it: adjustments, purchase orders, price lists, service bills, payments out. | RC-037 (SCA-11, TRD-05, TRD-24) | Dev | trade.audit.test.ts "TRADE-7 an approver's own PO above the limit still needs a second person" passes; for each flow, creator approving own item gives 403 and a different approver 200. | Test output. | ☐ |
| GL-041 | Personal-data masking and the "who looked" log cover lists, the phone lookup and exports, and the application login cannot delete the log. | RC-040 (SCA-15, SCB-14) | Dev | Tests AUTH-P1, AUTH-P2, AUTH-P3 and "DB-2: the DPDP access log is append-only" pass; access-log.test.ts shows every route that returns phones writes a log row. | Test output. | ☐ |
| GL-042 | A salesperson sees only their own leads and cannot page out the whole phone list. | RC-041 (SCA-01, PPL-10, AIX-11) | Dev | Tests "A-04 a salesperson cannot read a lead owned by a colleague", "cannot reassign a colleague's lead" and AUTH-L2 pass; as a sales user GET /api/leads?limit=5000 returns at most 200 rows or only own leads. | Test output; response sample. | ☐ |
| GL-043 | Routes return only what the caller's role may see (no open invoices, PAN or cost fields to roles without the power). This must hold before any AI layer is added. | RC-042 (AIX-02) | Dev | Role-by-endpoint tests: technician GET /api/parties/:id has no open_invoices, pan or unmasked phone; operations GET /api/jobwork/:id has no cost fields. | Test output. | ☐ |
| GL-044 | Salary and full bank account numbers are not shown to every payroll reader. Lists show the last four digits, the full number needs a logged reveal. | RC-043 (PPL-23, WEB-37) | Dev | An accounts-role session gets masked accounts from /payroll/staff; the payroll list shows •••• 1234; access_log has a row for the salary-list read. | Screenshot; query output. | ☐ |
| GL-045 | Public link tokens are stored hashed, with a visible last four, and are shown in full only once. | RC-047 (DAT-18, SCB-16) | Dev | select count(*) from invoice_links where token is not null prints 0 after the migration; tests DB-8 and AUTH-9 pass. | Query output. | ☐ |
| GL-046 | Invoice and estimate links expire, can be revoked, are minted only by a role with invoices:share, and send no-store headers. | RC-048 (SCB-07, SCA-13, TRD-28) | Dev | Tests "A-06 a read-only role cannot mint a public invoice link" and "A-06 a public invoice link can be revoked or carries an expiry" pass; an expired estimate token returns 410. | Test output. | ☐ |
| GL-047 | A payslip link returns only the fields the employee needs (masked account, no IFSC, no company bank), is no-store, can be revoked by HR, and the WhatsApp text does not carry net pay. | RC-049 (PPL-16, SCB-08) | Dev; HR | Open a payslip link in a private window: account shows last four only, no IFSC; curl -sI <link> shows Cache-Control: no-store; tests H-04 in people.audit.test.ts and auth.audit.test.ts pass; HR revokes a link and it stops working. | Screenshot; header output. | ☐ |
| GL-048 | A failed database query puts no names, phones, PAN, bank details or link tokens into the error log, console or alert channel. The error tracker scrubs a fake PAN. | RC-007 (ARC-11, SCB-04, OPS-08, AIX-07); area-10 App D #15 and #35 | Dev | npx vitest run test/audit/infra.audit.test.ts -t "INFRA-3|I-08" passes; after a forced 22001 error select message, detail from error_log contains no phone number; send an error containing AAAAA0000A and the tracker issue shows no PAN. | Test output; screenshot of the tracker issue. | ☐ |
| GL-049 | Personal data can be erased or anonymised and time-limited, including audit and event copies. Owner has chosen the retention period N. Counsel has reviewed the schedule (DPDP dates are unsettled, counsel to confirm). | RC-011 (DAT-16, SCB-05, PPL-26, INT-19) | Dev; Owner; Counsel | Test "E-27 an erasure request removes the phone and email from every table (incl. audit_log, error_log)" passes; select count(*) from audit_log where after::text like '%<test phone>%' prints 0; housekeeping removes personal fields from old processed events. | Test output; signed retention schedule. | ☐ |
| GL-050 | The public enquiry form shows a versioned privacy notice and an unticked consent box. Consent cannot be recorded for someone else's number, a repeat enquiry does not change consent, and imported leads with no consent are not put on a follow-up plan. | RC-032 (PPL-24, SCB-10, WEB-27) | Dev; Counsel approves the text | Test "H-15 an imported lead with no consent recorded is not put on the default follow-up plan" passes; public-consent.test.ts: an enquiry without the checkbox is refused and a repeat enquiry on a lost lead leaves stage and consent untouched. | Test output; approved notice text and version. | ☐ |

Gate 0 passes when every line above is ☑ (or [~] for an unused, verified-off feature only) and the Gate 0 row of section 8 is signed.
# 3. Gate 1: before the parallel month with Vyapar
Real Vyapar data first enters the production system in group 3.1, after Gate 0.
## 3.1 Data migration from Vyapar
| ID | Condition | Source | Who verifies | How to verify | Evidence to save | Status |
| GL-051 | The owner supplies real Vyapar exports: All Parties Report (receivable and payable), item details, Stock Summary, Day Book, GSTR-1, sales and purchase registers, Balance Sheet, and an item serial list. Vyapar support has been asked whether bill-wise outstanding can be exported. | RC-119 (FIN-23); area-13 App B | Owner | List the files with date, report name and who exported them. Masked copies (names, phones, GSTIN, bank numbers replaced) sit in apps/api/test/fixtures/vyapar/. | Folder listing; Vyapar support reply on bill-wise outstanding. | ☐ |
| GL-052 | The importers read the files Vyapar actually produces: .xlsx, tab or semicolon CSV, Windows-1252 text, files larger than 1 MB. | RC-117 (LIB-03, INT-25, WEB-22) | Dev | Tests in bank.test.ts and opening.test.ts pass (an .xlsx round-trips, a tab-separated file parses, a 5 MB CSV imports, "Café Ünïcode ₹" and a Hindi UTF-8 file round-trip); with the real files the preview shows names correctly ("do these names look right?"). | Test output; preview screenshot. | ☐ |
| GL-053 | A full dry run of every import step on a copy of production, with the real files, reports zero problems. The party and stock totals equal Vyapar's own report totals. The header row is found even when title lines sit above it (the reviewers advise doing this well before the parallel month). | RC-119 (FIN-23) | Dev; Accounts checks totals | Admin > Opening, each step with dry_run left on (the default): problem list is empty; the totals shown equal the totals printed on the Vyapar reports. | Screenshots of each dry run; totals sheet. | ☐ |
| GL-054 | Every goods item has an HSN of 4 to 8 digits (the "hsn missing" fix-up is done) and a GST rate from the rate list. The CA has said how many HSN digits apply to Radboards' turnover (unsettled, CA Q17). | RC-119 (FIN-23); area-13 FIN-23, CA Q17 | Accounts; CA | Dry run of the items step reports no "HSN needed" rows; CA reply on Q17 filed. | Dry run screenshot; CA reply. | ☐ |
| GL-055 | Step 1, parties: customers, dealers and suppliers loaded with GSTIN, state, phone, credit terms and a registration type for every supplier. Counts and balances tie to Vyapar. | RC-119 (FIN-23); RC-014 (FIN-02, FIN-03, TRD-04); area-13 App B | Accounts; Owner signs the tie-out | After the live import: party count by type equals the Vyapar All Parties Report; total receivable and total payable equal the report totals; no GSTIN checksum errors; no duplicate GSTIN, phone or name within a type. | Tie-out sheet with both totals side by side. | ☐ |
| GL-056 | Step 2, items: items with HSN, rate, unit and prices, plus serial numbers of stocked vehicles and batteries. Opening stock is dated at the cut-over date, raised by one person and approved by a different person. | RC-119 (FIN-23); RC-038 (FIN-09, ENG-02, ENG-15); area-13 App B | Accounts raises; Owner or Store lead approves | Item count, per-item quantity, total quantity and total stock value equal the Vyapar Stock Summary; serial count per vehicle item equals the Vyapar serial list; the balance sheet at the cut-over date shows the opening stock value. Stock valuation basis difference (Vyapar basis against RadCore moving average) is written down (unsettled, CA Q27). | Tie-out sheet; screenshot of the approval by a second user; CA reply on Q27. | ☐ |
| GL-057 | Step 3, account balances: cash, each bank account (created first), loans, capital, TDS receivable and payable, and the GST credit carried forward (Input CGST, SGST, IGST) from the last filed GSTR-3B or credit ledger. | RC-119 (FIN-23); area-13 App B | Accounts; CA confirms the GST credit figures | Each balance equals the Vyapar Balance Sheet or the filed GSTR-3B; Opening Balance Equity equals the sum of the opening entries and has no other movement. | Tie-out sheet; copy of the last filed GSTR-3B. | ☐ |
| GL-058 | Open documents: every unpaid sales invoice and unpaid purchase bill is in RadCore one by one (number, date, due date, party, place of supply, amount outstanding, one summary line) with origin vyapar_opening, so returns, credit notes and reminders work and the import does not enter the current GSTR-1. | RC-120 (FIN-10); RC-038 (FIN-09, ENG-02, ENG-15); RC-119 (FIN-23) | Dev; Accounts checks | Import one old invoice of Rs 5,900 on a test copy and raise a credit note for half: the party balance falls by Rs 2,950 and GSTR-1 for the current month shows the credit note only. Live: per-party open documents add up to that party's balance, and their total equals the Debtors (and Creditors) control account. | Test output; per-party tie-out sheet. | ☐ |
| GL-059 | Decision recorded: serial numbers of vehicles already sold are loaded as sold-before-cut-over (so warranty job cards can be raised), or the owner accepts re-entering them on the first warranty job. | RC-120 (FIN-10); area-13 FIN-10(d) | Owner decides | Signed decision; if loaded, serial count equals the Vyapar sale report with serials. | Decision; count. | ☐ |
| GL-060 | Employees and pay set-up: monthly salary, PF and ESIC applicability, PT, bank account, UAN and ESIC numbers, and leave taken since 1 April are loaded by HR from the existing payroll records (Vyapar holds none of this). | RC-104 (PPL-08); area-13 App B; area-15 App A | HR; Owner checks a sample | Every active employee in the Vyapar-era payroll record appears once in RadCore with the same monthly salary; HR initials every row; Owner checks a sample of rows against payslips. | Signed staff list. | ☐ |
| GL-061 STOP | The CA has decided the cut-over date (mid-year or 1 April) and how the year's profit and loss before the cut-over, TDS and payroll totals so far, and GSTR-9 are handled. The CA has said whether carrying customer balances is enough or old invoices must exist in RadCore for Section 34 credit notes (unsettled). | area-13 CA Q26, Q28 | CA; Owner | Written CA note covering Q26 and Q28. | CA note. | ☐ |
| GL-062 | After all steps, the books tie out: Debtors account equals the sum of party receivables, Creditors likewise, Stock in Hand equals the stock ledger value, Opening Balance Equity equals the opening entries, the trial balance balances. | RC-119 (FIN-23); RC-063 (ENG-25, TRD-23, TST-04); area-13 App C checks 1, 2, 7, 8 | Dev; Accounts | npm run integrity -- <production url> exits 0; Health check screen shows no findings. | Command output; screenshot. | ☐ |
| GL-063 | The opening import is closed: the owner sets opening_closed_on after the tie-out is signed. No further import step can run. | RC-038 (FIN-09, ENG-02, ENG-15) | Owner | POST /api/opening/<kind> for each step now answers 409. | Response for each step. | ☐ |
| GL-064 | A labelled backup is taken immediately after the import and a restore of it matches the tie-out sheet. | RC-001 (OPS-01, OPS-14); RC-016 (OPS-02, HST-02) | Dev | Restore into a side database; npm run integrity -- <side url> exits 0; party, item and account totals equal the sheet. | Restore log; totals. | ☐ |
| GL-065 | Migration sign-off: Owner, Accounts and CA sign the opening tie-out sheet. | area-13 App B, App C | Owner; Accounts; CA | Signatures on the sheet that lists every total from the lines above. | Signed sheet. | ☐ |

## 3.2 Environment: hosting, domain and TLS
| ID | Condition | Source | Who verifies | How to verify | Evidence to save | Status |
| GL-066 | Production runs on a company domain (for example erp.<company domain>) used from day one. Meta, WhatsApp and Shopify webhooks and the cookie point at it. | area-12 HST 10.3 Phase 0 | Dev; Owner | curl -sI https://DOMAIN/login returns 200; each webhook configuration screenshot shows the domain. | Screenshots. | ☐ |
| GL-067 | TLS is valid and renewing. | area-10 App D #17 | Dev | openssl s_client -connect DOMAIN:443 -servername DOMAIN </dev/null | openssl x509 -noout -dates shows 60 or more days left; the TLS monitor is green. | Command output. | ☐ |
| GL-068 | The domain is registered to the company, registrar login has MFA, and an expiry alert exists (rule: warn under 30 days). TLS expiry alerts exist (under 14 days P2, under 5 days P1). | area-10 App A.4 rule 4, 5; area-12 | Owner; Dev | Registrar page screenshot shows MFA on and expiry date; alert rules loaded. | Screenshots. | ☐ |
| GL-069 | Cloud account (under Radboards Pvt Ltd), DNS, registrar and GitHub accounts have MFA. The cloud root user has MFA, a budget alert is set, provider snapshots are on, and a second person holds break-glass access. | area-10 App D #27; area-12 HST 10.3 Phase 0 | Owner; Host | Screenshot of each security page. | Screenshots filed. | ☐ |
| GL-070 | Host baseline: SSH by key only with no root login, only ports 22 (restricted), 80 and 443 open, automatic security updates, clock synchronised with zone Asia/Kolkata, Docker log rotation set, swap present. | RC-015 (ARC-16, HST-10); RC-076 (OPS-27); area-10 App D #22 to #26 | Dev | sudo sshd -T | grep -E '^(passwordauthentication|permitrootlogin)' shows no / no (or prohibit-password); sudo ufw status verbose; from outside nmap -Pn -p- IP shows only 22, 80, 443; systemctl is-active unattended-upgrades active; timedatectl shows synchronized and Asia/Kolkata; cat /etc/docker/daemon.json shows max-size; free -h shows swap. | Command outputs. | ☐ |
| GL-071 | Caddy config is valid, security headers are present and an access log is written. | RC-074 (OPS-21, OPS-22); RC-146 (SCB-06, WEB-24, SCB-19); area-10 App D #16 | Dev | caddy validate; curl -sI https://DOMAIN/login shows x-frame-options and x-content-type-options; docker compose exec caddy tail -1 /data/access.log is a JSON line. | Command outputs. | ☐ |
| GL-072 | The image has no development dependencies; containers have memory limits and log rotation. | RC-072 (ARC-21, LIB-02, OPS-18); RC-075 (OPS-19); area-10 App D #18 and #19 | Dev | docker run --rm IMAGE sh -c 'ls node_modules/.bin | grep -c -E "vitest|drizzle-kit|tsx"' prints 0; docker inspect --format '{{.Name}} {{.HostConfig.Memory}} {{.HostConfig.LogConfig.Config}}' $(docker compose ps -q) shows limits and max-size. | Command outputs. | ☐ |
| GL-073 | Database lock, statement and connection timeouts are set so one stuck transaction cannot freeze billing. | RC-080 (ARC-06, ENG-13, OPS-16); area-10 App D #14 | Dev | As radcore_app show lock_timeout prints 15s. | Output. | ☐ |
| GL-074 | The secret inventory is complete (name, purpose, where used, how to rotate, who is told) and secrets are held in two places the server's loss cannot touch (password manager and printed safe copy). | RC-002 (OPS-05, OPS-23); area-10 App D #20 | Dev; Owner | Inventory has a row per variable in .env.production; owner opens the password manager and finds the backup key and the database owner password. | Inventory; owner initials. | ☐ |
| GL-075 | The residency register's "decision needed" rows are decided: captcha provider (Cloudflare Turnstile), statements mailbox (Indian host preferred), image registry region. | RC-018 (OPS-10, HST-01); area-10 App E.2 | Owner | Register rows updated with the decision and date. | Updated register. | ☐ |
| GL-076 | A calendar holds the expiry of every secret and token that lapses (Meta page token, WhatsApp token, IMAP app password, TLS, domain) with a monthly review. | area-10 App C7 | Dev | Calendar entries exist; the first monthly review is booked. | Calendar screenshot. | ☐ |

## 3.3 Backups running and first restore drill
| ID | Condition | Source | Who verifies | How to verify | Evidence to save | Status |
| GL-077 | Backups run on their own and are watched: the backup, WAL archive and uploads heartbeats each arrived inside their period for at least one full cycle before the parallel month. | RC-001 (OPS-01, OPS-14); RC-016 (OPS-02, HST-02); area-10 App D #29 | Dev | The uptime monitor shows backup, WAL, scheduler, integrity and restore-test monitors green with a ping inside their period. | Screenshot of the monitor page. | ☐ |
| GL-078 | The first restore drill on the production setup has passed: restore to a point in time on a separate VM, canary, integrity, key-table counts against the manifest, uploaded files sampled, report sent. | RC-017 (OPS-03, OPS-13, OPS-33); area-10 App B.8 | Dev; Owner reads the report | The report in the reports bucket shows every check passed and the measured restore time; the restore-test monitor is green. | The report file. | ☐ |
| GL-079 | The uploads backup is incremental (not the whole folder every day) and under 26 hours old. | RC-070 (HST-04); area-10 App D #7 | Dev | restic snapshots --latest 1 is under 26 hours old; disk growth per day is recorded. | Output. | ☐ |

## 3.4 Monitoring, with alerts tested by deliberately failing something
| ID | Condition | Source | Who verifies | How to verify | Evidence to save | Status |
| GL-080 | /api/ready checks the database, migrations, the scheduler and the uploads folder. Two external probes in different places watch it. | RC-083 (OPS-07, OPS-06, ARC-18); area-10 App D #28 | Dev | curl -s -o /dev/null -w '%{http_code}' https://DOMAIN/api/ready prints 200; both monitors green; a test that holds all pool connections returns 503 within 3 seconds. | Command output; monitor screenshot. | ☐ |
| GL-081 | Alert rules load and pass their own tests. | RC-083 (OPS-07, OPS-06, ARC-18); area-10 App D #30 | Dev | promtool check rules rules.yml and promtool test rules tests.yml pass. | Output. | ☐ |
| GL-082 STOP | Deliberate failure 1, API down: stopping the API produces a phone alert within 3 minutes. | RC-083 (OPS-07, OPS-06, ARC-18); area-10 App D #31 | Dev; Owner receives the call or push | docker compose stop api; note the time of the alert; docker compose start api. | Time stopped, time alert arrived, screenshot of the alert. | ☐ |
| GL-083 STOP | Deliberate failure 2, backup missing: stopping the backup job produces a missing-heartbeat alert. | RC-083 (OPS-07, OPS-06, ARC-18); area-10 App A.4 rule 16 | Dev | Stop the backup service and let the heartbeat period pass (the production period is 26 hours; for the test use the monitor's shortest period and record which you used). | Alert screenshot; period used. | ☐ |
| GL-084 STOP | Deliberate failure 3, disk: a test volume filled past 90 percent produces the disk alert. | RC-083 (OPS-07, OPS-06, ARC-18); area-10 App D #32 | Dev | Fill a test volume (never the data volume) and wait for the alert. | Alert screenshot. | ☐ |
| GL-085 | Deliberate failure 4, scheduler: the job loop is running (last run under 35 minutes) and a scheduler that stops sending its heartbeat raises the scheduler-stalled alert. | RC-082 (ARC-08, AIX-06, LIB-07, ENG-24, OPS-25, HST-07); RC-083 (OPS-07, OPS-06, ARC-18); area-10 App D #39 | Dev | curl -s https://DOMAIN/api/ready shows the last run time under 35 minutes; Admin > System health agrees; make the job loop miss its heartbeat as the runbook describes and wait for the alert. | Output; alert screenshot. | ☐ |
| GL-086 STOP | The alert path itself is proved every week: a Monday 10:00 test alert reaches the on-call person and is acknowledged. The on-call roster is signed and a test P1 call reaches the primary (escalates to the secondary if unacknowledged at 15 minutes). | RC-083 (OPS-07, OPS-06, ARC-18); area-10 App D #33, #34 | Owner; Dev | First Monday test acknowledged; roster signed. | Roster; acknowledgement screenshot. | ☐ |
| GL-087 | Stuck webhook events are retried and reported: a Meta lead that failed for a missing token is created by the next job run once the token is set; after 8 failures the event is dead and an alert is raised. If Meta lead intake is not used, it is switched off and recorded. | RC-084 (INT-01, INT-15) | Dev | webhook-retry.test.ts passes; in the live system the dead-events count shown on System health is 0. | Test output; screenshot. | ☐ |

## 3.5 Access
| ID | Condition | Source | Who verifies | How to verify | Evidence to save | Status |
| GL-088 | Every user account belongs to a current employee, has the least role needed, and no login is shared. Former staff are deactivated by hand, because recording an exit does not switch off the sign-in. | RC-033 (SCA-03, SCA-24); RC-092 (SCA-09) | Owner; Dev | Admin > Users list printed and annotated line by line against the staff list. | Signed user list. | ☐ |
| GL-089 | The Permissions screen has been compared with the permission matrix in area-04 Appendix A. Only the people the owner names hold users:manage, settings:manage, books:reopen and gst:unfile. | RC-033 (SCA-03, SCA-24); area-04 App A | Owner; Dev | Screenshot of the Permissions screen annotated; differences from App A explained. | Annotated screenshot. | ☐ |
| GL-090 STOP | MFA (TOTP) is on for every admin, owner, accounts and HR user, recovery codes are stored by the owner, and sensitive actions (payroll pay, period lock change, user and permission change, bank detail change) ask for a recent step-up. | RC-055 (SCA-02) | Dev; Owner | A sign-in with the right password and no code returns mfa_required and sets no cookie; POST /payroll/runs/:id/pay without a recent step-up returns 403; no user in those four roles has a null mfa_enabled_at. | Output; list of enrolled users. | ☐ |
| GL-091 | Password guessing is limited per account and per address in the database, successful sign-ins do not count against the limit, and a rotated X-Forwarded-For does not bypass the limiter. | RC-089 (SCA-04, ARC-22) | Dev | Tests "A-03" (account lockout and the X-Forwarded-For bypass) pass; 25 different users log in successfully from one address, and 11 wrong passwords for one user return 429. | Test output. | ☐ |
| GL-092 STOP | No default or demo password exists: every user has set their own, the shared demo password (radcore-demo) is refused for every user, demo data is off. | RC-021 (SCA-22, HST-12); area-04 App D1 | Dev | Try radcore-demo for each active user: refused; grep -c '^SEED_DEMO_DATA=false' .env.production prints 1. | Result table. | ☐ |
| GL-093 | The people who hold the owner role are named in writing, and the number is the smallest that lets the business run when one is away. A break-glass account for the cloud and password manager is held by a second named person. | area-04 SCA-03, SCA-12 | Owner | Admin > Users filtered to role owner lists exactly the named people. | Screenshot; signed note. | ☐ |
| GL-094 | Separation of duties is proved with real accounts: the creator cannot approve their own PO, payroll preparer cannot approve, an accountant cannot move the period lock back, a user with user-management rights cannot create an owner. | RC-035 (SCA-06, PPL-07); RC-037 (SCA-11, TRD-05, TRD-24); RC-039 (SCA-12, FIN-12) | Second person tests; Owner watches | Try each action as the wrong person and save the refusal. | Screenshots of each refusal. | ☐ |
| GL-095 | The public enquiry form's captcha and strict rate limit hold on every route that accepts the campaign token, including the website-form webhook. The campaign token is not the Google Ads credential. If public lead forms are not used at go-live, they are switched off and recorded. | RC-054 (SCA-14, SCB-01, INT-12, PPL-25, SCA-18) | Dev | Tests "A-02" (captcha on, token does not let a bot post leads through /api/hooks/form, and the Google Ads variant) and H-19 pass. | Test output. | ☐ |
| GL-096 | A live security test has been done (one is quoted separately), or the owner has written down that go-live proceeds without one. Findings of Serious or above are closed. | RC-054 (SCA-14, SCB-01, INT-12, PPL-25, SCA-18); RC-055 (SCA-02); RC-089 (SCA-04, ARC-22); RC-144 (INT-02, SCB-03); proposal "Not included" | Owner decides | Test report, or signed owner decision. | Report or decision. | ☐ |

## 3.6 Integrations (each line passes, or the feature is switched off and the switch is verified)
| ID | Condition | Source | Who verifies | How to verify | Evidence to save | Status |
| GL-097 | Shopify: a cancellation that arrives before its order does not let the cancelled order in, a replayed signed body cannot cancel a live order, and edits, payments and refunds after the first message are applied. If Shopify is not connected, it is off. | RC-067 (INT-06, SCB-17); RC-085 (INT-05) | Dev | Tests "A-13 a captured signed orders/create body replayed with X-Shopify-Topic: orders/cancelled does not cancel the order" and "S-07 a Shopify order edited after it came in (2 to 1) is updated here" pass. | Test output. | ☐ |
| GL-098 | Marketplace import: no sales user can create confirmed orders at any price; blank prices do not become Rs 0. | RC-065 (INT-04, TRD-22) | Dev | Tests "S-08 a marketplace row with no price is not confirmed at 0" and "TRADE-8 a sales user cannot confirm an order below cost by uploading a marketplace report" pass. | Test output. | ☐ |
| GL-099 | A bank CSV with an unquoted "9,111.00" imports as Rs 9,111, rows with unreadable dates are reported, and a crafted cell cannot freeze the API. | RC-118 (INT-07, SCB-02) | Dev | Tests "INFRA-5" (three) pass; bank-csv-redos.test.ts: a balance cell of 1 + 50,000 spaces + 1 returns invalid in under 200 ms. | Test output. | ☐ |
| GL-100 | Bank statement by email: only the bank's exact domain with DMARC pass is accepted, lines that arrived by email are never auto-matched to receipts, matching needs a payment reference, and a statement is filed under the right account or held. If statement intake by email is not used, it is off and statements are uploaded by hand. | RC-144 (INT-02, SCB-03); RC-145 (INT-03); RC-066 (INT-08) | Dev | Tests "I-01 a statement from a look-alike domain...", "INFRA-1", "INFRA-2", "INFRA-4", "I-01 a line that arrived by email is not reconciled automatically against a receipt in the books" pass; bank-mail.test.ts "a CSV for the second account is filed under the second, or held" passes. | Test output. | ☐ |

## 3.7 Security fixes accepted
| ID | Condition | Source | Who verifies | How to verify | Evidence to save | Status |
| GL-101 | The security fixes made on the separate copy of the code have each been read and accepted by the developer and merged by pull request into the protected main branch. | proposal "What you receive"; RC-051 (TST-02, OPS-09) | Dev; Owner | List of merged pull requests, one per register item, each with a reviewer who is not the author. | Acceptance log. | ☐ |

## 3.8 CI green and required, and the release process
| ID | Condition | Source | Who verifies | How to verify | Evidence to save | Status |
| GL-102 STOP | main is protected: pull request, one approval, required checks test, postgres and docker, no force-push, CODEOWNERS on the engine, sales, payments, payroll and accounting folders. | RC-051 (TST-02, OPS-09); area-10 App D #11 | Dev | gh api repos/OWNER/REPO/branches/main --jq .protected prints true; a direct push to main is rejected. | Output. | ☐ |
| GL-103 | A release is a tag whose images were built and tested by CI; the server pulls the tag and refuses a red build. | RC-051 (TST-02, OPS-09); area-10 App D #12 | Dev | ./deploy/update.sh v0.0.0-red exits 1 "no such image"; git describe --tags on the server shows the tag. | Output. | ☐ |
| GL-104 | The migration runner takes a lock, runs one transaction per migration and a failed release returns to the previous tag by itself. A rollback was rehearsed once. | RC-052 (DAT-05, OPS-12) | Dev | Tests D-09 (PG16), the three D-14 probes and D-18 pass; deploying a tag whose /api/ready returns 503 ends with the previous tag running and exit 1; ./deploy/rollback.sh <previous tag> run once and the time recorded. | Test output; rollback log. | ☐ |
| GL-105 | Item locks do not block unrelated inserts and the known deadlock pairs are fixed and proved on real PostgreSQL. | RC-053 (ENG-11, ENG-12, TST-03) | Dev | Tests P8a and P8b: both operations of each pair fired together 30 times on PostgreSQL 16 give no 40P01. | CI log. | ☐ |
| GL-106 | The money tests catch breakage: each of the 25 mutations in the tests report (section 5.1) makes at least one test fail, including round-off posting and the give-back, and two hand-worked round-off cases exist (3 boards at 1,234.50 gives 3,703.50 plus 12 percent GST 444.42, grand total 4,148.00, round-off +0.08). | RC-069 (TST-05, TST-06, TST-15) | Dev | Apply each mutation on a scratch branch and run the named test file. | Mutation table with result. | ☐ |
| GL-107 STOP | The books-healthy check compares per document, per item and per tax account, reads one snapshot, and fails on an empty restore. It runs nightly and its result is on the Health check screen. | RC-063 (ENG-25, TRD-23, TST-04) | Dev | The S-19 sequence test makes expectBooksHealthy throw before the fix and pass after; TRADE-1, S-13 and TRD-06 reproductions list a finding on the unfixed code. | Test output. | ☐ |
| GL-108 | A failed save reuses its retry key, and Receive goods and Save bill cannot create two documents. | RC-133 (WEB-01, WEB-11, WEB-34, TRD-06, WEB-35) | Dev | Playwright "retry after a lost reply reuses the key"; a double click on Save receipt and Save bill creates exactly one document; the lint rule fails on a deliberate bare post(). | Test output. | ☐ |
| GL-109 STOP | All required checks are green on the exact release tag that will run in the parallel month. | RC-005 (TST-01, TST-16); RC-051 (TST-02, OPS-09) | Dev | gh run list --branch main --limit 10 and the tag's run show success. | Run link. | ☐ |
| GL-110 | The deploy runbook is written: preconditions (CI green for the tag, change list read, not within 2 hours before payroll, GST filing or month-end close unless urgent, a 5-minute notice to staff), steps, verification and record. | area-10 App C1 | Dev | docs/RUNBOOK.md section C1 exists and was followed for the last deploy. | Deploy record. | ☐ |

## 3.9 The books behave (Wave 2 Serious rules that change figures)
| ID | Condition | Source | Who verifies | How to verify | Evidence to save | Status |
| GL-111 | A supplier bill is held against the PO and goods received when it differs beyond tolerance; held bills do not post; the price difference clears Goods Received Not Billed. | RC-056 (TRD-03, FIN-18) | Dev | Tests "S-03 a bill for more than was received is refused (or held)", "S-03 a bill at a different rate clears GRNI" and F-07 pass; PO Rs 100 and bill Rs 110 leaves GRNI at 0. | Test output. | ☐ |
| GL-112 | Reverse charge is posted and shown on GSTR-3B (3.1(d), 4(A)(2) and 4(A)(3)). The CA has defined which suppliers and services (ad services, overseas services, transport, legal) attract it (unsettled, CA Q6). | RC-057 (FIN-05) | Dev; CA | A USD 1,000 ad bill from an overseas supplier at 18 percent at 84 rupees to the dollar shows IGST 15,120 in 3.1(d) and 4(A)(2), and Output and Input IGST both rise by that amount. | Test output; CA reply on Q6. | ☐ |
| GL-113 | Expenses claim input credit only where the category allows it and the vendor's state matches the tax head. Starting categories are set by the CA (unsettled, CA Q5). | RC-058 (FIN-04, FIN-25) | Dev; CA | Test F-08 passes; a Travel expense with GST posts 0 to Input GST; a Karnataka vendor with intra-state type returns 400; a heading account is refused as a category account. | Test output; CA category list. | ☐ |
| GL-114 | TDS is calculated from the bill's date, the party's year-to-date total and the section's limits, with the no-PAN rate. The FY 2026-27 table (section, rate, single and yearly limit, no-PAN rate) is supplied by the CA and loaded (unsettled, CA Q18 to Q21). | RC-060 (FIN-08) | Dev; CA | Tests F-11a and F-11b pass; a Rs 5,000 contractor payment returns TDS 0; Rs 25,000 then Rs 80,000 to the same contractor deducts on the full amount. | Test output; CA table. | ☐ |
| GL-115 | The dealer's credit limit and overdue bills are checked at confirmation, delivery, invoice and repaired-vehicle handover. | RC-061 (TRD-02, TRD-18) | Dev | Test "S-02 the credit limit is re-checked at delivery or invoicing" passes; with an overdue invoice, moving a job to approved returns the credit warning and delivering with override_credit by accounts succeeds. | Test output. | ☐ |
| GL-116 | Negative-stock mode leaves no phantom stock value. If negative stock is not allowed at Radboards, the owner records that and the setting is off. | RC-062 (ENG-01) | Dev; Owner | Tests "S-19 with negative stock allowed, stock back at zero carries no value" and P2 pass. | Test output. | ☐ |
| GL-117 | A fitted part cannot be deleted from a job card and cancelling a service invoice cannot restock parts that are on a customer's scooter. | RC-064 (TRD-01, TRD-12) | Dev | Test "TRADE-1 a part already fitted cannot be taken off the job" passes; cancelling a service invoice with restock true returns 409. | Test output. | ☐ |

## 3.10 Parallel-month tools and rules
| ID | Condition | Source | Who verifies | How to verify | Evidence to save | Status |
| GL-118 STOP | The reconciliation report exists: daily and monthly grid, eight internal tie-outs, a reconciliation_runs table (date, figure, vyapar, radcore, difference, reason, signed_off_by), a stock compare as at the date, and a "mark day reconciled" action that needs audit:read and opening:import. | RC-121 (FIN-11); area-13 App C | Dev | With RadCore and a Vyapar sample holding the same 20 transactions the report shows all differences zero; change one invoice by Rs 100 in the sample and the report shows the Rs 100 on the right day, figure and document. | Test run screenshots. | ☐ |
| GL-119 | The daily Vyapar exports are named: sales register, purchase register, day book, party balances, stock summary, GST report, cash and bank balances. One person exports them at one time each day into one folder. | RC-121 (FIN-11); area-13 App C | Accounts | First day's folder exists with all files. | Folder listing. | ☐ |
| GL-120 | A reconciler (Accounts) and a reviewer (Owner, with the CA at month end) are named for the whole month, with a stand-in for each. | RC-121 (FIN-11) | Owner | Names written on the parallel-month sheet. | Sheet. | ☐ |
| GL-121 | The rules of the month are written and told to staff: which system is the legal record (Vyapar until switch-off, unless the CA decides otherwise), which entries are made in both systems and by whom the same day, no correction to RadCore by direct SQL, and every difference is logged. | proposal "PRD plans a month of RadCore running beside Vyapar"; area-13 App C | Owner; Accounts | One-page rules sheet; staff acknowledgement list. | Sheet; acknowledgement list. | ☐ |
| GL-122 STOP | The exit rule is agreed in writing by Owner and CA before day 1. The reviewers propose: at least ten working days in a row with no unexplained difference, month-end GSTR-1 and GSTR-3B totals within Rs 1 of Vyapar's, party and stock balances equal, then the owner signs. Unsettled until Owner and CA agree. | area-13 App C (exit rule, a proposal) | Owner; CA | Signed one-line rule (or the changed rule). | Signed rule. | ☐ |

Gate 1 passes when every line above is ☑ (or an allowed [~]) and the Gate 1 row of section 8 is signed. The parallel month starts the next working day.
# 4. The parallel month
## 4.1 The rules of the month
- Vyapar stays the legal record until the CA says otherwise. RadCore is the shadow. Every entry is made in both systems on the same day by the same staff.
- Nobody corrects RadCore with direct SQL. Corrections use the application's own routes (credit note, cancellation with a real reason, reversal). Nothing is deleted.
- Tolerance. The figure is 0. The only exception is Rs 1 where the whole gap is a documented round-off. This comes from area-13 Appendix C as a proposal for the Owner and CA to confirm; this checklist adds no other thresholds. Stock value has no tolerance until the CA answers question 27.
- Who. Accounts prepares the day and marks it reconciled. The Owner reviews the exceptions the same day and signs the week. The CA reviews the month.
- Exit rule (proposal, to be agreed in Gate 1): at least ten working days in a row with no unexplained difference, month-end GSTR-1 and GSTR-3B totals within Rs 1 of Vyapar's, party and stock balances equal, then the Owner signs.
The Vyapar side of every comparison is a report exported from Vyapar that day (sales register, purchase register, day book, party balances, stock summary, GST reports, cash and bank balances). The RadCore side is the reconciliation report built under the line for RC-121.
## 4.2 Daily routine (every working day, prepared by Accounts, exceptions reviewed by the Owner the same day)
| ID | Compared, and how it is checked | Source | Tolerance | Reviewer | Evidence to save | Status |
| GL-123 | Sales: taxable value, invoice count and number range, cancelled count. RadCore invoice list for the day against the Vyapar sales register. | area-13 App C section 1 | 0. Rs 1 only where the whole gap is a documented round-off (App C, to be confirmed by Owner and CA). | Owner | Day's comparison saved in the reconciliation report; reason code on any gap. | ☐ |
| GL-124 | Output GST by head: CGST, SGST, IGST and cess. RadCore tax on the day's invoices against the Vyapar report. | area-13 App C section 1 | Same as above. | Owner | Report rows. | ☐ |
| GL-125 | Sales returns and credit notes: taxable value and tax. | area-13 App C section 1 | Same as above. | Owner | Report rows. | ☐ |
| GL-126 | Purchases (stock and other): taxable value, input GST by head, and purchase returns. RadCore bills against the Vyapar purchase register. | area-13 App C section 1 | Same as above. Input credit RadCore declines (unregistered, composition, blocked) is a listed reason "RadCore rule", never silently ignored. | Owner | Report rows. | ☐ |
| GL-127 | Expenses before GST and the GST on them. | area-13 App C section 1 | Same as above. | Owner | Report rows. | ☐ |
| GL-128 | Receivables: Debtors control account total, and each party with movement that day, against the Vyapar party balances. | area-13 App C section 1; RC-121 (FIN-11) | 0 per party; the total must also equal the sum of party balances inside RadCore (tie-out 1). | Owner | Per-party sheet. | ☐ |
| GL-129 | Payables: Creditors control account total, and each supplier with movement, against Vyapar. | area-13 App C section 1; RC-121 (FIN-11) | 0 per party; tie-out 1 inside RadCore. | Owner | Per-party sheet. | ☐ |
| GL-130 | Receipts and payments by mode (cash, bank, UPI, card, cheque) from the day book. | area-13 App C section 1 | 0. | Owner | Day-book comparison. | ☐ |
| GL-131 | Cash closing balance: RadCore against Vyapar against the physical cash counted by the cashier. | area-13 App C section 1 | 0 across all three. | Owner | Signed cash count slip. | ☐ |
| GL-132 | Bank balance: each bank account's book balance in RadCore against the Vyapar bank balance, and (on each date reconciled) against the bank statement closing balance. | area-13 App C section 1, tie-out 6 | 0 after the listed unreconciled items. | Owner | Bank sheet with the unreconciled items listed. | ☐ |
| GL-133 | Stock quantity: every item with movement that day, and total quantity, RadCore stock ledger against the Vyapar Stock Summary. Serial-numbered items by serial count. | area-13 App C section 1, section 4 | 0 on quantity. | Store lead; Owner | Item sheet. | ☐ |
| GL-134 | Stock value: Stock in Hand in RadCore against the Vyapar stock value. | area-13 App C section 1; CA Q27 | No tolerance is set: Vyapar and RadCore may value stock on different bases (unsettled, CA Q27). Until the CA answers, quantity must match exactly and a value gap is logged with reason "stock valuation" and its amount. | Owner; CA at month end | Value sheet; CA reply. | ☐ |
| GL-135 | TDS held back by us (on payments) and TDS held back by customers: movement of the TDS accounts against Vyapar. | area-13 App C section 1 | 0. Rates and thresholds are those the CA supplied (unsettled until CA Q18 to Q21 are answered). | Owner | Report rows. | ☐ |
| GL-136 | Round-off total for the day, in both systems. Any Rs 1 gap on a line above must be explained by this figure. | area-13 App C section 1 | 0. | Owner | Report row. | ☐ |
| GL-137 | RadCore internal tie-outs all pass: party sums equal control accounts, stock ledger equals Stock in Hand, month's GSTR-1 tax equals movement on the output GST accounts, HSN taxable equals B2B + B2CL + B2CS - CDNR - CDNUR, invoice totals equal Debtors debits, bank book equals statement, Opening Balance Equity unmoved, trial balance balances and invoice numbers have no gaps. | area-13 App C tie-outs 1 to 8; RC-063 (ENG-25, TRD-23, TST-04) | All pass; any fail is an "Unexplained" day until fixed. | Owner | npm run integrity -- <production url> output; Health check screenshot. | ☐ |
| GL-138 | Document match: every document in either system is matched on number and date, then party and total. "Only in Vyapar", "only in RadCore", "amount differs", "party differs", "tax head differs" and "date differs" are all listed and explained. | area-13 App C section 2 | No unexplained row. | Owner | Document match list. | ☐ |
| GL-139 | The day is marked reconciled in RadCore (one reconciliation_runs row per figure with reason and signer). | RC-121 (FIN-11) | All figures signed. | Owner | The day's rows. | ☐ |

## 4.3 Weekly routine (every week, last working day)
| ID | Compared, and how it is checked | Source | Tolerance | Reviewer | Evidence to save | Status |
| GL-140 | Party ledger for every party: opening, plus sales, minus returns, minus receipts, plus or minus other, equals closing, in both systems. | area-13 App C section 3 | 0 per party. | Owner | Party ledger sheet. | ☐ |
| GL-141 | Item ledger for every item: opening quantity, purchases, sales, adjustments, closing quantity and value, in both systems. | area-13 App C section 4 | 0 on quantity; value per the stock value rule above. | Store lead; Owner | Item ledger sheet. | ☐ |
| GL-142 | GST preview: GSTR-1 section totals (B2B, B2CL, B2CS, CDNR, HSN totals) and GSTR-3B outward and credit, RadCore against Vyapar's own GST reports for the week to date. | area-13 App C section 5 | 0; Rs 1 for round-off only. | Owner; CA sees it at month end | Preview comparison. | ☐ |
| GL-143 | TDS and payables for the week to date against Vyapar. | area-13 App C section 1 | 0. | Owner | Report rows. | ☐ |
| GL-144 | Bank statements: every statement line to date is matched to a book entry or listed with a reason. Matches are by payment reference; amount-only matches are suggestions confirmed by a person. | area-13 App C tie-out 6; RC-145 (INT-03) | 0 unlisted lines. | Owner | Bank reconciliation sheet. | ☐ |
| GL-145 | Weekly spot restore: one random day is restored from backup into a side database and its figures agree with Vyapar for that day. | area-10 App D #42 | 0 on the compared figures; the restore must succeed. | Dev; Owner reads the result | Restore log and comparison. | ☐ |
| GL-146 | Unexplained-difference log reviewed: count by reason code, open items, each defect has an RC id or a new ticket, and the exit-rule counter (consecutive days with no unexplained difference) is updated. | area-13 App C; area-10 App C7 | No unexplained item older than the week without an owner and a date. | Owner | Reviewed log. | ☐ |
| GL-147 | Operations glance: Monday test alert acknowledged, backup and WAL heartbeats green, error tracker reviewed (new issues, none with personal data), dead webhook events 0, disk free, scheduler last run. | area-10 App C7 | All green or each exception logged. | Dev | Dashboard screenshot. | ☐ |

## 4.4 Month-end (end of the parallel month)
| ID | Compared, and how it is checked | Source | Tolerance | Reviewer | Evidence to save | Status |
| GL-148 | GSTR-1 and GSTR-3B totals for the month, RadCore against Vyapar. | area-13 App C (exit rule) | Within Rs 1 (the reviewers' proposal; Owner and CA to confirm). | Owner; CA | Side-by-side sheet signed by CA. | ☐ |
| GL-149 | Party balances and stock balances at month end: equal in both systems. | area-13 App C (exit rule) | 0 on party balances and stock quantity; stock value per CA Q27. | Owner; CA | Signed balance sheet. | ☐ |
| GL-150 | Payroll net pay for each employee, RadCore against a manual calculation prepared before looking at RadCore. Vyapar holds no payroll, so this compares against the current method. It is the same check as the payroll line GL-168 in Gate 2: do it once and cite it in both. | area-15 App A | 0.00 per employee, or the difference is explained by a named rule difference (known ones: employer EPF admin and EDLI not booked, EPS/EPF split not kept, flat typed TDS). | HR; Accounts; Owner | Calculation sheet and RadCore payslip run. | ☐ |
| GL-151 | Exit rule check: ten working days in a row with no unexplained difference (proposal), reasons logged, signed. | area-13 App C (exit rule) | As agreed in the exit-rule line of Gate 1. | Owner; CA | Signed month-end record. | ☐ |

## 4.5 When a figure differs
- Change nothing yet. Write the figure, both values and the difference into the day's reconciliation row. Set the status to Unexplained.
- Find it. Open the day's document match. Look for "only in Vyapar", "only in RadCore", "amount differs", "party differs", "tax head differs" and "date differs". For stock open the item ledger of the item. For tax compare by head, then by document.
- Name the reason from this list: timing; rounding rule; stock valuation; entered in one system only; wrong entry in Vyapar; wrong entry in RadCore; not imported. Two more reasons are added by this checklist: RadCore rule by design (for example input credit RadCore refuses on an unregistered supplier) and RadCore defect.
- Fix at the source, by the proper route.
- Wrong entry in RadCore: reverse it with a credit note, a cancellation with the real reason, or a reversal journal. Never SQL, never delete.
- Wrong entry in Vyapar: correct it in Vyapar and write a note.
- Entered in one system only: enter it in the other with the original date.
- Not imported: it is an opening item that was missed. Only the Owner can reopen an import step, for that one item, and closes it again afterwards. Record it.
- RadCore defect. Raise it with its RC id (or a new ticket). The day stays Unexplained until the fix is released and proved on the same figure, or the Owner and the CA agree in writing that it is explained. The count of clean days for the exit rule restarts from the day the fix is proved.
- Re-run the comparison, then mark the day reconciled with the reason and the signer.
- A difference nobody can explain goes to the Owner the same day it is found. If the integrity report itself fails, follow runbook C5.5: stop entry, take a snapshot, find the first bad entry in the audit log, involve the CA, no ad-hoc SQL on the live database.
## 4.6 What must be logged
One reconciliation row per figure per day (the reconciliation_runs record) with:
| Field | Content |
| Date and figure | The day and the figure compared |
| Vyapar and RadCore values | Both amounts |
| Difference | RadCore minus Vyapar |
| Status | Match, Explained or Unexplained |
| Reason | One code from 4.5 step 3 |
| Documents | The document numbers in the gap |
| Found by, fixed by | Names |
| Fix reference | The document number of the correction, the RC id or the ticket |
| Signed off by, at | Accounts daily; Owner weekly; Owner and CA at month end |

Also keep, for the whole month: a defect log (RC id or ticket, severity, the release tag that fixed it, who proved it); a release list (date, tag, who deployed, what changed); every restore done and its result; every workaround used. Rows are never deleted. This log is evidence for Gate 2.
# 5. Gate 2: before Vyapar is switched off
"Filed from RadCore data" in group 5.1 means: the full month's returns are produced from RadCore and test-uploaded to the portal. The return actually filed for the parallel month stays the Vyapar one unless the CA decides otherwise in writing.
## 5.1 GST returns from RadCore data
| ID | Condition | Source | Who verifies | How to verify | Evidence to save | Status |
| GL-152 | GSTR-1 and GSTR-3B are produced from RadCore for the whole parallel month. Output tax by head, input credit by head and tax payable agree to the ledger (tie-out 3) and the CA's set-off order is applied (unsettled, CA Q13 and Q14). | RC-107 (FIN-16); RC-108 (FIN-15); RC-109 (FIN-17); area-13 App A2 | Accounts; CA | GST screen for the month; Output and Input CGST, SGST, IGST and cess ledgers; GSTR-1 total tax equals the month's movement on the output GST accounts. | Screenshots; CA note on Q13 and Q14. | ☐ |
| GL-153 | The GSTR-1 file passes a schema built from a real sample, with description, series numbering and Table 13 fixed. | RC-059 (FIN-06, FIN-28) | Dev | npx vitest run test/gstr1-schema.test.ts passes; audit test F-16 passes. | Test output. | ☐ |
| GL-154 STOP | The month's GSTR-1 file has been test-uploaded to the portal's offline upload and the outcome recorded (processed without errors, or the error list). The totals the portal computes equal the RadCore screen to the rupee. It is not filed from this upload unless the CA says so in writing. | RC-059 (FIN-06, FIN-28); area-13 App F | Filing owner; CA | Upload the file; compare the portal's summary with the RadCore GST screen. | Portal acknowledgement or error list; side-by-side totals. | ☐ |
| GL-155 STOP | The filing owner is named. That person holds the portal login, files each month, has a named stand-in, and the CA's role (reviews or files) is written. The date of the first real return from RadCore is in the calendar. | area-13 App F; proposal | Owner; CA | One-page note with names, stand-in, login holder and the date. | The note. | ☐ |
| GL-156 | After the month is final the filing owner marks it filed in RadCore with a filing date after month end. The check reports no difference. A cancel of an old invoice in that month is refused whether only GSTR-1 or only GSTR-3B is marked filed. | RC-012 (ENG-03, FIN-07, FIN-27) | Filing owner; Dev | GET /api/gst/filings/check reports no difference; try the cancel and save the refusal. | Check response; refusal screenshot. | ☐ |
| GL-157 | Filing frequency confirmed by the CA: monthly or the quarterly scheme (QRMP). The lock and the screens assume monthly. Unsettled until the CA answers. | area-13 CA Q3 | CA | Written answer. | CA note. | ☐ |
| GL-158 | The CA has verified the GST rate for every item and HSN in the master against the schedules in force on each date since 22 September 2025 (vehicles, batteries, chargers, boards, spares). | RC-115 (FIN-26); area-13 CA Q34 | CA | Signed rate list. | Rate list. | ☐ |
| GL-159 | The CA has said which supply types Radboards has (nil-rated, exempt, export or SEZ, sales through e-commerce operators), how import clearing charges are claimed, and which GSTR-1 tables RadCore does not produce (for example Tables 8, 9, 14) and how those are filled by hand. | RC-107 (FIN-16); RC-106 (FIN-19); area-13 CA Q7, Q15, Q16 | CA | Written note and the manual procedure. | Note. | ☐ |
| GL-160 | The CA has given the written position on advances and time of supply, the credit-note deadline and discount-only notes, and on correcting an invoice after filing (amend, or cancel and credit note). | RC-110 (FIN-13); area-13 CA Q9, Q10, Q11 | CA | Written answers. | Note. | ☐ |
| GL-161 | The company's own GSTIN, address and state are set and an invoice cannot be issued while they are blank. The state does not default to Maharashtra. | RC-112 (FIN-21) | Dev; Accounts | Try to issue an invoice on a test copy with a blank GSTIN: refused. | Screenshot. | ☐ |
| GL-162 | The printed invoice (A4 and thermal) carries the Rule 46 particulars, including the reverse-charge line and the ship-to address, and a buyer without a GSTIN is not reported as a consumer when they are a dealer. The rule for an unregistered buyer above the invoice-value limit is confirmed by the CA (unsettled). | RC-113 (FIN-24, WEB-07); area-13 App E, CA Q35 | Accounts; CA | Print one invoice of each kind and compare with the App E list. | Prints; CA note. | ☐ |
| GL-163 STOP | The CA has answered, or marked not relevant, all 37 questions in area-13 section 11. The ones that change a figure (Q3 to Q17, Q26, Q27, Q34) are marked. | area-13 section 11 | CA | Annotated question list. | List. | ☐ |
| GL-164 STOP | The CA has signed a statement on the tax rules RadCore applied during the parallel month, with the scope agreed in advance. | proposal "chartered accountant's sign-off" | CA | Signed statement. | Statement. | ☐ |
| GL-165 | Quarterly TDS return, certificates, interest and late fee are done outside RadCore (RC-181 is a later build). The CA is named as the filer and RadCore's deductee-wise TDS ledger is the input. | RC-181 (FIN-20); RC-060 (FIN-08) | CA; Accounts | Name written; export tested once. | Note; export file. | ☐ |

## 5.2 Month-end and year-end close
| ID | Condition | Source | Who verifies | How to verify | Evidence to save | Status |
| GL-166 | Month-end close was rehearsed on the parallel month, in order and timed: every bank account reconciled; integrity report clean; trial balance, ageing and stock-against-ledger checked; GST month produced and marked filed; period lock moved forward by Accounts; a posting into the locked month refused; Accounts refused when moving the lock back, Owner allowed with a reason; backup taken after close. | RC-039 (SCA-12, FIN-12); RC-012 (ENG-03, FIN-07, FIN-27); RC-163 (ENG-17, ENG-19) | Accounts; Owner | Run the steps and tick each with time and initials. | Close checklist with times. | ☐ |
| GL-167 | Year-end close and reopen were rehearsed on a restored copy (never on production): request, reason, a different approver, and the lock following as recorded. The CA has listed the postings needed before a year close (depreciation, provisions, income tax, interest, forex revaluation). | RC-039 (SCA-12, FIN-12); area-13 FIN-12, CA Q25 | Accounts; Owner; CA | Rehearsal record on the copy. | Record; CA list. | ☐ |

## 5.3 Payroll
| ID | Condition | Source | Who verifies | How to verify | Evidence to save | Status |
| GL-168 STOP | One full month of payroll was run in RadCore for all staff and checked against a manual calculation made first, using the method in area-15 Appendix A. The statutory values used by hand (PF wage ceiling and rates, ESIC limit and rates, professional tax amount, day basis, leave allowance) were confirmed by the labour adviser or CA first. The PF ceiling is checked on the EPFO site on the day (unsettled legal values). | RC-104 (PPL-08); area-15 App A | HR; Accounts; Labour adviser | Net pay per employee equals the hand figure to the paisa, or each difference is a named rule difference. | Calculation sheet; payslip run; adviser note. | ☐ |
| GL-169 | PF and ESIC are worked on the real salary components with UAN and ESIC numbers stored, the ESIC contribution-period rule applied, and the EPF admin charge and EDLI booked as employer cost. | RC-104 (PPL-08) | Dev; Labour adviser | Test "H-06 ESIC coverage continues to the end of the Apr-Sep contribution period after a raise to 22,000 (165 / 715)" passes; a table-driven test against the adviser's sheet passes. | Test output; adviser sheet. | ☐ |
| GL-170 | In the real month one user prepared, a different user approved, and pay was released by a user allowed to do so; nobody approved or paid their own salary. | RC-035 (SCA-06, PPL-07); RC-034 (SCA-05, PPL-01, PPL-02) | Owner | Read the run's calculated_by, approved_by and paid_by. | Screenshot of the run history. | ☐ |
| GL-171 | On a restored copy a past month was reopened and re-approved with the same figures as first approved, and the reversal sits on the booked date. | RC-013 (PPL-03, PPL-06) | Dev; HR | Compare payslips before and after. | Comparison. | ☐ |
| GL-172 | Salary TDS is not calculated by RadCore (it is a typed monthly figure). The CA or payroll adviser supplies the figure per employee, HR enters it, and the quarterly salary TDS return is filed outside RadCore. | RC-169 (PPL-05) | CA; HR | Figures received and entered for the month; return filer named. | Figures sheet. | ☐ |
| GL-173 | Items RadCore does not model each have a named person and method: overtime, bonus, gratuity, minimum wages, professional tax by state slab and the February amount, Labour Welfare Fund, public holidays, leave types, carry-forward and encashment, final settlement for leavers. | RC-103 (PPL-22); RC-102 (PPL-11); RC-101 (PPL-19); RC-179 (PPL-20); RC-180 (PPL-21) | HR; Labour adviser | One table of item, handler, method. | The table. | ☐ |
| GL-174 | The salary bank file lists only employees with an account number and IFSC, checked row by row against the manual list. | RC-166 (PPL-27) | HR; Accounts | Compare the file with the list. | File and list. | ☐ |

## 5.4 Bank reconciliation
| ID | Condition | Source | Who verifies | How to verify | Evidence to save | Status |
| GL-175 | Bank reconciliation is done for every bank account for the full parallel month: statement closing equals book balance after the listed unreconciled items, every line is matched or listed, bank fees are booked. | RC-145 (INT-03); RC-066 (INT-08); RC-144 (INT-02, SCB-03) | Accounts; Owner | Reconciliation sheet per account. | Sheets signed. | ☐ |

## 5.5 E-invoice and e-way bill decision
| ID | Condition | Source | Who verifies | How to verify | Evidence to save | Status |
| GL-176 STOP | A written decision signed by the CA and the Owner. It states Radboards' aggregate turnover for each year since 2017-18, whether e-invoicing applies and from when, the e-way bill position for vehicles ridden away and for deliveries inside the state, the consequence of an invoice issued without an IRN, and when the decision is revisited. The review's secondary sources give Rs 5 crore for e-invoicing, 30-day reporting from Rs 10 crore and Rs 50,000 for an e-way bill; none of these is settled and the CA's answer replaces them. If e-invoicing applies, this line fails until the integration (RC-170) is live in the sandbox and in production. | RC-170 (FIN-01); RC-116 (WEB-08); area-13 FIN-01, CA Q1, Q2, Q36 | CA; Owner | Signed decision note. | Note. | ☐ |

## 5.6 Personal data (DPDP minimum)
| ID | Condition | Source | Who verifies | How to verify | Evidence to save | Status |
| GL-177 STOP | A versioned privacy notice is live on every public form and states purpose, retention, how to withdraw and the grievance contact. Counsel has approved the text. | RC-032 (PPL-24, SCB-10, WEB-27) | Owner; Counsel | Open the public enquiry form in a private window and screenshot the notice and version; after a test enquiry the stored notice version matches. | Screenshot; counsel approval. | ☐ |
| GL-178 | Consent is recorded with notice version and verification, from an unticked box. A repeat enquiry does not change consent. Imported leads with no consent are not on a follow-up plan. | RC-032 (PPL-24, SCB-10, WEB-27) | Dev | Test enquiry with and without the box; read the consent row. | Query output. | ☐ |
| GL-179 STOP | Opt-out works. A WhatsApp STOP (and the configured Hindi or Hinglish words) from an unknown number creates no lead; from a known lead it records the opt-out, stops the plan and blocks sending. | RC-068 (INT-13, PPL-09) | Dev; Sales lead | Tests PEOPLE-5, H-15 and whatsapp.test.ts pass; send STOP from a test phone and check the lead. | Test output; screenshot. | ☐ |
| GL-180 | Retention is in place: the owner's chosen period N for lost leads and rejected applicants, the housekeeping job running, and a written retention schedule. | RC-011 (DAT-16, SCB-05, PPL-26, INT-19) | Owner; Dev | Job run log; schedule document. | Schedule signed. | ☐ |
| GL-181 | Erasure works end to end through the owner-controlled script on a test person. | RC-011 (DAT-16, SCB-05, PPL-26, INT-19) | Dev | Count rows holding the test phone in every table including audit_log and error_log: 0. | Query output. | ☐ |
| GL-182 | Breach readiness: a named contact, a one-page procedure (who decides, who calls counsel, how the Board and the people are told), an incident register and a contact list. Notification duties and times are unsettled; counsel confirms. | RC-040 (SCA-15, SCB-14); area-05 section 18 (B4); area-10 C5.6 | Owner; Counsel | The document and contact list. | Document. | ☐ |
| GL-183 | Requests from people are handled: a published contact on the form and invoices, a request log with due dates, and an export of one person's data. | RC-011 (DAT-16, SCB-05, PPL-26, INT-19); area-05 section 18 (B5) | Owner; Dev | Raise a test request and complete it. | Log entry; export. | ☐ |
| GL-184 | A data map and processor register exist in docs/DATA-MAP.md: each data set, purpose, legal basis, retention, processor and region, with agreements on file for hosting, Meta, Cloudflare, Shopify, the alert channel and S3. | area-05 section 18 (B7) | Owner; Counsel | The file and the agreements list. | File. | ☐ |
| GL-185 | Counsel's decision on under-18 enquiries (age question or flag) is recorded and built or consciously declined. | area-05 section 18 (B6) | Counsel; Owner | Written decision. | Decision. | ☐ |
| GL-186 STOP | Counsel states which DPDP duties apply on the switch-off date and confirms the minimum above is enough for now. The reviewer's reading was that the Rules were notified in November 2025 and most duties begin about May 2027; this is unsettled. | area-05 section 18 | Counsel | Written statement. | Statement. | ☐ |
| GL-187 | A written records policy: GST records about six years (the proposal's wording, CA to confirm), books 8 years (to confirm, CA), backups per area-10 B.5, Vyapar kept read-only for the same period. A breach contact is named. | area-10 App D #43; area-13 App B | CA; Owner | Signed policy. | Policy. | ☐ |

## 5.7 Operations proof
| ID | Condition | Source | Who verifies | How to verify | Evidence to save | Status |
| GL-188 STOP | A restore from backup passed within the last 30 days before the go/no-go meeting. | RC-017 (OPS-03, OPS-13, OPS-33); area-10 App B.8 | Dev; Owner reads | The latest restore-test report shows every check passed and its date is within 30 days of the meeting; the restore-test monitor is green. | Report. | ☐ |
| GL-189 | A fresh-server game day was run by a person who did not write the runbook: new VM, restore from the bucket, time to a working login recorded and at or below the objective for a lost host. | RC-050 (OPS-11); area-10 App D #9 | Dev; Owner | Game-day sheet. | Sheet. | ☐ |
| GL-190 | The recovery objectives are signed by the Owner. The proposed values are RPO target 5 minutes (15 accepted) and RTO 4 hours for a lost host and 30 minutes for a bad release. They become commitments only after the game day proves them. | RC-050 (OPS-11); area-10 App E.1; App D #37 | Owner | Signed table. | Table. | ☐ |
| GL-191 | docs/RUNBOOK.md is published with C0 to C7 (contacts, deploy, roll back, restore, rotate secrets, incident response, on-call, calendar) and a printed copy is in the safe. | RC-050 (OPS-11); area-10 App C; App D #36 | Dev; Owner | Open docs/RUNBOOK.md, tick that C0 to C7 are each present, and hold the printed copy. | Copy. | ☐ |
| GL-192 | The on-call list is printed: primary and secondary with phone numbers, the owner, hosting support, DNS registrar, CA, counsel and where the recovery sheet is. A P1 is acknowledged in 15 minutes and escalated to the secondary, then the owner. | RC-050 (OPS-11); area-10 App C0, C6, A.5 | Owner | A test P1 call. | Printed list. | ☐ |
| GL-193 | The PRD target (lists of 50,000 rows load in under 1 second) was measured on the production setup (tool and script to be chosen). The result is recorded; if it is missed, the Owner records Radboards' real row counts and accepts or sets a date. RC-176 is Wave 3, so this is a recorded decision, not a pass mark. | RC-176 (ARC-01, ARC-02, ARC-03, ARC-04); area-10 App D #40 | Dev; Owner | Run the script. | Result and decision. | ☐ |

## 5.8 Rollback to Vyapar and the cut-over
| ID | Condition | Source | Who verifies | How to verify | Evidence to save | Status |
| GL-194 STOP | A Vyapar backup file taken now has been opened on a second machine and a report read from it, so the way back is proved. The Vyapar licence runs through the rollback window. The final file is taken again at switch-off (section 6.2). | area-13 App B (step 9) | Accounts; Owner | Take the backup in Vyapar, open it on another machine, read one report. | Screenshot. | ☐ |
| GL-195 STOP | A written rollback plan exists: the triggers, the decision maker (Owner), the steps (stop entry in RadCore, re-enter the day-book entries since switch-off into Vyapar from the daily export, tell staff, tell the CA), what happens to RadCore data (kept) and the point of no return. The reviewers' suggestion for that point is the first GST return filed from RadCore; Owner and CA confirm. | area-13 App B | Owner; Accounts | One page signed. | Plan. | ☐ |
| GL-196 | The plan was rehearsed on paper: one sample day from RadCore's day-book export re-entered into a copy of Vyapar, timed, and reconciled. | area-13 App B | Accounts | Run it. | Time and result. | ☐ |
| GL-197 | Vyapar is kept read-only after switch-off for the period the CA confirms (the reviewers' note says 6 years for GST records, to be confirmed). Who may open it and where the file lives are written. | area-13 App B (step 9), CA | Owner; CA | Note. | Note. | ☐ |
| GL-198 STOP | Invoice numbering at cut-over is agreed with the CA: which series is the legal one during the parallel month, which series RadCore issues from switch-off, no duplicate number, no gap in a declared series, at most 16 characters. Unsettled until the CA answers. | area-13 App E, CA (added by this checklist) | CA; Owner | Written note. | Note. | ☐ |
| GL-199 STOP | The switch-off date and time are chosen away from payroll, GST filing and month-end close unless urgent (runbook C1 precondition). The checklist suggests the first working day after a month-end close, flagged as a suggestion. | area-10 App C1 | Owner | Calendar entry. | Entry. | ☐ |

## 5.9 Go or no-go
| ID | Condition | Source | Who verifies | How to verify | Evidence to save | Status |
| GL-200 | Every Gate 0, Gate 1 and Gate 2 line is ☑, or [~] only as rule 1.3 allows, with an initialled reason. Every [~] line is listed. | all 80 Wave 1 and Critical or Serious Wave 2 items (Appendix A) | Owner; Dev | Print the three gates and count the boxes. | Printed gates. | ☐ |
| GL-201 | An open-items and risk-acceptance register is attached: every Wave 2 Moderate item still open, every [~] line, and the compensating control for each, with the Owner's initials. | area-10 App D | Owner | Read the register. | Register. | ☐ |
| GL-202 STOP | A formal go/no-go meeting was held and recorded: date, release tag, status of each gate, open items, accepted risks, the CA's statement, decision (go, no-go, go with named conditions) and signatures from section 8. | proposal "handover call"; area-10 App D | Owner; Dev; Accounts; CA | Meeting held; record signed. | Signed record in the evidence folder and in the off-site backup. | ☐ |

Gate 2 passes when every line above is ☑ (or an allowed [~]), no STOP line in section 7 applies, and the go/no-go record is signed.
# 6. Switch-off day and the first week
Do not start the switch-off day plan unless Gate 2 is signed. Steps are done in order, and each is initialled.
## 6.1 The day before
| ID | Condition | Source | Who verifies | How to verify | Evidence to save | Status |
| GL-203 | Gate 2 is ☑ and the go/no-go record is signed. The release tag is frozen: nothing is deployed from now until the end of the first-week review unless the Owner agrees an urgent fix. | GL-202 | Owner; Dev | Read the signed record; git describe --tags on the server. | Record; tag name. | ☐ |
| GL-204 | Staff are told the time of the last Vyapar entry and the time RadCore becomes the only system. A paper fallback sheet is at each counter in case RadCore is down, and everyone knows who to call. | GL-195; area-10 App C5.1 | Owner | Staff list initialled; sheets at counters. | Initialled list. | ☐ |
| GL-205 | The primary and secondary on-call people are free and reachable for the whole first week, and the Owner copy messages are armed. | GL-192; area-10 App A.5 | Dev; Owner | Roster for the week. | Roster. | ☐ |

## 6.2 Switch-off day, in this order
| ID | Condition | Source | Who verifies | How to verify | Evidence to save | Status |
| GL-206 | Last Vyapar entries are made. The last Vyapar document numbers (sales, purchase, receipt, payment) and the time are written down. | GL-121; area-13 App B | Accounts | Read the numbers from Vyapar. | Slip with numbers and time. | ☐ |
| GL-207 STOP | The last day is reconciled, RadCore against Vyapar, with no unexplained difference, and signed. The document match list shows nothing "only in Vyapar". | GL-118; area-13 App C | Accounts; Owner | Run the daily routine in section 4.2. | Signed final day. | ☐ |
| GL-208 | The final Vyapar backup file is taken, opened on a second machine and stored in two places. | GL-194 | Accounts | Open it and read one report. | Screenshot. | ☐ |
| GL-209 | A manual full RadCore backup and a point-in-time marker are taken. The integrity report is clean. The last invoice and payment numbers are written down. | RC-001 (OPS-01, OPS-14); RC-016 (OPS-02, HST-02); RC-063 (ENG-25, TRD-23, TST-04) | Dev | npm run integrity -- <production url> exits 0; backup heartbeat green. | Output; numbers slip. | ☐ |
| GL-210 | The opening import is still closed. | RC-038 (FIN-09, ENG-02, ENG-15) | Dev | POST /api/opening/<kind> answers 409 for each step. | Responses. | ☐ |
| GL-211 | The first RadCore invoice carries the number the CA's note says it should. | GL-198 | Accounts | Issue the first real invoice and compare. | Print. | ☐ |
| GL-212 | Vyapar is removed from the counter machines and kept read-only for the retention period. Who still has access is written down. | GL-197 | Owner | List of machines and people. | List. | ☐ |
| GL-213 | The first real invoice, receipt, purchase bill and stock movement of the day are each checked on arrival: right party, tax, total, print, and they appear in the books. The integrity report stays clean after them. | RC-113 (FIN-24, WEB-07); RC-063 (ENG-25, TRD-23, TST-04) | Accounts; Dev | Open each document and its journal; run the integrity report. | Screenshots; output. | ☐ |
| GL-214 | Monitors are green and the alert path is live. | GL-080; GL-086 | Dev | Dashboard screenshot; test alert acknowledged. | Screenshot. | ☐ |
| GL-215 | End of day: cash counted against RadCore, bank and Debtors checked, invoice numbers consecutive, and RadCore's day-book export, party balances and stock summary saved. These exports are the input to a rollback. | GL-119; RC-121 (FIN-11) | Accounts; Owner | Run the daily comparison against the paper slips and the cash count. | Signed day sheet and export files. | ☐ |

## 6.3 First-week watch list (every day for the first seven days)
| ID | Condition | Source | Who verifies | How to verify | Evidence to save | Status |
| GL-216 | The site and the readiness probe stay green; no P1 or P2 is open; the scheduler's last run is under 35 minutes. | RC-083 (OPS-07, OPS-06, ARC-18); RC-082 (ARC-08, AIX-06, LIB-07, ENG-24, OPS-25, HST-07) | Dev | Dashboard each morning and evening. | Screenshot per day. | ☐ |
| GL-217 | Backup and WAL heartbeats are green, the newest backup is recent, disk space is healthy. | RC-001 (OPS-01, OPS-14); RC-016 (OPS-02, HST-02); RC-017 (OPS-03, OPS-13, OPS-33) | Dev | Dashboard. | Screenshot per day. | ☐ |
| GL-218 | The nightly integrity job passed and the Health check screen is clean. | RC-063 (ENG-25, TRD-23, TST-04) | Dev | Screen and monitor. | Screenshot per day. | ☐ |
| GL-219 | New error-tracker issues are read; none holds personal data; dead webhook events are 0; the failed-login count is normal. | RC-007 (ARC-11, SCB-04, OPS-08, AIX-07); RC-158 (LIB-08, OPS-29); RC-084 (INT-01, INT-15) | Dev | Tracker and System health. | Daily note. | ☐ |
| GL-220 | Cash counted equals RadCore; bank balance and Debtors agree to party sums; invoice numbers have no gaps; the day-book export is saved. | RC-121 (FIN-11); area-13 App C | Accounts | Daily comparison. | Signed day sheet. | ☐ |
| GL-221 | A few fast-moving items and every serial vehicle that moved are counted physically against RadCore; the negative-stock list is empty. | RC-064 (TRD-01, TRD-12); RC-062 (ENG-01) | Store lead | Count and compare. | Count sheet. | ☐ |
| GL-222 | Printed invoices are accepted by customers and dealers, in particular the thermal print; each query is logged. | RC-113 (FIN-24, WEB-07) | Accounts | Keep a query log. | Log. | ☐ |
| GL-223 | MFA prompts work, no legitimate user is locked out, failed logins are reviewed, and every permission-change alert is confirmed as intended. | RC-055 (SCA-02); RC-089 (SCA-04, ARC-22); RC-033 (SCA-03, SCA-24) | Dev; Owner | Admin log and alert history. | Daily note. | ☐ |
| GL-224 | Meta leads arrive, Shopify orders and cancellations match, a WhatsApp STOP is honoured, bank statement imports show no held or unmatched surprises. | RC-084 (INT-01, INT-15); RC-085 (INT-05); RC-067 (INT-06, SCB-17); RC-068 (INT-13, PPL-09) | Sales lead; Accounts | Compare with the source system for the day. | Daily note. | ☐ |
| GL-225 | Every staff problem is logged with a severity; anything that touches money is treated as a defect and given an RC id or a new ticket. | area-10 App C6 | Dev; Owner | Read the log each evening. | Log. | ☐ |
| GL-226 | Day 3 review: Owner and Dev read the log, the watch list and the rollback triggers (section 6.4) and record "continue" or "roll back". | GL-195 | Owner; Dev | Meeting held. | Short record. | ☐ |
| GL-227 | Day 7 review: the same, plus the date of the first month-end close and the first real GST return from RadCore is confirmed with the filing owner and the CA, and the rollback window status is written down. | GL-195; GL-155 | Owner; Dev; CA | Meeting held. | Record. | ☐ |

## 6.4 Roll back to Vyapar if
- the integrity report fails and the cause is not understood; or
- a money figure is wrong and cannot be put right by a documented reversal; or
- RadCore is down and cannot be restored within the recovery objective the Owner signed; or
- cash, bank or Debtors do not agree with the counted or actual figure and the difference is not explained by the end of the day; or
- the Owner decides to.
The rollback follows the written plan in the Gate 2 line for the rollback plan: stop entry in RadCore, re-enter the entries since switch-off into Vyapar from the daily export, tell the staff and the CA, keep the RadCore data.
# 7. The stop conditions
Each line below is one condition. If it is true, do not switch Vyapar off. The Cleared box is ticked ☑ only when the condition has been checked and does not apply. Any person who signs section 8 may call stop; only the Owner clears a stop, and only after the cited lines pass.
## 7.1 Any one of these means do not switch off
| ID | Stop condition | Source | Who clears it | Where to check | Evidence to save | Cleared |
| GL-228 | Any Gate 0 line is open (☐ or [!]), or is [~] for a reason other than a feature that is not used and is verified off. | RC-001 to RC-049 | Owner | Every line in section 2 (Gate 0) | The evidence of the lines cited, and a written reason if stop is called | ☐ |
| GL-229 | Backups: no restore test passed in the last 30 days, or the newest restore-test report has a failed check, or a backup or WAL heartbeat is missing. | RC-001; RC-016; RC-017 | Owner | GL-004; GL-006; GL-007; GL-188 | The evidence of the lines cited, and a written reason if stop is called | ☐ |
| GL-230 | Any line that checks a Critical or Serious Wave 2 register item (Appendix A shows which) is open, or is [~] for a reason other than a feature that is not used and is verified off. | 31 Wave 2 Serious items | Owner | Gate 1 groups 3.1 to 3.10 and Gate 2 groups 5.1 to 5.9 | The evidence of the lines cited, and a written reason if stop is called | ☐ |
| GL-231 | The books integrity report is not clean on the day, or any P1 incident from the parallel month has no closed post-mortem. | RC-063; RC-050 | Owner | GL-107; GL-118 | The evidence of the lines cited, and a written reason if stop is called | ☐ |
| GL-232 | The parallel-month exit rule is not met, or any difference is still "Unexplained" at month end. | area-13 App C | Owner | GL-122; section 4.4 | The evidence of the lines cited, and a written reason if stop is called | ☐ |
| GL-233 | The month's GSTR-1 has not been test-uploaded to the portal, or the portal's totals differ from RadCore's by any rupee. | RC-059 | Owner | GL-154 | The evidence of the lines cited, and a written reason if stop is called | ☐ |
| GL-234 | No filing owner is named, or the date of the first real return from RadCore is not in the calendar. | area-13 App F | Owner | GL-155 | The evidence of the lines cited, and a written reason if stop is called | ☐ |
| GL-235 | The CA's signed statement is missing, or any CA question that changes a figure (Q3 to Q17, Q26, Q27, Q34) is unanswered. | proposal; area-13 section 11 | Owner | GL-164; GL-163; GL-061 | The evidence of the lines cited, and a written reason if stop is called | ☐ |
| GL-236 | The e-invoice and e-way bill decision is not documented, or it says e-invoicing applies and the integration is not live. | RC-170; RC-116 | Owner | GL-176 | The evidence of the lines cited, and a written reason if stop is called | ☐ |
| GL-237 | The invoice numbering at cut-over is not agreed with the CA. | area-13 App E | Owner | GL-198 | The evidence of the lines cited, and a written reason if stop is called | ☐ |
| GL-238 | Payroll net pay does not match the manual calculation for any employee without a named rule difference. | RC-104; area-15 App A | Owner | GL-168 | The evidence of the lines cited, and a written reason if stop is called | ☐ |
| GL-239 | MFA is not on for every admin, owner, accounts and HR user. | RC-055 | Owner | GL-090 | The evidence of the lines cited, and a written reason if stop is called | ☐ |
| GL-240 | A default or demo password exists, demo data is on, or the repository is public. | RC-021; RC-006 | Owner | GL-092; GL-013 | The evidence of the lines cited, and a written reason if stop is called | ☐ |
| GL-241 | Production data, uploads or backups are outside India, or the Singapore copy accepts real data. | RC-018 | Owner | GL-003 | The evidence of the lines cited, and a written reason if stop is called | ☐ |
| GL-242 | Alerts have not been proved by deliberately failing something (API stop, backup stop, disk), or the Monday test alert has not been acknowledged. | RC-083 | Owner | GL-082; GL-083; GL-084; GL-086 | The evidence of the lines cited, and a written reason if stop is called | ☐ |
| GL-243 | The public privacy notice is not live, or an opt-out (WhatsApp STOP) is not honoured, or counsel's statement is missing. | RC-032; RC-068 | Owner | GL-177; GL-179; GL-186 | The evidence of the lines cited, and a written reason if stop is called | ☐ |
| GL-244 | A Vyapar backup file has not been proved to open on a second machine, or there is no written rollback plan. | area-13 App B | Owner | GL-194; GL-195 | The evidence of the lines cited, and a written reason if stop is called | ☐ |
| GL-245 | CI is not green and required on the release tag, or main is unprotected. | RC-051; RC-005 | Owner | GL-102; GL-109 | The evidence of the lines cited, and a written reason if stop is called | ☐ |
| GL-246 | There is no signed go/no-go record, or any signer in section 8 is absent. | proposal | Owner | GL-202; section 8 | The evidence of the lines cited, and a written reason if stop is called | ☐ |
| GL-247 | A code release touching posting, GST, stock or payroll code was deployed during the last reconciliation window without restarting the exit-rule count (rule added by this checklist). | added here | Owner | release list against GL-122 | The evidence of the lines cited, and a written reason if stop is called | ☐ |
| GL-248 | The switch-off falls within 2 hours before payroll, GST filing or month-end close and the Owner has not recorded it as urgent. | area-10 App C1 | Owner | GL-199 | The evidence of the lines cited, and a written reason if stop is called | ☐ |

# 8. Sign-off table
Sign with a name, signature and date. A signature on a gate means the signer has read the evidence for the lines they are named on and found them ☑ or allowed [~].
| Gate or event | Role | Name | Signature | Date | Decision (pass, pass with accepted risks, fail) |
| Gate 0 | Developer |  |  |  |  |
| Gate 0 | Owner |  |  |  |  |
| Gate 0 | Second person who did not build the fixes |  |  |  |  |
| Gate 1 | Developer |  |  |  |  |
| Gate 1 | Owner |  |  |  |  |
| Gate 1 | Accounts |  |  |  |  |
| Gate 1 | HR (staff and pay set-up) |  |  |  |  |
| Gate 1 | CA (opening tie-out) |  |  |  |  |
| Parallel month exit | Accounts |  |  |  |  |
| Parallel month exit | Owner |  |  |  |  |
| Parallel month exit | CA |  |  |  |  |
| Gate 2 | Owner |  |  |  |  |
| Gate 2 | Developer |  |  |  |  |
| Gate 2 | Accounts |  |  |  |  |
| Gate 2 | HR |  |  |  |  |
| Gate 2 | Filing owner |  |  |  |  |
| Gate 2 | CA |  |  |  |  |
| Gate 2 | Counsel (DPDP minimum) |  |  |  |  |
| Gate 2 | Labour adviser (payroll) |  |  |  |  |
| Go/no-go record | Owner (decides) |  |  |  |  |
| Go/no-go record | Developer |  |  |  |  |
| Go/no-go record | Accounts |  |  |  |  |
| Go/no-go record | CA |  |  |  |  |
| Switch-off completed | Owner |  |  |  |  |
| Switch-off completed | Developer |  |  |  |  |
| Switch-off completed | Accounts |  |  |  |  |
| First-week review (day 7) | Owner |  |  |  |  |
| First-week review (day 7) | Developer |  |  |  |  |

Go/no-go decision: GO / NO-GO / GO with named conditions (strike out what does not apply).
Release tag going live: ______________  Date and time of switch-off: ______________
Named conditions, if any: ______________________________________________
Accepted risks (each also in the risk-acceptance register): ______________________________________________
# Appendix A. Where each register item is checked
All 80 items that must be covered (every Wave 1 item and every Critical or Serious Wave 2 item) have at least one line. None is left out of the gates.
| RC id | Level | Wave | Title (short) | Checked by line(s) |
| RC-001 | Critical | 1 | Backups fail open: the only copy is an unencrypted dump on the same disk as the database, ... | GL-004, GL-064, GL-077, GL-209, GL-217 |
| RC-002 | Serious | 1 | Backup keys and cloud credentials sit beside the data, so ransomware or a stolen server ca... | GL-005, GL-074 |
| RC-003 | Serious | 1 | The database owner password sits in the API container environment, and the app login keeps... | GL-009 |
| RC-004 | Serious | 1 | Posted bills, payments, expenses and payslips can be changed or deleted with plain SQL, de... | GL-014 |
| RC-005 | Serious | 1 | The real-PostgreSQL CI job fails before any test runs, and the real-database suite builds ... | GL-011, GL-109 |
| RC-006 | Serious | 1 | The repository is public, and nothing watches dependencies or scans for secrets while Next... | GL-013 |
| RC-007 | Serious | 1 | Failed database queries put names, phone numbers, PAN and bank details, and link tokens in... | GL-048, GL-219 |
| RC-008 | Serious | 1 | Prices and unit costs are limited to 2 decimals, so a rate such as 0.375 cannot be entered... | GL-027 |
| RC-009 | Serious | 1 | Foreign-currency documents keep only the rupee figure; the foreign amount is re-derived by... | GL-028 |
| RC-010 | Serious | 1 | The second legal entity is half-built and an admin can create one today; purchases, paymen... | GL-029 |
| RC-011 | Serious | 1 | There is no way to erase, anonymise or time-limit personal data, and the audit log and eve... | GL-049, GL-180, GL-181, GL-183 |
| RC-012 | Serious | 1 | The filed-month GST lock guards only half the doors, nothing records what was filed, and t... | GL-030, GL-156, GL-166 |
| RC-013 | Serious | 1 | Reopening a month books the reversal into today's month, and re-approving or reopening a p... | GL-033, GL-171 |
| RC-014 | Serious | 1 | Input credit is claimed on bills from suppliers with no GSTIN, from composition dealers an... | GL-031, GL-055 |
| RC-015 | Moderate | 1 | Choose the production host: the code is written for a long-running server and loses limits... | GL-002, GL-070 |
| RC-016 | Serious | 1 | There is no point-in-time recovery: a server loss restores to last night, and invoice numb... | GL-006, GL-064, GL-077, GL-209, GL-217 |
| RC-017 | Serious | 1 | The restore drill passes on an empty database, never checks uploaded files, is not schedul... | GL-007, GL-078, GL-188, GL-217 |
| RC-018 | Serious | 1 | "Data stays in India" is true only on paper: the only running copy is pinned to Singapore ... | GL-003, GL-075 |
| RC-019 | Moderate | 1 | Committing the audit proof tests as they are would turn npm test and CI red | GL-012 |
| RC-020 | Moderate | 1 | PostgreSQL runs on image defaults: no data checksums, no tuning, no slow-query or lock-wai... | GL-008 |
| RC-021 | Moderate | 1 | The first admin can be created locked out, and the generated password is printed into buil... | GL-010, GL-092 |
| RC-022 | Moderate | 1 | An issued invoice does not freeze who issued it: old invoices reprint with today's company... | GL-015 |
| RC-023 | Moderate | 1 | Duplicate-bill protection is wrong in both directions, and a bill stores neither the suppl... | GL-016 |
| RC-024 | Moderate | 1 | 119 of 159 numeric columns and 61 of 110 tables have no CHECK, so none of the arithmetic i... | GL-017 |
| RC-025 | Moderate | 1 | The stock ledger has no business date, so back-dated documents and period-end stock report... | GL-018 |
| RC-026 | Moderate | 1 | Serial numbers: nothing in the database stops a unit being on the shelf twice, and some pa... | GL-019 |
| RC-027 | Moderate | 1 | One status column answers three questions (whose is it, what condition, is it promised), s... | GL-020 |
| RC-028 | Moderate | 1 | Batches are a label: stock going out names no batch, a receipt line holds one batch, and d... | GL-021 |
| RC-029 | Moderate | 1 | 124 of 214 foreign keys have no index | GL-022 |
| RC-030 | Moderate | 1 | The audit trail depends on about 185 hand-written audit() calls; updated_at is not maintai... | GL-023 |
| RC-031 | Serious | 1 | 33 of the 230 write routes leave no audit entry, including every login, password change an... | GL-038 |
| RC-032 | Moderate | 1 | The consent record is thin and forgeable: no notice or purpose stored, a stranger can reco... | GL-050, GL-177, GL-178 |
| RC-033 | Moderate | 1 | Someone given user-management rights can make themselves an administrator, and the Permiss... | GL-039, GL-088, GL-089, GL-223 |
| RC-034 | Serious | 1 | A payroll user can pay themselves a cash advance, and an admin can unlink their own employ... | GL-035, GL-170 |
| RC-035 | Serious | 1 | One payroll user can prepare, adjust, approve and pay a month for everyone else, and the a... | GL-036, GL-094, GL-170 |
| RC-036 | Serious | 1 | A change of someone's bank account is not in the audit trail and needs no second person | GL-037 |
| RC-037 | Moderate | 1 | The person who makes a change can usually also approve it: adjustments, purchase orders, p... | GL-040, GL-094 |
| RC-038 | Serious | 1 | The Vyapar opening stock import stays open forever, posts stock on the day of import, lets... | GL-034, GL-056, GL-058, GL-063, GL-210 |
| RC-039 | Moderate | 1 | One accountant can move the period lock back over open months, and a closed year can be re... | GL-032, GL-094, GL-166, GL-167 |
| RC-040 | Moderate | 1 | Personal data masking and the "who looked" log cover the detail page but not lists, the ph... | GL-041, GL-182 |
| RC-041 | Serious | 1 | Any salesperson can pull the whole lead and phone list in pages of 5,000 and edit any lead | GL-042 |
| RC-042 | Serious | 1 | Routes an AI tool would call already return data beyond the caller's role, and rows are no... | GL-043 |
| RC-043 | Moderate | 1 | Salary and full bank account numbers are listed for every employee at once, are plain text... | GL-044 |
| RC-044 | Minor | 1 | 52 enums, 24 ADD VALUE migrations, and two roles called store and stores | GL-024 |
| RC-045 | Minor | 1 | Uniqueness, format and lookup gaps: duplicate emails and SKUs by case, GSTIN and PAN forma... | GL-025 |
| RC-046 | Minor | 1 | Plan for the big append-only tables: partition the three logs by month now, while they are... | GL-026 |
| RC-047 | Minor | 1 | Public link tokens are stored in plain text and copied into other tables | GL-045 |
| RC-048 | Moderate | 1 | Invoice and estimate links never expire, cannot be switched off, can be created by anyone ... | GL-046 |
| RC-049 | Moderate | 1 | Payslip links show salary, deductions and IFSC to anyone with the link, cannot be revoked,... | GL-047 |
| RC-050 | Serious | 2 | There is no disaster-recovery objective, runbook, on-call arrangement or rehearsal, and th... | GL-189, GL-190, GL-191, GL-192 |
| RC-051 | Serious | 2 | Nothing stops a red or untested commit from reaching the live server: main is unprotected ... | GL-101, GL-102, GL-103, GL-109 |
| RC-052 | Serious | 2 | The migration runner is not safe on a live database, and the "way back" that update.sh pri... | GL-104 |
| RC-053 | Serious | 2 | Item locks block unrelated inserts, two lock-order inversions can deadlock concurrent save... | GL-105 |
| RC-054 | Serious | 2 | The public enquiry form's captcha and strict rate limit are bypassed through the website-f... | GL-095, GL-096 |
| RC-055 | Serious | 2 | No second factor on the accounts that move money, run payroll or change who can do what | GL-090, GL-096, GL-223 |
| RC-056 | Serious | 2 | A supplier bill is never held against the purchase order or goods received, tax is recompu... | GL-111 |
| RC-057 | Serious | 2 | There is no reverse charge anywhere | GL-112 |
| RC-058 | Serious | 2 | Expenses claim input credit with no blocked-credit check or state check, and an expense ca... | GL-113 |
| RC-059 | Serious | 2 | The GSTR-1 file has never been checked against the portal's rules, at least three things l... | GL-153, GL-154 |
| RC-060 | Serious | 2 | TDS is typed in by hand at payment time, with no thresholds, no higher no-PAN rate, and no... | GL-114, GL-165 |
| RC-061 | Serious | 2 | The dealer's credit limit and overdue bills are checked once, when the order is confirmed;... | GL-115 |
| RC-062 | Serious | 2 | Negative-stock mode leaves a phantom stock value that never clears | GL-116, GL-221 |
| RC-063 | Serious | 2 | The books-healthy check compares one total and reads six separate snapshots, so most stock... | GL-062, GL-107, GL-137, GL-209, GL-213, GL-218 |
| RC-064 | Serious | 2 | A part already fitted can be deleted from a job card, so stock and cost have gone but noth... | GL-117, GL-221 |
| RC-065 | Serious | 2 | Any sales user can create confirmed orders at any price through the marketplace import; bl... | GL-098 |
| RC-066 | Serious | 2 | A statement can be filed under the wrong bank account when two accounts share a mail rule | GL-100, GL-175 |
| RC-067 | Serious | 2 | A Shopify cancellation that arrives before its order lets the cancelled order in, and a re... | GL-097, GL-224 |
| RC-068 | Serious | 2 | A WhatsApp "STOP" is not recognised: from an unknown number it creates a consenting lead, ... | GL-179, GL-224 |
| RC-069 | Serious | 2 | The money tests are weaker than they look: estimated mutation score 52 percent on the 25 m... | GL-106 |
| RC-083 | Serious | 2 | Nobody outside the server watches the server: the health check says ok without touching th... | GL-080, GL-081, GL-082, GL-083, GL-084, GL-085, GL-086, GL-216 |
| RC-084 | Serious | 2 | Stuck webhook events are never retried or reported, so an expired Meta token silently lose... | GL-087, GL-219, GL-224 |
| RC-085 | Serious | 2 | Shopify edits, payments and refunds after the first message are thrown away | GL-097, GL-224 |
| RC-089 | Serious | 2 | Password guessing is limited per address only, in memory, with no per-account lockout, and... | GL-091, GL-096, GL-223 |
| RC-104 | Serious | 2 | PF and ESIC are worked from a made-up "Basic = 50% of gross": no real salary structure, no... | GL-060, GL-168, GL-169 |
| RC-118 | Serious | 2 | A CSV statement with an unquoted "9,111.00" is imported as Rs 9, rows with unreadable date... | GL-099 |
| RC-120 | Serious | 2 | Unpaid bills are not brought in one by one from Vyapar, so old invoices cannot be returned... | GL-058, GL-059 |
| RC-121 | Serious | 2 | The Vyapar compare screen is a three-list snapshot, not a parallel-month reconciliation | GL-118, GL-119, GL-120, GL-128, GL-129, GL-139, GL-215, GL-220 |
| RC-133 | Serious | 2 | A failed save gets a fresh retry key, and several money and stock saves, including Receive... | GL-108 |
| RC-144 | Serious | 2 | A look-alike or forged sender still gets a bank statement mail imported and matched agains... | GL-096, GL-100, GL-175 |
| RC-145 | Serious | 2 | Bank lines are matched to the books on amount and date alone, including lines that arrived... | GL-100, GL-144, GL-175 |

## Register items that are not gates
| RC id | Level and wave | Why it is not a gate | What stands in for it |
| RC-169 Salary TDS is not calculated | Serious, Wave 3 | The build is a later item. | The CA or payroll adviser supplies the monthly figure and the return is filed outside RadCore (see the payroll line for salary TDS in Gate 2). |
| RC-170 E-invoice and e-way bill integration | Serious, Wave 3 | Needed only if the CA says e-invoicing applies. | The e-invoice decision line in Gate 2 is a gate and a STOP line. If it says "applies", the integration becomes a gate. |
| RC-171 Permission checks for an AI layer | Serious, Wave 3 | No AI layer is switched on at go-live. | AI features stay off until RC-171, RC-042 and RC-173 are done. RC-042 itself is a Gate 0 line. |
| RC-172 Purchase bill has no draft state | Serious, Wave 3 | The build is a later item. | A bill posts the moment it is created, so Accounts checks every bill before saving. Purchases are compared daily in the parallel month. |
| RC-173 Outsiders' free text mixed with staff notes | Serious, Wave 3 | Matters only once an AI layer reads it. | None needed while AI features are off. |
| All other Moderate and Minor items | Waves 2 and 3 | They do not by themselves decide whether Vyapar can be switched off. | The ones that change a figure or the environment appear as lines (list below). The rest are scheduled by the fix plan. The risk-acceptance register in the go/no-go lists any that are still open. |

## Other register items that appear as lines
| RC id | Level | Wave | Title (short) | Line(s) |
| RC-070 | Moderate | 2 | The backup script re-archives the whole uploads folder every day, so a single server runs ... | GL-079 |
| RC-072 | Moderate | 2 | The production image carries every development dependency, runs TypeScript through tsx at ... | GL-072 |
| RC-074 | Moderate | 2 | Caddy records no access log, adds no security headers, limits no request size or time, and... | GL-071 |
| RC-075 | Moderate | 2 | No memory or CPU limits, no log rotation, no read-only filesystem or dropped capabilities:... | GL-072 |
| RC-076 | Moderate | 2 | There is no host baseline and no infrastructure as code: hardening, patching, SSH, firewal... | GL-070 |
| RC-080 | Moderate | 2 | No lock, statement or connection timeouts: one stuck transaction or heavy report can freez... | GL-073 |
| RC-082 | Moderate | 2 | Background jobs: the 15-minute in-process loop has no queue, retry, timeout, watchdog or o... | GL-085, GL-216 |
| RC-092 | Moderate | 2 | Recording that an employee has left does not switch off their sign-in | GL-088 |
| RC-101 | Moderate | 2 | Weekly offs are paid even if the person was absent every working day, and public holidays ... | GL-173 |
| RC-102 | Moderate | 2 | Professional tax is a flat number per person (no state slabs, no February figure, charged ... | GL-173 |
| RC-103 | Moderate | 2 | Overtime, bonus, gratuity, minimum wages and other statutory pay items are not modelled at... | GL-173 |
| RC-106 | Moderate | 2 | GST on customs-agent, port and trucking charges paid in cash is added to the cost of the g... | GL-159 |
| RC-107 | Moderate | 2 | GSTR-1 leaves out nil-rated and exempt supplies, advances, e-commerce supplies and amendme... | GL-152, GL-159 |
| RC-108 | Moderate | 2 | The GSTR-3B screen has two lines, no cross-head set-off, and ignores the credit brought fo... | GL-152 |
| RC-109 | Moderate | 2 | GST is never settled in the books, and nothing ties each month's return to the ledger | GL-152 |
| RC-110 | Moderate | 2 | A credit note can reduce output tax at any age, and a price discount cannot be a credit no... | GL-160 |
| RC-112 | Moderate | 2 | An invoice can be issued while the company's own GSTIN, address and state are blank, and t... | GL-161 |
| RC-113 | Moderate | 2 | The printed invoice misses some Rule 46 particulars, a dealer saved without a GSTIN is rep... | GL-162, GL-213, GL-222 |
| RC-115 | Moderate | 2 | No GST rate rows are loaded for the 22 September 2025 rate change, and a newer short-code ... | GL-158 |
| RC-116 | Moderate | 2 | E-invoice IRN, acknowledgement and QR cannot be entered or printed | GL-176 |
| RC-117 | Moderate | 2 | The importers cannot read the files the sources produce: no Excel, comma-only CSV, UTF-8 o... | GL-052 |
| RC-119 | Moderate | 2 | The Vyapar import has never been tried on a real Vyapar file, and the file shape is an ass... | GL-051, GL-053, GL-054, GL-055, GL-056, GL-057, GL-058, GL-062 |
| RC-146 | Moderate | 2 | No browser security headers on any screen or public page, the token pages can be indexed a... | GL-071 |
| RC-158 | Minor | 2 | Error tracking is home-made, blind to the browser, and its alert de-duplication is keyed o... | GL-219 |
| RC-163 | Minor | 2 | Closing a year or moving the lock does not wait for postings in flight, and postJournal ch... | GL-166 |
| RC-166 | Minor | 2 | The bank list includes people with no account number or IFSC | GL-174 |
| RC-169 | Serious | 3 | Salary TDS (Section 192) is not calculated: it is a flat monthly number someone types, wit... | GL-172 |
| RC-170 | Serious | 3 | No e-invoice or e-way bill integration: a live IRN does not stop a cancel | GL-176 |
| RC-176 | Moderate | 3 | Lists and reports add up a whole ledger before they keep 100 rows, so 8 of the 15 heaviest... | GL-193 |
| RC-179 | Moderate | 3 | The leave module is a single flat allowance: no types, no balance check when leave is aske... | GL-173 |
| RC-180 | Moderate | 3 | Leaving the company has no final settlement: advances are stranded, and leave, notice and ... | GL-173 |
| RC-181 | Moderate | 3 | The TDS flow stops at the deposit: no quarterly return file, no certificates, no interest ... | GL-165 |

# Appendix B. Figures in this checklist that are not settled
None of these is decided by this document. Each is marked in its line.
| Figure or rule | What the review found in its sources | Who settles it | Where it matters |
| E-invoicing turnover limit and the 30-day reporting limit | Rs 5 crore, and Rs 10 crore for 30-day reporting; one source mentions a change from 1 April 2026 (secondary sources) | CA (Q1) | E-invoice decision line, stop conditions |
| E-way bill limit and validity | Rs 50,000 (Rule 138); state intra-state limits differ; validity per distance (sources differ) | CA (Q2) | E-invoice decision line |
| Effect of an invoice issued without an IRN | Not treated as an invoice (Rule 48(5), to be confirmed) | CA (Q36) | E-invoice decision line |
| GST filing frequency | Monthly assumed; quarterly scheme possible | CA (Q3) | GST lock, GST lines |
| Who may claim input credit, blocked credit, reverse charge | Section 9(4), 16(2), 16(4), 17(5) and Rule 37 as the reviewer read them | CA (Q4 to Q6, Q12) | Purchase rules in Gate 1 |
| GST rates after 22 September 2025 | Rate rows not loaded | CA (Q34) | GST rates line |
| Rule 46 particulars, including the value limit for unregistered buyers | Rs 50,000 as the reviewer read it | CA (Q35) | Invoice print line |
| TDS table, thresholds, no-PAN rate and returns for FY 2026-27 | Under the Income-tax Act 2025; seed holds "Section 393(1); earlier 194C" only | CA (Q18 to Q22) | TDS lines |
| Stock valuation basis in Vyapar | Unknown; RadCore uses moving average | CA (Q27) | Stock value comparison |
| Cut-over date and treatment of the year before it | Mid-year or 1 April | CA (Q26, Q28) | Migration lines |
| Invoice numbering at cut-over | One series, no gaps, up to 16 characters | CA (added by this checklist) | Cut-over lines |
| PF wage ceiling and rates, ESIC limit and rates, professional tax amounts, day basis | As stated for the hand calculation in area-15 Appendix A | Labour adviser, CA | Payroll lines |
| DPDP Act duties and dates; breach notification times | Rules notified November 2025; most duties begin about May 2027 (reviewer's reading) | Counsel | Personal-data lines |
| Retention years for GST records and books | About 6 years (proposal), 8 years (to confirm) | CA | Records policy line |
| Parallel-month tolerance and exit rule | Rs 1 for round-off, ten working days, Rs 1 at month end (proposal in area-13 Appendix C) | Owner and CA | Section 4 |
| Recovery objectives | RPO target 5 minutes (15 accepted), RTO 4 hours lost host, 30 minutes bad release (proposed in area-10 Appendix E) | Owner | Operations lines |

# Appendix C. Where the 43 deployment lines went
The deployment checklist in area-10 Appendix D has 43 lines. Each is merged into the lines below; duplicates with register items were combined into one line each.
| App D # | Deployment line (area-10) | Merged into |
| 1 | Off-site buckets exist in India, public access blocked | GL-003 |
| 2 | Bucket versioning on; dumps bucket Object Lock COMPLIANCE 35 d | GL-005 |
| 3 | Host credentials cannot delete dumps | GL-005 |
| 4 | pgBackRest stanza healthy | GL-006 |
| 5 | WAL archiving current | GL-006 |
| 6 | Backup timers active | GL-006 |
| 7 | Uploads backup recent | GL-006, GL-079 |
| 8 | PITR rehearsal passed | GL-006 |
| 9 | Fresh-server game day within RTO | GL-189 |
| 10 | Recovery sheet complete and checked by a second person | GL-005 |
| 11 | main protected; release is a tag | GL-001, GL-102 |
| 12 | Update by tag refuses a red build | GL-103 |
| 13 | App database role is not privileged; owner URL not in the API | GL-009 |
| 14 | Database timeouts and checksums | GL-008, GL-073 |
| 15 | Alert text contains no values | GL-048 |
| 16 | Caddyfile valid; headers; access log | GL-071 |
| 17 | TLS valid and renewing | GL-067 |
| 18 | Image has no dev dependencies | GL-072 |
| 19 | Memory limits and log rotation | GL-072 |
| 20 | .env.production protected; secret inventory complete | GL-005, GL-074 |
| 21 | Residency register signed | GL-003 |
| 22 | SSH keys only, no root login | GL-070 |
| 23 | Firewall: only needed ports | GL-070 |
| 24 | Automatic security updates | GL-070 |
| 25 | Time and zone | GL-070 |
| 26 | Docker log driver and swap | GL-070 |
| 27 | Cloud, DNS, registrar and GitHub accounts have MFA; provider snapshots on | GL-069 |
| 28 | External probe on /api/ready from two places | GL-080 |
| 29 | Heartbeats registered and arriving | GL-077 |
| 30 | Alert rules load and test | GL-081 |
| 31 | Game day: API stopped | GL-082 |
| 32 | Game day: disk | GL-084 |
| 33 | On-call roster and escalation | GL-086 |
| 34 | Weekly synthetic alert scheduled | GL-086 |
| 35 | Error tracker works and scrubs | GL-048 |
| 36 | Runbook published and printed | GL-191 |
| 37 | DR objectives signed | GL-190 |
| 38 | Restore test automated; first report green | GL-007 |
| 39 | Scheduler running | GL-085 |
| 40 | Load test of the PRD target | GL-193 |
| 41 | First admin changed; demo data off | GL-010 |
| 42 | Parallel month: weekly spot restore | GL-145 |
| 43 | Records retention and breach contact | GL-187 |
