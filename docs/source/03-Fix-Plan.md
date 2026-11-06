RADCORE TECHNICAL REVIEW
RadCore fix plan in three waves
Radboards Pvt Ltd
29 October 2026
Reviewed commit  194e288
Contents
Prepared for Radboards Pvt Ltd on 29 October 2026. Reviewed commit 194e288 (full id 194e2881dc1063ffc99b41b3c6d2e71a4ef392e2).Proposal promise this answers: "Fix plan in three waves. Before any real data, before go-live, and the first three months after. Each item carries an effort estimate in days."
Every item below is an item of the master register (master-register.json, RC-001 to RC-222). Every count, day total, table, dependency chain and calendar figure in this document was computed from that file by the script _build-fix-plan.cjs (same folder), so they agree with the register. The prose around them is written by hand. Money is not quoted: the plan is in developer-days, and you multiply the days by your developer's day rate.
How to read it: section 1 is the one-page answer. Sections 2 and 3 say how sure the numbers are and what the three review branches already do. Section 4 lists every item, wave by wave, with a sequenced work plan. Sections 5 and 6 turn the days into calendar weeks. Section 7 keeps the planned new builds apart from the defects. Sections 8 to 10 cover outside experts, risks and what to do first. The appendix traces the proposal's headline risks to the items.
# 1. The plan on one page
The short answer. There are 222 items to fix, worth 548.75 developer-days. They fall into three waves that follow the order in which the cost of waiting rises. Wave 1 is the work that cannot be done cleanly once real records exist, so it comes before any real data. Wave 2 is what must be true on the day Vyapar is switched off. Wave 3 is hardening, polish and the larger builds, in the first three months after go-live.
| Wave | When | Items | Developer-days | Critical | Serious | Moderate | Minor | Longest dependency chain (days) |
| Wave 1 | Before any real data | 49 | 120.25 | 1 | 23 | 21 | 4 | 16 |
| Wave 2 | Before go-live | 120 | 267.95 | 0 | 31 | 79 | 10 | 20.5 |
| Wave 3 | First three months after go-live | 53 | 160.55 | 0 | 5 | 23 | 25 | 22 |
| All |  | 222 | 548.75 | 1 | 59 | 123 | 39 |  |

"Longest dependency chain" is the longest run of items that must be done one after another inside the wave, added up in days (section 5). It is a floor on how fast the wave can be done however many developers you add.
Calendar, in plain terms. With one developer, Wave 1 takes about 26.7 weeks and Wave 2 about 59.5 weeks. With two developers working in different parts of the code, Wave 1 takes about 13.4 weeks, Wave 2 about 29.8 weeks, and the road to go-live (Waves 1 and 2) about 43.1 weeks by formula, 43.8 weeks as sequenced in section 4. A week here is 4.5 productive developer-days (section 6). Wave 3 is 17.8 weeks with two developers and 11.9 weeks with three (by formula; 18.6 and 12.6 as sequenced), against about 13 weeks in "the first three months". It fits only with three developers, and only just, or with some Wave 3 items pushed later.
What "done" means for each wave. The go-live checklist (07-Go-Live-Checklist.md) is the test. A wave is done when its gate lines pass with evidence, not when the code is written.
| Wave | Done when | Checklist gates | Who signs |
| Wave 1 (49 items, 120.25 days) | All 49 items are closed, each proved by the proof command or test written in its register entry. Only then may real data enter RadCore, including a real Vyapar file. A masked rehearsal import on a developer machine may happen earlier. | Gate 0, lines GL-001 to GL-050 (50 lines). The checklist says Gate 0 holds every Wave 1 item. Stop condition GL-228 applies: any open Gate 0 line means no real data. | Developer, Owner, and a second person who did not build the fixes |
| Wave 2 (120 items, 267.95 days) | All 31 Serious Wave 2 items pass their checklist lines. The parallel month with Vyapar has run and every difference is explained. The Moderate and Minor Wave 2 items are either closed or on the Owner's written risk-acceptance list. | Gate 1, lines GL-051 to GL-122; the parallel month, lines GL-123 to GL-151; Gate 2, lines GL-152 to GL-202; stop conditions GL-229 to GL-248 (GL-230 covers the 31 Serious Wave 2 items). | Owner, Developer, Accounts, HR, filing owner, CA, counsel, labour adviser |
| Wave 3 (53 items, 160.55 days) | Each item is closed with its proof command saved. The checklist has no gate for Wave 3. For the first week after switch-off the first-week watch list (GL-216 to GL-227) is the daily check. At the end of the three months, any item still open is reviewed against the risk-acceptance list. | None as gates. The checklist's own appendix names the Wave 3 items that are not gates and what stands in for each until it is built. | Owner and Developer |

Three things the owner should know now.
- Only 5 of the 222 items are fully closed by the merged review branch (2.75 days), and 30 more are partly closed (70.95 days at stake). The branch fixed the headline holes and left the design work. Plan on almost the full 548.75 days (section 3).
- 35 items (146.75 days) cannot be finished without an outside expert: a chartered accountant, counsel, a labour-law adviser or an independent security tester. 5 of them are in Wave 1. Book these people now, because waiting for them is not in the day counts (section 8).
- The planned new builds (offline billing, push alerts, the lead inbox, AI features and AI screens) are not defects and are not in these totals. The design notes size them at 146.5 to 171.5 developer-days, of which part overlaps register items (section 7).
# 2. How the effort was estimated, and how sure it is
## 2.1 What one "day" means
- The unit is one competent developer who knows this code, working one day. A developer new to the code will be slower at the start; the register does not quantify that.
- Each figure includes writing the fix, writing or reusing the test that proves it (every register item has a "proof" line), and the review of the change.
- Each figure excludes waiting time: an outside expert's turnaround, an owner decision, a hosting account being opened, a continuous-integration queue, a deploy window, and the time Accounts spends on the parallel month. These are listed in sections 8 and 9.
- Overlaps are removed. Where several reviewers found the same root cause, the register merged them and counted the shared work once (for example RC-001 counts the backup script once, not twice). Where reviewers disagreed, the register states which figure it took.
- Calendar conversion uses 4.5 productive developer-days per week, for every developer. The other half day goes to meetings, review requests, deploys and interruptions. This is an assumption; if your developer has more protected time, the weeks fall in proportion.
- These are estimates from reading code, not from building. The reviewers did not build the items to the end. The three review branches fixed some items in part (section 3); no time was recorded for that work, so it gives no check on the estimates.
## 2.2 How sure are the numbers
The register records, for each item, how the problem was confirmed:
| Confirmation level | Wave 1 items / days | Wave 2 items / days | Wave 3 items / days | All items / days |
| Confirmed by test | 6 / 10.5 | 18 / 39 | 4 / 15.1 | 28 / 64.6 |
| Confirmed by code read | 41 / 108 | 89 / 205.95 | 44 / 134.75 | 174 / 448.7 |
| To confirm | 2 / 1.75 | 13 / 23 | 5 / 10.7 | 20 / 35.45 |

Only the "To confirm" group (20 items, 35.45 days) carries a doubt about whether the work is needed at all. For the rest the reviewers saw the problem in the code, or proved it with a failing test (28 items), and the doubt is about size.
For size, the register's own notes quote a range of days for 20 items, where the register figure lies inside the quoted range. The band below uses only what the register itself records:
- Low = the register total, less the "To confirm" items (assumed not needed), with each item that quotes a range taken at the bottom of its range.
- High = the register total, with each item that quotes a range taken at the top of its range, and every "To confirm" item kept.
| Wave | Register days | Items to confirm (count / days) | Items with a quoted range (count) | Low | High |
| Wave 1 | 120.25 | 2 / 1.75 | 5 | 115 | 122.25 |
| Wave 2 | 267.95 | 13 / 23 | 3 | 242.45 | 269.45 |
| Wave 3 | 160.55 | 5 / 10.7 | 12 | 134.35 | 178.55 |
| All | 548.75 | 20 / 35.45 | 20 | 491.8 | 570.25 |

Items that quote a range: RC-008 (3, quoted 2 to 3); RC-009 (5.5, quoted 5 to 6); RC-015 (2, quoted 1.5 to 2); RC-016 (4.5, quoted 4 to 5); RC-035 (4, quoted 3 to 5); RC-072 (3, quoted 2 to 3); RC-104 (7, quoted 6 to 8); RC-169 (17.5, quoted 15 to 20); RC-170 (12, quoted 10 to 14); RC-175 (7, quoted 6 to 8); RC-176 (10, quoted 9 to 12); RC-179 (7, quoted 6 to 8); RC-183 (9, quoted 8 to 10); RC-185 (6.5, quoted 5 to 7); RC-186 (10, quoted 8 to 12); RC-187 (12, quoted 10 to 15); RC-188 (5, quoted 4 to 6); RC-190 (7, quoted 6 to 8); RC-191 (2.5, quoted 2 to 3); RC-217 (5, quoted 4 to 6).
Items marked "To confirm": RC-018 (W1, 1.25); RC-046 (W1, 0.5); RC-053 (W2, 3); RC-059 (W2, 3.5); RC-074 (W2, 1.5); RC-076 (W2, 2); RC-079 (W2, 0.5); RC-095 (W2, 1.25); RC-119 (W2, 2); RC-129 (W2, 3); RC-135 (W2, 2.5); RC-156 (W2, 1); RC-157 (W2, 1.5); RC-160 (W2, 0.5); RC-163 (W2, 0.75); RC-185 (W3, 6.5); RC-195 (W3, 1); RC-197 (W3, 3); RC-201 (W3, 0.1); RC-219 (W3, 0.1).
How to read the band. It is not a statistical interval. It shows only the doubt the reviewers wrote down. Wave 1 and Wave 2 are narrow because most of their items carry one figure. Wave 3 is wide because it holds the large builds that were quoted as ranges (RC-169, RC-170, RC-176, RC-186, RC-187 and others). A band this narrow understates the real doubt, so the plan does not rely on it alone:
- Plan on the register figure and commit to dates on the High figure.
- Re-estimate after the first two weeks of Wave 1. Divide the days actually spent on the first fortnight's items by the days planned for them, and scale every remaining figure by that ratio. This corrects for developer familiarity and for the code-read nature of the estimates better than any percentage added now.
- The band does not include these scope decisions, which would add days if the owner chooses the larger option. RC-010 (second legal entity): the register counts the fence only (0.75 days); the full option B is quoted at DAT-03 6 to 8 days, TRD-20 2 days and ARC-15 15 to 25 days, against 0.75 days counted. RC-103 (statutory components): 3 to 5 days per component if built, not counted. RC-152 (printing): server-side PDF 3 to 4 days, not counted. RC-170 (e-invoicing) is 12 days in Wave 3 and moves to Wave 2 if the chartered accountant says it applies.
- One route choice would lower Wave 1. RC-016 counts 4.5 days for the self-hosted recovery route. The hosting recommendation chooses a managed database, where the register says the item drops to about 1.5 days plus the hosting move. On that route Wave 1 would be 117.25 days, with the hosting work counted separately in section 7.3.
# 3. What the review branch already covers
The reviewers applied security fixes on three separate copies of the code (branches A, B and C). An integration agent merged them into one branch, review/security-fixes (head c17e184, 28 commits on 194e288), added a few fixes of its own, and tested the result on the built-in test database and on a real PostgreSQL 16. branch-coverage.json checks each of the 222 register items against the merged code and applies a strict rule: an item is "Fixed" only if every part of it is closed. The merged branch is not yet in the running system: the client's developer must review and accept it (fixes/HOW-TO-REVIEW-AND-ACCEPT.md).
| Status | Items | Register days | Share of 548.75 days |
| Fixed in branch | 5 | 2.75 | 0.5% |
| Part-fixed in branch | 30 | 70.95 | 12.9% |
| Not in branch | 187 | 475.05 | 86.6% |

By wave:
| Wave | Fixed: items / days | Part-fixed: items / days | Not in branch: items / days |
| Wave 1 | 1 / 0.5 | 13 / 34 | 35 / 85.75 |
| Wave 2 | 4 / 2.25 | 15 / 36.2 | 101 / 229.5 |
| Wave 3 | 0 / 0 | 2 / 0.75 | 51 / 159.8 |
| All | 5 / 2.75 | 30 / 70.95 | 187 / 475.05 |

The honest reading.
- Fully closed (5 items, 2.75 days): RC-019 (audit proof tests kept out of the default run), RC-097 (login redirect), RC-099 (HR attendance edit cannot be overruled by a later clock-in), RC-100 (pay by day across a mid-month raise) and RC-165 (cookie request with neither Origin nor Sec-Fetch-Site refused). These are small. They need review and acceptance, not new work.
- Partly closed (30 items, 70.95 days at full item effort): the plan does not subtract anything for them. The part already done is usually the smaller share, because each fix agent closed the headline hole and left the design work. For example RC-003 has the TRUNCATE guard but the owner login is still in the app container's environment.
- What the branch gives besides closed items: a head start on the proof tests, and shorter review time on those items. Neither is recorded in days, so neither is taken off.
- What the merged branch was tested with: typecheck clean, build:web passes, the default API suite 538 passed and 0 failed on the built-in test database, a sample of 21 default-suite files (268 tests) on a real PostgreSQL 16 with 0 failed, migration 0043 applied from empty on PostgreSQL 16 with its TRUNCATE guards firing. See fixes/MERGED-NOTES.md sections 6a and 6b. The full default suite was not run end to end on PostgreSQL 16, and the new web headers were not checked in a browser. Treat those as open until someone runs them.
- Where a register proof would still fail on the merged branch: 27 register proofs are listed at the end of branch-coverage.md. The one that matters for planning: RC-019's register fix also names a non-blocking CI job for the audit tests, and ci.yml has none yet.
- Before the merge the separate branches closed 2 items fully (1.75 days) and 30 partly (70.2 days); the integration work added RC-019, RC-099 and RC-165 and moved RC-155 to partly closed.
# 4. The items and the work plan, wave by wave
How the tables are ordered. Inside each wave, an item comes after everything it depends on, so you can work down the table. Items at the same depth are ordered Critical first, then Serious, Moderate, Minor, then by id. "Depends on" shows an id in plain text if it is in the same wave, and (W1) or (W2) after the id if the prerequisite sits in an earlier wave and is therefore already done by the time this wave starts. The register has 132 dependencies on 121 items: 61 inside a wave, 71 on an earlier wave and 0 on a later wave.
Columns. "Theme" is the register's theme. "Branch status" is from section 3 (None, Part-fixed with the branch letter, or Fixed). "Needs expert" is the register's needsExpert flag: CA is a chartered accountant, counsel is a lawyer, labour-law is a labour-law adviser, security-test is an independent security test.
How the work plans group the work. To keep two developers out of each other's files, items are grouped into code areas taken from the register's theme: Deploy, backup and operations scripts (themes Backup and operations, Hosting, Libraries); Tests, CI and release; Database schema and migrations; Books, GST and tax modules; Sales, purchasing and stock modules; Payroll, HR and CRM modules; Sign-in, roles, audit and privacy (themes Access and identity, Data protection and privacy); Integrations (Shopify, Meta, WhatsApp, bank import); Platform, jobs and performance; AI readiness; Front end screens. The plans below put at most one developer in a code area at a time (0 overlaps in Wave 1, 0 in Wave 2, 0 in Wave 3, checked by the script), and respect every dependency. The grouping follows the theme, not a file-by-file check, because the register names files for only some items (appendix D lists the files it does name in more than one item).
Rules that apply to every wave:
- One developer owns the migrations folder in any given week. Drizzle migrations are numbered in sequence with a shared journal, so two developers adding migrations at once will clash. The developer in "Database schema and migrations" generates them; the other asks, or agrees a number first.
- Shared files (the web ui.tsx, app.ts, server.ts, test/helpers.ts, deploy/update.sh, compose.prod.yml) get one editor at a time. Appendix D shows where the register names them in two or more items.
- Legend in the plan tables: * after an id means the item is part-fixed on a review branch, † means fully fixed on a review branch. Days are in brackets. An item is listed in the week or fortnight it starts; if it runs longer, the next period shows "continues".
## 4.1 Wave 1: before any real data (49 items, 120.25 days)
Why Wave 1 comes first: data shape, immutability, secrets, backup and restore, anything that lets one person pay or approve themselves, and anything that exposes personal data. Each of these is cheap on empty tables and impossible, or dishonest, to retrofit once real records exist. It holds 1 Critical item and 23 Serious items.
Wave 1 by level: Critical 1 (1.5 days), Serious 23 (68.75 days), Moderate 21 (44.5 days), Minor 4 (5.5 days).
### Every Wave 1 item
| RC id | Title | Level | Theme | Days | Depends on | Branch status | Needs expert |
| RC-001 | Backups fail open: the only copy is an unencrypted dump on the same disk as the database, and nothing says so | Critical | Backup and operations | 1.5 |  | None |  |
| RC-003 | The database owner password sits in the API container environment, and the app login keeps UPDATE and DELETE rights on the ledgers | Serious | Data model and database | 2 |  | Part-fixed (C) |  |
| RC-005 | The real-PostgreSQL CI job fails before any test runs, and the real-database suite builds a new database for every test file | Serious | Tests and release process | 1.5 |  | None |  |
| RC-006 | The repository is public, and nothing watches dependencies or scans for secrets while Next.js published 22 advisories in 13 weeks | Serious | Libraries | 1.5 |  | None |  |
| RC-007 | Failed database queries put names, phone numbers, PAN and bank details, and link tokens into the error log, the console and out to Slack, Google Chat, Discord or ntfy.sh | Serious | Data protection and privacy | 1.5 |  | Part-fixed (A) |  |
| RC-008 | Prices and unit costs are limited to 2 decimals, so a rate such as 0.375 cannot be entered and foreign unit prices are rounded one unit at a time | Serious | Money and GST | 3 |  | None |  |
| RC-010 | The second legal entity is half-built and an admin can create one today; purchases, payments, stock, reports, GST filing and several journals ignore the entity | Serious | Data model and database | 0.75 |  | None | CA |
| RC-012 | The filed-month GST lock guards only half the doors, nothing records what was filed, and the current month can be marked filed | Serious | Money and GST | 2.75 |  | None |  |
| RC-013 | Reopening a month books the reversal into today's month, and re-approving or reopening a past month re-reads today's rules, PT, PF and leave policy | Serious | People and payroll | 3.5 |  | None |  |
| RC-014 | Input credit is claimed on bills from suppliers with no GSTIN, from composition dealers and from foreign suppliers whose state flag is blank | Serious | Money and GST | 5 |  | None | CA |
| RC-015 | Choose the production host: the code is written for a long-running server and loses limits, jobs and uploads on Vercel; the operations scripts are welded to one compose project | Moderate | Hosting | 2 |  | None |  |
| RC-021 | The first admin can be created locked out, and the generated password is printed into build or container logs | Moderate | Access and identity | 0.5 |  | Part-fixed (A) |  |
| RC-022 | An issued invoice does not freeze who issued it: old invoices reprint with today's company name, GSTIN, address and bank | Moderate | Data model and database | 1.5 |  | None |  |
| RC-023 | Duplicate-bill protection is wrong in both directions, and a bill stores neither the supplier's invoice date nor their GSTIN | Moderate | Data model and database | 1 |  | None |  |
| RC-025 | The stock ledger has no business date, so back-dated documents and period-end stock reports use the posting time | Moderate | Data model and database | 1.5 |  | None |  |
| RC-026 | Serial numbers: nothing in the database stops a unit being on the shelf twice, and some paths skip the rules | Moderate | Stock and trade | 2 |  | None |  |
| RC-028 | Batches are a label: stock going out names no batch, a receipt line holds one batch, and different suppliers' batch numbers are merged | Moderate | Stock and trade | 3.5 |  | None |  |
| RC-029 | 124 of 214 foreign keys have no index | Moderate | Data model and database | 0.5 |  | None |  |
| RC-033 | Someone given user-management rights can make themselves an administrator, and the Permissions screen can grant any power to any role | Moderate | Access and identity | 1.25 |  | Part-fixed (A) |  |
| RC-044 | 52 enums, 24 ADD VALUE migrations, and two roles called store and stores | Minor | Data model and database | 2 |  | None |  |
| RC-045 | Uniqueness, format and lookup gaps: duplicate emails and SKUs by case, GSTIN and PAN formats, and state codes with no lookup | Minor | Data model and database | 1 |  | None |  |
| RC-047 | Public link tokens are stored in plain text and copied into other tables | Minor | Data protection and privacy | 2 |  | None |  |
| RC-002 | Backup keys and cloud credentials sit beside the data, so ransomware or a stolen server can read or erase every backup, and losing one file loses the backups | Serious | Backup and operations | 3 | RC-001 | None |  |
| RC-004 | Posted bills, payments, expenses and payslips can be changed or deleted with plain SQL, deleting a payroll run wipes its payslips, and the four database rules have holes | Serious | Data model and database | 2.5 | RC-003 | Part-fixed (C) |  |
| RC-009 | Foreign-currency documents keep only the rupee figure; the foreign amount is re-derived by division, and there is no currency list or rate table | Serious | Money and GST | 5.5 | RC-008 | None | CA |
| RC-011 | There is no way to erase, anonymise or time-limit personal data, and the audit log and event tables keep full copies forever | Serious | Data protection and privacy | 6 | RC-003 | None | counsel |
| RC-016 | There is no point-in-time recovery: a server loss restores to last night, and invoice numbers already given to customers get reused | Serious | Backup and operations | 4.5 | RC-001, RC-015 | None |  |
| RC-018 | "Data stays in India" is true only on paper: the only running copy is pinned to Singapore and several data flows leave India even from Mumbai | Serious | Hosting | 1.25 | RC-015 | None |  |
| RC-034 | A payroll user can pay themselves a cash advance, and an admin can unlink their own employee record to escape every self-pay check | Serious | People and payroll | 3.5 | RC-033 | Part-fixed (B) |  |
| RC-019 | Committing the audit proof tests as they are would turn npm test and CI red | Moderate | Tests and release process | 0.5 | RC-005 | None |  |
| RC-024 | 119 of 159 numeric columns and 61 of 110 tables have no CHECK, so none of the arithmetic identities is enforced by the database | Moderate | Data model and database | 2 | RC-008 | None |  |
| RC-027 | One status column answers three questions (whose is it, what condition, is it promised), so a customer's scooter in the workshop stops being sold and a returned unit keeps its old sale | Moderate | Stock and trade | 3 | RC-026 | None |  |
| RC-037 | The person who makes a change can usually also approve it: adjustments, purchase orders, price lists, service bills and payments out | Moderate | Access and identity | 4 | RC-033 | Part-fixed (B+C) |  |
| RC-039 | One accountant can move the period lock back over open months, and a closed year can be reopened with a lock that does not follow and a second person one admin can create | Moderate | Money and GST | 3 | RC-033 | Part-fixed (B) |  |
| RC-040 | Personal data masking and the "who looked" log cover the detail page but not lists, the phone lookup, exports or the email column, and the app login can delete the log | Moderate | Data protection and privacy | 2.5 | RC-003 | Part-fixed (C) |  |
| RC-048 | Invoice and estimate links never expire, cannot be switched off, can be created by anyone who can read invoices, and the estimate link can approve work | Moderate | Data protection and privacy | 2 | RC-047 | None |  |
| RC-049 | Payslip links show salary, deductions and IFSC to anyone with the link, cannot be revoked, and the WhatsApp text carries the net pay | Moderate | People and payroll | 1.75 | RC-047 | Part-fixed (B) |  |
| RC-017 | The restore drill passes on an empty database, never checks uploaded files, is not scheduled, and the documented restore is not all-or-nothing | Serious | Backup and operations | 3 | RC-001, RC-016 | None |  |
| RC-035 | One payroll user can prepare, adjust, approve and pay a month for everyone else, and the approver approves figures other than the ones they looked at | Serious | People and payroll | 4 | RC-034 | Part-fixed (B) |  |
| RC-036 | A change of someone's bank account is not in the audit trail and needs no second person | Serious | People and payroll | 2 | RC-034 | None |  |
| RC-038 | The Vyapar opening stock import stays open forever, posts stock on the day of import, lets Accounts approve its own stock, and one person can create stock and equity out of nothing | Serious | Stock and trade | 2.5 | RC-037 | None |  |
| RC-041 | Any salesperson can pull the whole lead and phone list in pages of 5,000 and edit any lead | Serious | Access and identity | 3.5 | RC-040 | Part-fixed (A) |  |
| RC-042 | Routes an AI tool would call already return data beyond the caller's role, and rows are not scoped to the person | Serious | AI readiness | 2 | RC-040 | None |  |
| RC-020 | PostgreSQL runs on image defaults: no data checksums, no tuning, no slow-query or lock-wait logging, and a 10-second stop deadline | Moderate | Backup and operations | 0.5 | RC-016 | None |  |
| RC-030 | The audit trail depends on about 185 hand-written audit() calls; updated_at is not maintained and updated_by does not exist | Moderate | Data model and database | 4 | RC-011 | None |  |
| RC-032 | The consent record is thin and forgeable: no notice or purpose stored, a stranger can record consent for someone else's number, there is no privacy notice on the public form, and imported leads without consent go on the follow-up plan | Moderate | Data protection and privacy | 4 | RC-011 | None | counsel |
| RC-043 | Salary and full bank account numbers are listed for every employee at once, are plain text everywhere, and nobody logs who looked | Moderate | Data protection and privacy | 3.5 | RC-040 | None |  |
| RC-031 | 33 of the 230 write routes leave no audit entry, including every login, password change and almost every export | Serious | Access and identity | 4 | RC-030 | Part-fixed (A) |  |
| RC-046 | Plan for the big append-only tables: partition the three logs by month now, while they are empty | Minor | Data model and database | 0.5 | RC-030 | None |  |
|  | Wave 1 total: 49 items |  |  | 120.25 |  |  |  |

### Wave 1 by code area
| Code area | Items | Days | Items closed or part-closed on a review branch |
| Sign-in, roles, audit and privacy | 12 | 34.75 | 7 |
| Database schema and migrations | 12 | 19.25 | 2 |
| Books, GST and tax modules | 5 | 19.25 | 1 |
| Deploy, backup and operations scripts | 8 | 17.25 | 0 |
| Payroll, HR and CRM modules | 5 | 14.75 | 3 |
| Sales, purchasing and stock modules | 4 | 11 | 0 |
| Tests, CI and release | 2 | 2 | 0 |
| AI readiness | 1 | 2 | 0 |

### Wave 1 week by week, two developers
Developer A and Developer B work in different code areas. Total days split between them:
| Code area | Developer A days | Developer B days |
| Sign-in, roles, audit and privacy | 30.75 | 4 |
| Database schema and migrations | 9.25 | 10 |
| Books, GST and tax modules | 0 | 19.25 |
| Deploy, backup and operations scripts | 0.5 | 16.75 |
| Payroll, HR and CRM modules | 14.75 | 0 |
| Sales, purchasing and stock modules | 0 | 11 |
| Tests, CI and release | 2 | 0 |
| AI readiness | 0 | 2 |
| Total | 57.25 | 63 |

| Week | Developer A | Developer B | Days started |
| 1 | Tests, CI and release: RC-005 (1.5)Database schema and migrations: RC-003* (2), RC-004* (2.5) | Deploy, backup and operations scripts: RC-001 (1.5), RC-015 (2), RC-016 (4.5) | 14 |
| 2 | Database schema and migrations: RC-010 (0.75)Sign-in, roles, audit and privacy: RC-011 (6)RC-004 continues | Deploy, backup and operations scripts: RC-002 (3)RC-016 continues | 9.75 |
| 3 | Sign-in, roles, audit and privacy: RC-033* (1.25)RC-011 continues | Deploy, backup and operations scripts: RC-017 (3)RC-002 continues | 4.25 |
| 4 | Sign-in, roles, audit and privacy: RC-037* (4)RC-033 continues | Deploy, backup and operations scripts: RC-006 (1.5), RC-018 (1.25)Books, GST and tax modules: RC-008 (3)RC-017 continues | 9.75 |
| 5 | Sign-in, roles, audit and privacy: RC-040* (2.5), RC-041* (3.5) | Books, GST and tax modules: RC-009 (5.5)RC-008 continues | 11.5 |
| 6 | Sign-in, roles, audit and privacy: RC-007* (1.5)Database schema and migrations: RC-030 (4)RC-041 continues | Books, GST and tax modules: RC-014 (5)RC-009 continues | 10.5 |
| 7 | Payroll, HR and CRM modules: RC-034* (3.5)RC-030 continues | Books, GST and tax modules: RC-012 (2.75)RC-014 continues | 6.25 |
| 8 | Payroll, HR and CRM modules: RC-035* (4)RC-034 continues | Sign-in, roles, audit and privacy: RC-031* (4)RC-012 continues | 8 |
| 9 | Payroll, HR and CRM modules: RC-013 (3.5)RC-035 continues | Sales, purchasing and stock modules: RC-038 (2.5)AI readiness: RC-042 (2)RC-031 continues | 8 |
| 10 | Payroll, HR and CRM modules: RC-036 (2)Sign-in, roles, audit and privacy: RC-032 (4) | Sales, purchasing and stock modules: RC-026 (2), RC-028 (3.5)RC-042 continues | 11.5 |
| 11 | Sign-in, roles, audit and privacy: RC-047 (2), RC-043 (3.5)RC-032 continues | Sales, purchasing and stock modules: RC-027 (3)RC-028 continues | 8.5 |
| 12 | Sign-in, roles, audit and privacy: RC-048 (2)RC-043 continues | Books, GST and tax modules: RC-039* (3)Database schema and migrations: RC-024 (2)RC-027 continues | 7 |
| 13 | Sign-in, roles, audit and privacy: RC-021* (0.5)Payroll, HR and CRM modules: RC-049* (1.75)Tests, CI and release: RC-019 (0.5)Deploy, backup and operations scripts: RC-020 (0.5) | Database schema and migrations: RC-022 (1.5), RC-025 (1.5), RC-023 (1)RC-024 continues | 7.25 |
| 14 | (finishing earlier work or waiting on a dependency) | Database schema and migrations: RC-029 (0.5), RC-044 (2), RC-045 (1), RC-046 (0.5)RC-023 continues | 4 |

Notes on the Wave 1 plan.
- Week 0, before week 1 (not costed in the register): the client's developer reviews and accepts the three review branches, merges them, and the coverage check is rerun; the host is chosen (RC-015, which RC-016 and RC-018 wait for); and the experts for the 5 Wave 1 items that need one are booked (RC-009 (CA), RC-010 (CA), RC-011 (counsel), RC-014 (CA), RC-032 (counsel)).
- Backups come first in one lane and the database rules in the other. RC-001 (the one Critical item), RC-016 and the restore proof RC-017 depend on each other and on the host choice, so RC-015, RC-001 and RC-016 start in week 1 and the restore proof RC-017 follows in week 3. The database owner and immutability work (RC-003, RC-004) starts in week 1 in the other lane, because RC-004 and RC-011 wait for RC-003.
- The longest chain is 16 days (section 5). The plan finishes in 14.0 weeks with two developers (63.0 working days end to end), against 13.4 weeks by formula, so the chain is not what limits Wave 1; the total amount of work is.
- RC-005 (the real-database CI job) is placed first by hand. No dependency link says so, but every later fix is proved on the real database, and the register says the fix branches need it.
- Gather Gate 0 evidence as each item lands, not at the end. The checklist asks for the evidence of each line to be saved under the line's id.
- Checkpoint at the end of week 2: re-estimate as described in section 2.2.
## 4.2 Wave 2: before go-live (120 items, 267.95 days)
Why Wave 2 comes second: compliance filings, reconciliation, monitoring, import tools, rate limits and the key business-logic defects. They must be right on the day Vyapar is switched off, and they can be fixed on a system that already holds data. It holds 31 Serious, 79 Moderate and 10 Minor items. RC-191 (attachments to S3, 2.5 days) was moved here from Wave 3 after the hosting write-up; the figures in this document already include that change.
Wave 2 by level: Serious 31 (107 days), Moderate 79 (152.7 days), Minor 10 (8.25 days).
### Every Wave 2 item
| RC id | Title | Level | Theme | Days | Depends on | Branch status | Needs expert |
| RC-050 | There is no disaster-recovery objective, runbook, on-call arrangement or rehearsal, and the whole business sits on one server | Serious | Backup and operations | 3 | RC-016 (W1), RC-017 (W1) | None |  |
| RC-051 | Nothing stops a red or untested commit from reaching the live server: main is unprotected and the server builds whatever main is | Serious | Tests and release process | 3 | RC-005 (W1) | None |  |
| RC-053 | Item locks block unrelated inserts, two lock-order inversions can deadlock concurrent saves, and the latest lock fixes are not proved on real PostgreSQL | Serious | Stock and trade | 3 | RC-005 (W1) | None |  |
| RC-054 | The public enquiry form's captcha and strict rate limit are bypassed through the website-form webhook, and the campaign token is also the Google Ads password | Serious | Integrations | 2 | RC-032 (W1) | None | security-test |
| RC-055 | No second factor on the accounts that move money, run payroll or change who can do what | Serious | Access and identity | 5 | RC-033 (W1) | None | security-test |
| RC-056 | A supplier bill is never held against the purchase order or goods received, tax is recomputed at the PO rate, and a price difference is stranded in Goods Received Not Billed for ever | Serious | Stock and trade | 4.5 | RC-014 (W1) | Part-fixed (C) |  |
| RC-057 | There is no reverse charge anywhere | Serious | Money and GST | 5 | RC-014 (W1) | None | CA |
| RC-058 | Expenses claim input credit with no blocked-credit check or state check, and an expense category can point at any account including a heading | Serious | Money and GST | 3 | RC-014 (W1) | None | CA |
| RC-059 | The GSTR-1 file has never been checked against the portal's rules, at least three things look likely to be rejected, and Table 13 is wrong | Serious | Money and GST | 3.5 |  | None | CA |
| RC-060 | TDS is typed in by hand at payment time, with no thresholds, no higher no-PAN rate, and not at the time the bill is booked | Serious | Money and GST | 8 |  | None | CA |
| RC-061 | The dealer's credit limit and overdue bills are checked once, when the order is confirmed; delivery, invoice and a repaired-vehicle handover never check again | Serious | Stock and trade | 2 |  | None |  |
| RC-062 | Negative-stock mode leaves a phantom stock value that never clears | Serious | Stock and trade | 1.5 | RC-024 (W1) | None |  |
| RC-063 | The books-healthy check compares one total and reads six separate snapshots, so most stock-versus-books leaks pass it | Serious | Tests and release process | 3 | RC-005 (W1) | None |  |
| RC-064 | A part already fitted can be deleted from a job card, so stock and cost have gone but nothing is ever billed, and cancelling the service invoice can restock parts that are on a customer's scooter | Serious | Stock and trade | 2 |  | Part-fixed (C) |  |
| RC-065 | Any sales user can create confirmed orders at any price through the marketplace import; blank prices become Rs 0 | Serious | Integrations | 2 | RC-037 (W1) | Part-fixed (C) |  |
| RC-066 | A statement can be filed under the wrong bank account when two accounts share a mail rule | Serious | Integrations | 2 |  | None |  |
| RC-067 | A Shopify cancellation that arrives before its order lets the cancelled order in, and a replayed signed body can cancel a live order | Serious | Integrations | 1.5 |  | None |  |
| RC-068 | A WhatsApp "STOP" is not recognised: from an unknown number it creates a consenting lead, from a known lead it makes the lead due now, and no opt-out can be recorded | Serious | Data protection and privacy | 2 | RC-032 (W1) | None | counsel |
| RC-069 | The money tests are weaker than they look: estimated mutation score 52 percent on the 25 most critical functions, no non-zero round-off invoice, and some assertions that cannot fail | Serious | Tests and release process | 3.5 |  | None |  |
| RC-070 | The backup script re-archives the whole uploads folder every day, so a single server runs out of disk within the first year | Moderate | Backup and operations | 0.5 |  | None |  |
| RC-071 | CI hygiene: no job timeouts, floating runner image, actions pinned by tag, no coverage or lint, and the Vercel build path is never built in CI | Moderate | Tests and release process | 1.5 | RC-005 (W1) | None |  |
| RC-073 | Base images are unpinned and never refreshed, so the server gets no operating-system, Node, PostgreSQL or Caddy security patches | Moderate | Backup and operations | 1.5 | RC-006 (W1) | None |  |
| RC-074 | Caddy records no access log, adds no security headers, limits no request size or time, and config changes may not take effect after an update | Moderate | Backup and operations | 1.5 |  | Part-fixed (A) |  |
| RC-075 | No memory or CPU limits, no log rotation, no read-only filesystem or dropped capabilities: one runaway container or full disk can take the database down | Moderate | Backup and operations | 1 |  | None |  |
| RC-076 | There is no host baseline and no infrastructure as code: hardening, patching, SSH, firewall, time and disk are all unwritten | Moderate | Backup and operations | 2 | RC-015 (W1) | None |  |
| RC-077 | Application logging is bare console.log: no request log, request id, levels, retention rule, scrubbing, or capture of browser and web-server errors | Moderate | Backup and operations | 2.5 | RC-007 (W1) | None |  |
| RC-078 | A database restart, network blip or stray unhandled error can end the API process | Moderate | Platform and performance | 0.5 |  | None |  |
| RC-079 | Stopping the API cuts requests short: shutdown does not wait for requests or stop the scheduler, and the stop signal may never reach Node | Moderate | Platform and performance | 0.5 |  | None |  |
| RC-080 | No lock, statement or connection timeouts: one stuck transaction or heavy report can freeze billing for everyone | Moderate | Platform and performance | 2 | RC-003 (W1) | None |  |
| RC-081 | The server starts with whatever settings it is given: nothing validates configuration, a missing NODE_ENV puts the books in a local file, and weak production secrets are accepted | Moderate | Platform and performance | 1.2 |  | Part-fixed (A) |  |
| RC-082 | Background jobs: the 15-minute in-process loop has no queue, retry, timeout, watchdog or overlap guard, the PRD jobs are missing, and on Vercel it runs once a day | Moderate | Platform and performance | 7 |  | None |  |
| RC-086 | Lists, pickers and exports silently stop at a fixed size: Show more fails, past 5,000 rows nothing can be reached or exported, pickers load only the first 2,000, and three downloads always fail | Moderate | Front end | 5 |  | None |  |
| RC-087 | Bank statement auto-matching is quadratic, runs on the web thread inside an open transaction, and a year of statements would freeze the API for minutes | Moderate | Platform and performance | 0.5 |  | None |  |
| RC-088 | Rate limits count in process memory so they reset on restart and are not shared between servers, and the public limit is both too tight for real customers and too weak against a bot | Moderate | Platform and performance | 2 | RC-005 (W1) | Part-fixed (A) |  |
| RC-090 | Password rules are weak, the admin chooses and knows everyone's password, and bcrypt ignores everything after 72 bytes and costs the web thread about two thirds of a second per login | Moderate | Access and identity | 2.5 |  | None |  |
| RC-091 | A session never really ends, and nobody can see or end other sessions | Moderate | Access and identity | 2 |  | None |  |
| RC-092 | Recording that an employee has left does not switch off their sign-in | Moderate | Access and identity | 0.5 |  | None |  |
| RC-093 | Manual journals can post to the GST, TDS, GRNI and payroll accounts, which the GST return never sees | Moderate | Money and GST | 1.5 | RC-012 (W1) | None |  |
| RC-094 | HR can set a new employee's salary and link a sign-in through Hire, and can change leave policy and attendance rules for everyone | Moderate | People and payroll | 0.5 | RC-033 (W1) | None |  |
| RC-095 | The permission matrix is cached per process, so a revoked permission stays granted on a second server copy, and one role list is hard-coded beside the table | Moderate | Access and identity | 1.25 |  | None |  |
| RC-096 | Anyone signed in can upload and open "other" and picture files with no limit, attachments are never deleted, and resumes are cached for an hour | Moderate | Data protection and privacy | 1.5 |  | None |  |
| RC-097 | After sign-in, a crafted next link such as /\evil.example sends the person to another website | Moderate | Front end | 0.25 |  | Fixed (A) |  |
| RC-098 | A salary change back-dated into an approved or paid month, and attendance or leave changes for such a month, are accepted silently | Moderate | People and payroll | 2.5 | RC-013 (W1) | Part-fixed (B) |  |
| RC-099 | A self clock-in can still overrule HR's absent mark, because HR edits never clear the self-marked flag | Moderate | People and payroll | 0.25 |  | None |  |
| RC-100 | A raise in the middle of a month is averaged over the month, so uneven attendance is paid at the wrong rate | Moderate | People and payroll | 1.5 |  | Fixed (B) |  |
| RC-101 | Weekly offs are paid even if the person was absent every working day, and public holidays have no calendar | Moderate | People and payroll | 2.5 |  | None | labour-law |
| RC-102 | Professional tax is a flat number per person (no state slabs, no February figure, charged on any earnings) and there is no Labour Welfare Fund | Moderate | People and payroll | 3.5 |  | None | labour-law |
| RC-103 | Overtime, bonus, gratuity, minimum wages and other statutory pay items are not modelled at all, and the payroll screens do not say so | Moderate | People and payroll | 0.5 |  | None | labour-law |
| RC-105 | On the attendance register, approving a leave request or any refresh silently wipes the marks typed but not yet saved | Moderate | Front end | 0.5 |  | None |  |
| RC-106 | GST on customs-agent, port and trucking charges paid in cash is added to the cost of the goods instead of claimed | Moderate | Money and GST | 3 | RC-014 (W1) | None | CA |
| RC-108 | The GSTR-3B screen has two lines, no cross-head set-off, and ignores the credit brought forward | Moderate | Money and GST | 4 | RC-012 (W1) | None | CA |
| RC-110 | A credit note can reduce output tax at any age, and a price discount cannot be a credit note at all | Moderate | Money and GST | 3 |  | None | CA |
| RC-111 | Invoice, credit note and receipt dates are unbounded, goods are delivered before they are invoiced, advances carry no GST rule, and the financial year follows the document date | Moderate | Money and GST | 5.5 | RC-025 (W1) | None | CA |
| RC-112 | An invoice can be issued while the company's own GSTIN, address and state are blank, and the state silently defaults to Maharashtra | Moderate | Money and GST | 0.5 | RC-022 (W1) | None |  |
| RC-113 | The printed invoice misses some Rule 46 particulars, a dealer saved without a GSTIN is reported as a consumer, and nothing stops a large anonymous cash bill | Moderate | Money and GST | 2 |  | None | CA |
| RC-114 | Cash has no limit: receipts of Rs 2 lakh or more in a day and payments above Rs 10,000 go through unmarked | Moderate | Money and GST | 1.5 |  | None | CA |
| RC-115 | No GST rate rows are loaded for the 22 September 2025 rate change, and a newer short-code rate loses to an older long-code one | Moderate | Money and GST | 0.5 |  | None | CA |
| RC-116 | E-invoice IRN, acknowledgement and QR cannot be entered or printed | Moderate | Front end | 1.5 |  | None | CA |
| RC-117 | The importers cannot read the files the sources produce: no Excel, comma-only CSV, UTF-8 only, and a 1 MB cap | Moderate | Integrations | 3 |  | None |  |
| RC-123 | A physical count that lists an item twice applies the difference twice | Moderate | Stock and trade | 0.25 |  | None |  |
| RC-124 | Rejected stock can be moved back to the sellable shelf, and a transfer cannot be undone | Moderate | Stock and trade | 1 |  | None |  |
| RC-125 | A part-delivered order can never be closed, and delivered goods cannot be taken back unless they are first invoiced | Moderate | Stock and trade | 3 |  | None |  |
| RC-126 | A cash sale returned across the counter cannot be refunded in the books, and cancelling an invoice deletes its receipts instead of recording a refund | Moderate | Money and GST | 1.5 |  | None |  |
| RC-128 | A unit that comes back into stock keeps its sale: customer warranty stays on, and a sold serial can be received again at goods-receipt QC | Moderate | Stock and trade | 0.5 | RC-027 (W1) | None |  |
| RC-130 | Job work can bring in a serialised finished good without creating its units, so it sits in stock but can never be sold | Moderate | Stock and trade | 1 | RC-026 (W1) | None |  |
| RC-131 | The "below cost" check compares with the last purchase rate, which any goods receipt can overwrite, and ignores landed cost | Moderate | Stock and trade | 0.5 |  | None |  |
| RC-132 | The "saved once" guard is optional, ignores what was sent, keeps whole answers (with link tokens) for a day, and half-finished jobs are not cleaned up | Moderate | Stock and trade | 4.5 |  | Part-fixed (A) |  |
| RC-136 | A genuine bank row can be dropped as "already present" when an in-and-out of the same amount repeats on a day | Moderate | Integrations | 1 |  | None |  |
| RC-137 | Statement mail intake loses files on a database error, can be starved by junk mail, and grows without bound | Moderate | Integrations | 2.5 |  | None |  |
| RC-139 | A returning Shopify customer's new delivery address is not recorded anywhere on the order | Moderate | Integrations | 1.5 |  | None |  |
| RC-140 | Shopify test orders, mismatched totals and wrong tax rates are all taken in as confirmed orders | Moderate | Integrations | 1.5 |  | None |  |
| RC-141 | Items are matched by SKU text only; the channel item map is built but never read | Moderate | Integrations | 2 |  | None |  |
| RC-142 | A reply or repeat enquiry from a lead that already exists makes no sound: no alert, and often no follow-up | Moderate | Integrations | 1.5 |  | None |  |
| RC-143 | The integration tests use hand-made payloads, enshrine today's gaps and never run the production path | Moderate | Tests and release process | 6 | RC-005 (W1) | None |  |
| RC-146 | No browser security headers on any screen or public page, the token pages can be indexed and cached, and new tabs keep a link back to the app | Moderate | Data protection and privacy | 1.5 | RC-048 (W1) | Part-fixed (A) |  |
| RC-147 | The "Signed out" dialog can be dismissed into an invisible dialog that freezes the whole page | Moderate | Front end | 0.25 |  | None |  |
| RC-149 | The app has no offline behaviour at all: a dropped connection shows "Failed to fetch" and unsaved work lives only on the screen | Moderate | Front end | 1 |  | None |  |
| RC-150 | The web app has no automated test, no linter and no CI step of its own, and no end-to-end test covers the five money flows | Moderate | Tests and release process | 7 | RC-005 (W1) | None |  |
| RC-151 | Some roles can open a screen they cannot complete (Operations job work, marketing walk-in), and some forms are shown to roles that will only be refused | Moderate | Front end | 1.5 |  | None |  |
| RC-152 | Printing depends entirely on the browser's print dialog: no paper size for the thermal roll, browser headers on the page, no PDF to send | Moderate | Front end | 1 |  | None |  |
| RC-153 | The permission sweep checks the code against itself: deleting a permission check from a route makes the sweep skip that route | Moderate | Tests and release process | 2 | RC-033 (W1) | None |  |
| RC-156 | Some tests depend on the date they run, use if around assertions, or sleep | Moderate | Tests and release process | 1 |  | None |  |
| RC-157 | No test makes the server fail halfway through a save, so "all or nothing" is tested only for clean refusals | Moderate | Tests and release process | 1.5 | RC-005 (W1) | None |  |
| RC-191 | Attachments live inside Postgres on Vercel, with a 4 MB cap, and are read whole into memory | Moderate | Hosting | 2.5 | RC-015 (W1) | None |  |
| RC-158 | Error tracking is home-made, blind to the browser, and its alert de-duplication is keyed on the full URL and resets on restart | Minor | Backup and operations | 1.5 | RC-007 (W1) | None |  |
| RC-160 | Searching by part of a name cannot use an index, and the database has no trigram support | Minor | Data model and database | 0.5 |  | None |  |
| RC-161 | The settings table holds configuration, hot job state and the period lock in one key space | Minor | Data model and database | 0.5 | RC-012 (W1) | None |  |
| RC-162 | Nothing ties a quantity to the item's unit of measure, so a Nos item can be ordered in fractions | Minor | Stock and trade | 1.5 | RC-008 (W1) | None |  |
| RC-163 | Closing a year or moving the lock does not wait for postings in flight, and postJournal checks the lock after dropping empty entries | Minor | Money and GST | 0.75 | RC-039 (W1) | None |  |
| RC-164 | Cost prices reach Operations through job work, and the masters workbook skips the cost filter | Minor | Access and identity | 0.5 |  | None |  |
| RC-165 | The cross-site check lets a request with no Origin header through | Minor | Access and identity | 0.25 |  | Part-fixed (A) |  |
| RC-166 | The bank list includes people with no account number or IFSC | Minor | People and payroll | 0.5 |  | None |  |
| RC-168 | The shared date check accepts days that do not exist (31 February), so a bad date reaches the database and returns a 500 | Minor | Libraries | 0.25 |  | None |  |
| RC-052 | The migration runner is not safe on a live database, and the "way back" that update.sh prints does not work | Serious | Backup and operations | 3.5 | RC-051 | None |  |
| RC-083 | Nobody outside the server watches the server: the health check says ok without touching the database, there is no uptime check, heartbeat, disk or crash alert, and Docker never acts on unhealthy | Serious | Backup and operations | 4 | RC-082 | Part-fixed (A) |  |
| RC-084 | Stuck webhook events are never retried or reported, so an expired Meta token silently loses leads, and webhooks are acknowledged after the work | Serious | Integrations | 4.5 | RC-082 | None |  |
| RC-089 | Password guessing is limited per address only, in memory, with no per-account lockout, and successful sign-ins count against the limit | Serious | Access and identity | 2 | RC-088 | Part-fixed (A) | security-test |
| RC-104 | PF and ESIC are worked from a made-up "Basic = 50% of gross": no real salary structure, no UAN or ESIC number, no ESIC contribution-period rule, employer extras missing | Serious | People and payroll | 7 | RC-103 | None | labour-law |
| RC-118 | A CSV statement with an unquoted "9,111.00" is imported as Rs 9, rows with unreadable dates vanish, and one crafted cell can freeze the whole API | Serious | Integrations | 2 | RC-117 | Part-fixed (C) |  |
| RC-133 | A failed save gets a fresh retry key, and several money and stock saves, including Receive goods and Save bill, sit outside the protected wrappers | Serious | Front end | 3 | RC-132 | None |  |
| RC-144 | A look-alike or forged sender still gets a bank statement mail imported and matched against real receipts | Serious | Integrations | 3.5 | RC-143 | Part-fixed (C) | security-test |
| RC-072 | The production image carries every development dependency, runs TypeScript through tsx at each start, and is built on the server | Moderate | Platform and performance | 3 | RC-051 | None |  |
| RC-107 | GSTR-1 leaves out nil-rated and exempt supplies, advances, e-commerce supplies and amendments, and mis-files 0% sales | Moderate | Money and GST | 4 | RC-059 | None | CA |
| RC-109 | GST is never settled in the books, and nothing ties each month's return to the ledger | Moderate | Money and GST | 3 | RC-108 | None | CA |
| RC-119 | The Vyapar import has never been tried on a real Vyapar file, and the file shape is an assumption | Moderate | Integrations | 2 | RC-117 | None |  |
| RC-122 | A hold on stock stays open after the goods leave from another place or with another serial, and the stock engine does not know about holds | Moderate | Stock and trade | 2.5 | RC-053 | None |  |
| RC-127 | Cancelling a vehicle booking leaves the lead booked for good and the customer's advance sitting unexplained | Moderate | Stock and trade | 1 | RC-126 | None |  |
| RC-129 | A supplier return debits the supplier whether or not the rejected goods were ever billed, picks the latest bill, and cannot be undone | Moderate | Stock and trade | 3 | RC-056 | None |  |
| RC-148 | Drop-downs that act the moment their value changes: arrow keys add items to a bill or reconcile a bank line | Moderate | Front end | 0.5 | RC-086 | None |  |
| RC-159 | No error screen, loading screen or not-found page anywhere, and a render error shows Next's blank error page and loses the typed work | Moderate | Front end | 0.75 | RC-158 | None |  |
| RC-085 | Shopify edits, payments and refunds after the first message are thrown away | Serious | Integrations | 5 | RC-084 | None |  |
| RC-120 | Unpaid bills are not brought in one by one from Vyapar, so old invoices cannot be returned, credited or chased | Serious | Money and GST | 6 | RC-038 (W1), RC-119 | None | CA |
| RC-121 | The Vyapar compare screen is a three-list snapshot, not a parallel-month reconciliation | Serious | Money and GST | 5 | RC-119 | None |  |
| RC-145 | Bank lines are matched to the books on amount and date alone, including lines that arrived by email | Serious | Integrations | 2 | RC-144 | Part-fixed (C) |  |
| RC-134 | Cancellations and reversals record a made-up reason instead of the person's | Moderate | Front end | 1 | RC-133 | None |  |
| RC-135 | PDF and email statement parsing run inside the web server's own thread with no time or memory cap, and the PDF reading is not verified when there are few balances | Moderate | Integrations | 2.5 | RC-118 | None |  |
| RC-154 | The default test engine differs from production: PostgreSQL 17 in memory with one connection, fresh installs only, and no migration tests | Moderate | Tests and release process | 2 | RC-005 (W1), RC-052 | None |  |
| RC-155 | Production code paths run differently under test: rate limiters are off, webhooks are awaited, passwords hash with 4 rounds | Moderate | Tests and release process | 1 | RC-088, RC-084 | None |  |
| RC-167 | The regular tests do not pin the statutory payroll numbers, and the proofs of the open payroll holes live in an untracked folder | Minor | Tests and release process | 2 | RC-104 | None |  |
| RC-138 | A Shopify order that was paid online becomes an unpaid invoice, so customers who already paid can be chased | Moderate | Integrations | 4 | RC-085 | None |  |
|  | Wave 2 total: 120 items |  |  | 267.95 |  |  |  |

### Wave 2 by code area
| Code area | Items | Days | Items closed or part-closed on a review branch |
| Books, GST and tax modules | 19 | 61.25 | 0 |
| Integrations (Shopify, Meta, WhatsApp, bank import) | 19 | 46 | 4 |
| Tests, CI and release | 12 | 33.5 | 0 |
| Sales, purchasing and stock modules | 16 | 31.75 | 3 |
| Deploy, backup and operations scripts | 12 | 23.75 | 2 |
| Sign-in, roles, audit and privacy | 11 | 19 | 3 |
| Payroll, HR and CRM modules | 9 | 18.75 | 2 |
| Platform, jobs and performance | 8 | 16.7 | 2 |
| Front end screens (apps/web) | 12 | 16.25 | 1 |
| Database schema and migrations | 2 | 1 | 0 |

### Wave 2 fortnight by fortnight, two developers
A fortnight is 9 productive developer-days. Total days split between the two developers:
| Code area | Developer A days | Developer B days |
| Books, GST and tax modules | 61.25 | 0 |
| Integrations (Shopify, Meta, WhatsApp, bank import) | 29.5 | 16.5 |
| Tests, CI and release | 0 | 33.5 |
| Sales, purchasing and stock modules | 12.75 | 19 |
| Deploy, backup and operations scripts | 0.25 | 23.5 |
| Sign-in, roles, audit and privacy | 10 | 9 |
| Payroll, HR and CRM modules | 11.25 | 7.5 |
| Platform, jobs and performance | 9 | 7.7 |
| Front end screens (apps/web) | 0 | 16.25 |
| Database schema and migrations | 0 | 1 |
| Total | 134 | 133.95 |

| Fortnight | Developer A | Developer B | Days started |
| 1 | Platform, jobs and performance: RC-082 (7), RC-088* (2) | Tests, CI and release: RC-143 (6), RC-051 (3) | 18 |
| 2 | Integrations (Shopify, Meta, WhatsApp, bank import): RC-084 (4.5), RC-117 (3), RC-085 (5) | Tests, CI and release: RC-069 (3.5), RC-063 (3)Payroll, HR and CRM modules: RC-103 (0.5), RC-104 (7) | 26.5 |
| 3 | Integrations (Shopify, Meta, WhatsApp, bank import): RC-119 (2), RC-144* (3.5)RC-085 continues | Sales, purchasing and stock modules: RC-132* (4.5)RC-104 continues | 10 |
| 4 | Integrations (Shopify, Meta, WhatsApp, bank import): RC-118* (2), RC-054 (2), RC-065* (2), RC-066 (2), RC-145* (2) | Sales, purchasing and stock modules: RC-056* (4.5), RC-053 (3), RC-061 (2)RC-132 continues | 19.5 |
| 5 | Integrations (Shopify, Meta, WhatsApp, bank import): RC-067 (1.5)Books, GST and tax modules: RC-060 (8)RC-145 continues | Sales, purchasing and stock modules: RC-064* (2), RC-062 (1.5)Deploy, backup and operations scripts: RC-052 (3.5), RC-083* (4)RC-061 continues | 20.5 |
| 6 | Books, GST and tax modules: RC-059 (3.5), RC-120 (6)RC-060 continues | Deploy, backup and operations scripts: RC-050 (3)Sign-in, roles, audit and privacy: RC-055 (5)RC-083 continues | 17.5 |
| 7 | Books, GST and tax modules: RC-057 (5), RC-121 (5)RC-120 continues | Sign-in, roles, audit and privacy: RC-068 (2), RC-089* (2)Front end screens (apps/web): RC-133 (3)RC-055 continues | 17 |
| 8 | Books, GST and tax modules: RC-058 (3), RC-108 (4)RC-121 continues | Front end screens (apps/web): RC-086 (5), RC-116 (1.5), RC-151 (1.5), RC-134 (1) | 16 |
| 9 | Books, GST and tax modules: RC-111 (5.5), RC-107 (4)RC-108 continues | Front end screens (apps/web): RC-149 (1), RC-152 (1), RC-105 (0.5), RC-148 (0.5), RC-097† (0.25), RC-147 (0.25)Tests, CI and release: RC-150 (7) | 20 |
| 10 | Books, GST and tax modules: RC-106 (3), RC-109 (3), RC-110 (3)RC-107 continues | Tests, CI and release: RC-153 (2), RC-154 (2), RC-071 (1.5), RC-157 (1.5), RC-155 (1)RC-150 continues | 17 |
| 11 | Books, GST and tax modules: RC-126 (1.5), RC-113 (2), RC-093 (1.5), RC-114 (1.5), RC-112 (0.5), RC-115 (0.5)RC-110 continues | Tests, CI and release: RC-156 (1)Integrations (Shopify, Meta, WhatsApp, bank import): RC-138 (4), RC-135 (2.5), RC-137 (2.5)RC-155 continues | 17.5 |
| 12 | Payroll, HR and CRM modules: RC-102 (3.5), RC-098* (2.5), RC-101 (2.5), RC-100† (1.5) | Integrations (Shopify, Meta, WhatsApp, bank import): RC-141 (2), RC-139 (1.5), RC-140 (1.5), RC-142 (1.5), RC-136 (1)RC-137 continues | 17.5 |
| 13 | Payroll, HR and CRM modules: RC-094 (0.5), RC-099 (0.25)Sales, purchasing and stock modules: RC-125 (3), RC-129 (3), RC-122 (2.5)RC-100 continues | Platform, jobs and performance: RC-072 (3), RC-080 (2), RC-081* (1.2), RC-078 (0.5), RC-079 (0.5), RC-087 (0.5)Deploy, backup and operations scripts: RC-077 (2.5) | 19.45 |
| 14 | Sales, purchasing and stock modules: RC-124 (1), RC-127 (1), RC-130 (1), RC-128 (0.5), RC-131 (0.5), RC-123 (0.25)Sign-in, roles, audit and privacy: RC-090 (2.5), RC-091 (2)RC-122 continues | Deploy, backup and operations scripts: RC-191 (2.5), RC-158 (1.5), RC-076 (2), RC-073 (1.5), RC-074* (1.5)RC-077 continues | 17.75 |
| 15 | Sign-in, roles, audit and privacy: RC-096 (1.5), RC-146* (1.5), RC-095 (1.25), RC-092 (0.5), RC-164 (0.5), RC-165* (0.25)Books, GST and tax modules: RC-163 (0.75)Payroll, HR and CRM modules: RC-166 (0.5)Deploy, backup and operations scripts: RC-168 (0.25)RC-091 continues | Deploy, backup and operations scripts: RC-075 (1), RC-070 (0.5)Front end screens (apps/web): RC-159 (0.75)Tests, CI and release: RC-167 (2)Sales, purchasing and stock modules: RC-162 (1.5)Database schema and migrations: RC-160 (0.5), RC-161 (0.5)RC-074 continues | 13.75 |

Notes on the Wave 2 plan.
- Background jobs (RC-082), webhook retry (RC-084), the idempotency guard (RC-132) and monitoring (RC-083) start in the first five fortnights because many later items, including the Shopify, bank and notification work, wait for them.
- The accountant's items (24 Wave 2 items need an expert, 81.5 days) are scheduled in the plan where the code is free, but cannot finish until the chartered accountant has supplied the rule or rate table. Ask for those answers during Wave 1 so they are ready (section 8).
- Gate 1 can open before Wave 2 is complete. The parallel month needs the import tools, the compare screen and the monitoring, not every Wave 2 item. The checklist's Gate 1 lines show which. Do the items those lines test first; the plan above is ordered by dependency and code area, so reorder within a fortnight to match the gate.
- Checkpoint: re-estimate at the start of Wave 2 with the actual-to-planned ratio from Wave 1.
## 4.3 Wave 3: the first three months after go-live (53 items, 160.55 days)
Why Wave 3 comes last: hardening, polish and the larger builds (e-invoicing integration, offline, push, AI readiness, scale work). The system can run without them if the stand-ins in the go-live checklist are used. It holds 5 Serious, 23 Moderate and 25 Minor items.
Wave 3 by level: Serious 5 (34 days), Moderate 23 (103.5 days), Minor 25 (23.05 days).
### Every Wave 3 item
| RC id | Title | Level | Theme | Days | Depends on | Branch status | Needs expert |
| RC-169 | Salary TDS (Section 192) is not calculated: it is a flat monthly number someone types, with no PAN, regime, declarations or return data | Serious | People and payroll | 17.5 | RC-103 (W2) | None | CA |
| RC-170 | No e-invoice or e-way bill integration: a live IRN does not stop a cancel | Serious | Money and GST | 12 | RC-082 (W2) | None | CA |
| RC-171 | Permission checks live only in the route files and response filters, so any AI layer that calls service functions would bypass them | Serious | AI readiness | 1 | RC-042 (W1) | None |  |
| RC-172 | A purchase bill has no draft state and posts to the books the moment it is created, and no bill file is linked to a bill | Serious | AI readiness | 2 | RC-056 (W2) | None |  |
| RC-174 | CI never exercises the deploy path: backup, restore, Caddy and the update script are not run | Moderate | Tests and release process | 2 | RC-017 (W1), RC-051 (W2) | None |  |
| RC-175 | Seven files of 700 to 1,400 lines mix routes, SQL and business rules, so the background worker cannot reuse a service without loading the web layer | Moderate | Platform and performance | 7 |  | None |  |
| RC-176 | Lists and reports add up a whole ledger before they keep 100 rows, so 8 of the 15 heaviest screens take 1 to 12 seconds at 50,000 rows | Moderate | Platform and performance | 10 | RC-025 (W1) | None |  |
| RC-177 | Opening the home screen, the owner dashboard or any task screen writes to the database | Moderate | Platform and performance | 0.5 | RC-082 (W2) | None |  |
| RC-178 | Clock-in is not verified: location is advisory and sent by the phone, any time of day counts, a missing clock-out is a full day, and a night shift cannot clock out | Moderate | People and payroll | 3 | RC-099 (W2) | None |  |
| RC-179 | The leave module is a single flat allowance: no types, no balance check when leave is asked for, no carry forward or encashment, no accrual, a leaver gets the full year | Moderate | People and payroll | 7 | RC-098 (W2) | None | labour-law |
| RC-181 | The TDS flow stops at the deposit: no quarterly return file, no certificates, no interest or late fee, and the seeded rates carry no usable section reference | Moderate | Money and GST | 3 | RC-060 (W2) | None | CA |
| RC-182 | Supplier warranty claims are not de-duplicated or capped, and the supplier's credit is booked without a document or GST | Moderate | Stock and trade | 2.5 |  | None |  |
| RC-183 | Available stock is not pushed back to Shopify, so the store can sell goods RadCore has already sold | Moderate | Integrations | 9 | RC-082 (W2), RC-141 (W2) | None |  |
| RC-184 | WhatsApp sending: a timeout says "nothing was sent" when it may have been, there are no approved templates, and delivery failures are never seen | Moderate | Integrations | 5 | RC-068 (W2) | None |  |
| RC-185 | Lead alerts exist only while a tab is open, and the phone notification call is the wrong one | Moderate | Front end | 6.5 | RC-084 (W2) | None |  |
| RC-186 | The screens share no validation with the API and have no typed contract with it | Moderate | Front end | 10 | RC-150 (W2) | None |  |
| RC-188 | The data layer re-fetches on every keystroke, shows the previous answer under a new filter, and never refreshes the bell, the session or the permissions | Moderate | Front end | 5 |  | None |  |
| RC-189 | Accessibility (WCAG 2.2 AA): several failures touch every screen type | Moderate | Front end | 3 | RC-150 (W2) | None |  |
| RC-190 | Quick bill is not yet a Vyapar-speed counter screen | Moderate | Front end | 7 | RC-148 (W2) | None |  |
| RC-192 | On Vercel the migration runs inside every branch build as the database owner while the old version keeps serving, and the connection pooler split is not set up | Moderate | Hosting | 1.25 | RC-015 (W1) | None |  |
| RC-193 | The only database login can write everywhere, and there is no read-only login or replica | Moderate | AI readiness | 1 | RC-003 (W1) | None |  |
| RC-194 | Authenticated routes have no per-user rate limit or spend cap | Moderate | AI readiness | 1 | RC-088 (W2) | None |  |
| RC-195 | No recorded legal basis or notice for AI processing | Moderate | AI readiness | 1 | RC-032 (W1) | None | counsel |
| RC-197 | 57 of 402 routes are not exercised by any behaviour test; 32 are never named at all, including price-list approval and change-password | Moderate | Tests and release process | 3 | RC-153 (W2) | None |  |
| RC-198 | The development compose file publishes PostgreSQL on every network interface with a known password | Minor | Backup and operations | 0.1 |  | None |  |
| RC-199 | The camelCase-to-snake_case layer burns CPU on every row: 3.8 seconds of one core for a 50,000-row answer | Minor | Platform and performance | 0.25 |  | None |  |
| RC-200 | Settings, the default company and account ids are looked up again for every document; a numbered document costs five queries to get its number | Minor | Platform and performance | 1 |  | None |  |
| RC-201 | Node closes idle connections after 65 seconds but Caddy keeps them for 2 minutes, so an occasional request can hit a closed connection | Minor | Platform and performance | 0.1 |  | None |  |
| RC-202 | Date filters on timestamps convert every row, so they cannot use an index | Minor | Platform and performance | 1 | RC-025 (W1) | None |  |
| RC-203 | Small input-handling gaps: search wildcards are not escaped, the 5,000-row page applies to every role, and phone numbers get an apostrophe in CSV | Minor | Access and identity | 0.5 | RC-041 (W1) | Part-fixed (A) |  |
| RC-204 | Follow-up times use the device's time zone on the older screens, and "today" comes from the device clock | Minor | Front end | 0.5 |  | None |  |
| RC-205 | The moving average includes rejected, job-work and demo stock | Minor | Stock and trade | 1 | RC-124 (W2) | None |  |
| RC-206 | Journal entry numbers are a database sequence, so they have gaps | Minor | Money and GST | 0.5 |  | None |  |
| RC-207 | Taking back a cancelled credit note is recorded as another "sales return in", and a re-delivered line is costed with the reversed delivery | Minor | Stock and trade | 0.5 |  | None |  |
| RC-208 | The vehicle delivery checklist accepts any file as the photo or signed note, ignores the order's state, and a vehicle item need not be serialised | Minor | Stock and trade | 0.5 |  | None |  |
| RC-209 | Resource allocation can be over-booked by two people at the same moment, and project owners can reassign ownership | Minor | Stock and trade | 0.5 |  | None |  |
| RC-210 | Unmatching a bank line leaves a booked bank fee behind, and one book entry can never be split over two bank lines | Minor | Integrations | 2 |  | None |  |
| RC-211 | Smaller CRM points: the manual WhatsApp send has no per-user limit or opt-out check, templates change without an audit row, and a repeat enquiry silently reopens a lost lead | Minor | Integrations | 1 | RC-068 (W2) | None |  |
| RC-212 | The lead-sources "ignore" button can set aside a Shopify or marketplace order | Minor | Integrations | 0.25 |  | None |  |
| RC-213 | Integration tokens and the secret box: no expiry watch, the Meta token travels in the URL, one Shopify secret, and the secret box has no key rotation and accepts a short tag | Minor | Integrations | 2 |  | None |  |
| RC-214 | The first-load JavaScript is fine; the render waterfall is the real cost | Minor | Front end | 1 |  | None |  |
| RC-215 | Money decisions in the browser use JavaScript floating point, though the shared Decimal helpers exist | Minor | Front end | 1 |  | None |  |
| RC-216 | Two small design smells that will bite later: matching on an error message, and a module-level retry key | Minor | Front end | 0.5 | RC-133 (W2) | None |  |
| RC-217 | Hindi and other-language readiness: numbers and dates are right, text is hard-coded English | Minor | Front end | 5 |  | None |  |
| RC-218 | A saved "board or list" choice is applied after the first draw, so the wrong view is fetched first | Minor | Front end | 0.25 |  | None |  |
| RC-219 | The iPhone home-screen app may draw under the notch: the viewport does not ask for the full screen | Minor | Front end | 0.1 |  | None |  |
| RC-220 | Dependencies are declared but unused, one drags in ten old packages, and nothing checks the manifests or the Node version | Minor | Libraries | 0.5 |  | None |  |
| RC-221 | Small follow-ups recorded beside verified controls: a lint rule against raw SQL and dangerouslySetInnerHTML, a host check on Meta paging URLs, one dev-tool override, a licence report and two writer safeguards | Minor | Libraries | 1 |  | None |  |
| RC-222 | Story tests depend on order and share a mutable record of ids, so a single test cannot be run on its own | Minor | Tests and release process | 2 |  | None |  |
| RC-173 | Free text from outsiders (WhatsApp, lead forms, complaints) is stored in the same fields as staff notes, so an AI cannot tell data from instruction | Serious | AI readiness | 1.5 | RC-171 | None |  |
| RC-180 | Leaving the company has no final settlement: advances are stranded, and leave, notice and gratuity are not handled | Moderate | People and payroll | 3.5 | RC-179, RC-092 (W2) | None | labour-law |
| RC-187 | ui.tsx has outgrown itself, and money screens work around its Form | Moderate | Front end | 12 | RC-186 | None |  |
| RC-196 | Two known accounting defects (credit on unregistered suppliers, bills at the wrong price) would be made easier to hit by bill reading | Moderate | AI readiness | 0.25 | RC-014 (W1), RC-056 (W2), RC-172 | Part-fixed (C) |  |
|  | Wave 3 total: 53 items |  |  | 160.55 |  |  |  |

### Wave 3 by code area
| Code area | Items | Days | Items closed or part-closed on a review branch |
| Front end screens (apps/web) | 13 | 51.85 | 0 |
| Payroll, HR and CRM modules | 4 | 31 | 0 |
| Platform, jobs and performance | 7 | 19.85 | 0 |
| Integrations (Shopify, Meta, WhatsApp, bank import) | 6 | 19.25 | 0 |
| Books, GST and tax modules | 3 | 15.5 | 0 |
| AI readiness | 7 | 7.75 | 1 |
| Tests, CI and release | 3 | 7 | 0 |
| Sales, purchasing and stock modules | 5 | 5 | 0 |
| Deploy, backup and operations scripts | 4 | 2.85 | 0 |
| Sign-in, roles, audit and privacy | 1 | 0.5 | 1 |

### Wave 3 fortnight by fortnight, two developers
| Code area | Developer A days | Developer B days |
| Front end screens (apps/web) | 8.35 | 43.5 |
| Payroll, HR and CRM modules | 13.5 | 17.5 |
| Platform, jobs and performance | 17.5 | 2.35 |
| Integrations (Shopify, Meta, WhatsApp, bank import) | 14 | 5.25 |
| Books, GST and tax modules | 12.5 | 3 |
| AI readiness | 7.75 | 0 |
| Tests, CI and release | 0 | 7 |
| Sales, purchasing and stock modules | 0 | 5 |
| Deploy, backup and operations scripts | 2.85 | 0 |
| Sign-in, roles, audit and privacy | 0.5 | 0 |
| Total | 76.95 | 83.6 |

| Fortnight | Developer A | Developer B | Days started |
| 1 | AI readiness: RC-171 (1), RC-172 (2), RC-173 (1.5), RC-193 (1), RC-194 (1), RC-195 (1), RC-196* (0.25)Payroll, HR and CRM modules: RC-179 (7) | Front end screens (apps/web): RC-186 (10) | 24.75 |
| 2 | Payroll, HR and CRM modules: RC-180 (3.5)RC-179 continues | Front end screens (apps/web): RC-187 (12)RC-186 continues | 15.5 |
| 3 | Payroll, HR and CRM modules: RC-178 (3)Platform, jobs and performance: RC-176 (10)RC-180 continues | Front end screens (apps/web): RC-190 (7)RC-187 continues | 20 |
| 4 | Platform, jobs and performance: RC-175 (7)RC-176 continues | Front end screens (apps/web): RC-185 (6.5), RC-188 (5)RC-190 continues | 18.5 |
| 5 | Platform, jobs and performance: RC-177 (0.5)Integrations (Shopify, Meta, WhatsApp, bank import): RC-183 (9)RC-175 continues | Front end screens (apps/web): RC-189 (3)Books, GST and tax modules: RC-181 (3)RC-188 continues | 15.5 |
| 6 | Integrations (Shopify, Meta, WhatsApp, bank import): RC-184 (5)Deploy, backup and operations scripts: RC-192 (1.25)RC-183 continues | Tests, CI and release: RC-197 (3), RC-174 (2)Sales, purchasing and stock modules: RC-182 (2.5)RC-181 continues | 13.75 |
| 7 | Deploy, backup and operations scripts: RC-221 (1), RC-220 (0.5), RC-198 (0.1)Front end screens (apps/web): RC-217 (5), RC-214 (1), RC-215 (1), RC-204 (0.5) | Sales, purchasing and stock modules: RC-205 (1), RC-207 (0.5), RC-208 (0.5), RC-209 (0.5)Integrations (Shopify, Meta, WhatsApp, bank import): RC-210 (2), RC-213 (2), RC-211 (1), RC-212 (0.25)Tests, CI and release: RC-222 (2) | 18.85 |
| 8 | Front end screens (apps/web): RC-216 (0.5), RC-218 (0.25), RC-219 (0.1)Sign-in, roles, audit and privacy: RC-203* (0.5)Books, GST and tax modules: RC-206 (0.5), RC-170 (12)RC-204 continues | Platform, jobs and performance: RC-200 (1), RC-202 (1), RC-199 (0.25), RC-201 (0.1)Payroll, HR and CRM modules: RC-169 (17.5)RC-222 continues | 33.7 |
| 9 | RC-170 continues | RC-169 continues | 0 |
| 10 | (finishing earlier work or waiting on a dependency) | RC-169 continues | 0 |

Notes on the Wave 3 plan.
- Wave 3 does not fit in the first three months with two developers. It needs 17.8 weeks with two developers and 11.9 with three by formula (18.6 and 12.6 as sequenced), against about 13 weeks. The largest items are RC-169 (17.5), RC-170 (12), RC-176 (10), RC-187 (12), RC-186 (10) (together 61.5 days). The plan above already puts salary TDS (RC-169) and the e-invoice integration (RC-170) last, by hand, because the go-live checklist gives each a stand-in and both wait for the accountant. If the owner wants to stay inside three months with two developers, these two go past the window first (17.5 and 12 days), then the front-end redesign items (RC-186, RC-187).
- Wave 3 is where the planned builds in section 7 would also land, which makes the three-month window tighter still.
- RC-170 may move. If the chartered accountant says e-invoicing applies to Radboards, RC-170 (12 days) becomes a Wave 2 gate and the go-live date moves with it.
- Re-plan at the end of month one with the actual-to-planned ratio and the real list of what the first weeks of live running turned up.
# 5. The critical path
The critical path is the longest chain of items that must be done one after another, using the register's dependsOn field, counted in days. It was computed by a script over the items of each wave. A prerequisite in an earlier wave is treated as already done. No dependency points to a later wave. It is a floor: no number of developers brings a wave below the length of its chain, and in practice the chain also sets which work must start first.
| Wave | Longest chain (days) | Items on the chain | Weeks at 4.5 days a week | Number of developers at which the chain would start to limit the wave |
| Wave 1 | 16 | 4 | 3.6 | 7.5 |
| Wave 2 | 20.5 | 4 | 4.6 | 13.1 |
| Wave 3 | 22 | 2 | 4.9 | 7.3 |

The last column is the wave's total days divided by its chain length. Below that number of developers, the amount of work, not the chain, decides the calendar. All three are above three, so with one to three developers the chain never limits the calendar.
For information, the longest chain that runs across all waves is 4 items, 30.5 days: RC-005 > RC-150 > RC-186 > RC-187. It starts in Wave 1 (the real-database CI job, RC-005), passes through the web test harness in Wave 2 (RC-150) and the form library in Wave 3 (RC-186), and ends at the front-end building blocks (RC-187).
## 5.1 Wave 1 chain
| Step | RC id | Title | Days | Running total |
| 1 | RC-003 | The database owner password sits in the API container environment, and the app login keeps UPDATE and DELETE rights... | 2 | 2 |
| 2 | RC-011 | There is no way to erase, anonymise or time-limit personal data, and the audit log and event tables keep full copies... | 6 | 8 |
| 3 | RC-030 | The audit trail depends on about 185 hand-written audit() calls; updated_at is not maintained and updated_by does... | 4 | 12 |
| 4 | RC-031 | 33 of the 230 write routes leave no audit entry, including every login, password change and almost every export | 4 | 16 |

Reading it: the database owner login and rights (RC-003) come first, then the personal-data erase and retention design (RC-011), then the audit trail design (RC-030), then the missing audit records (RC-031). Start this chain in week 1 and give it to one developer so it never waits.
## 5.2 Wave 2 chain
| Step | RC id | Title | Days | Running total |
| 1 | RC-082 | Background jobs: the 15-minute in-process loop has no queue, retry, timeout, watchdog or overlap guard, the PRD jobs... | 7 | 7 |
| 2 | RC-084 | Stuck webhook events are never retried or reported, so an expired Meta token silently loses leads, and webhooks are... | 4.5 | 11.5 |
| 3 | RC-085 | Shopify edits, payments and refunds after the first message are thrown away | 5 | 16.5 |
| 4 | RC-138 | A Shopify order that was paid online becomes an unpaid invoice, so customers who already paid can be chased | 4 | 20.5 |

Reading it: the background job runner (RC-082) comes before webhook retry (RC-084), which comes before the Shopify edits and refunds work (RC-085), then the Shopify paid-online fix (RC-138).
## 5.3 Wave 3 chain
| Step | RC id | Title | Days | Running total |
| 1 | RC-186 | The screens share no validation with the API and have no typed contract with it | 10 | 10 |
| 2 | RC-187 | ui.tsx has outgrown itself, and money screens work around its Form | 12 | 22 |

Reading it: the form library (RC-186) must come before the building blocks (RC-187).
# 6. Resourcing scenarios
Assumptions.
- Productive developer-days per week: 4.5 per developer, for one, two or three developers.
- Calendar weeks by formula = the larger of (wave days divided by (developers x 4.5)) and (the wave's critical path divided by 4.5). The second term is the critical path floor. It never applies in these scenarios (section 5), so the formula equals the first term.
- "Sequenced" weeks are from the code-area schedule of section 4, built the same way for one, two and three developers. It cannot be shorter than the formula, because it also respects one developer per code area at a time, so it shows the cost of keeping developers out of each other's files.
- The days are the same whatever the number of developers. More developers shorten the calendar, not the effort, and the formula takes no hours for coordination between them. The code-area split is there to keep that small.
- Waiting time for experts, owner decisions and the parallel month is not included (sections 8 and 9).
| Wave | Developer-days | Critical path (days) | Critical path floor (weeks) | 1 dev (weeks) | 2 devs (weeks) | 3 devs (weeks) | Sequenced 1 dev | Sequenced 2 devs | Sequenced 3 devs |
| Wave 1 | 120.25 | 16 | 3.6 | 26.7 | 13.4 | 8.9 | 26.7 | 14.0 | 10.0 |
| Wave 2 | 267.95 | 20.5 | 4.6 | 59.5 | 29.8 | 19.8 | 59.5 | 29.8 | 20.3 |
| Wave 3 | 160.55 | 22 | 4.9 | 35.7 | 17.8 | 11.9 | 35.7 | 18.6 | 12.6 |

Road to go-live, Waves 1 and 2 together (weeks, one wave after the other):
| Developers | Waves 1 and 2 by formula (weeks) | Waves 1 and 2 as sequenced (weeks) |
| 1 | 86.3 | 86.3 |
| 2 | 43.1 | 43.8 |
| 3 | 28.8 | 30.3 |

To cost it: multiply the developer-days by your developer's day rate. For example, Wave 1 is 120.25 days, so the cost is 120.25 times the rate. The days do not change with the number of developers; only the calendar does.
What the scenarios say.
- One developer needs about 86.3 weeks to reach go-live. That is the base case for a single in-house developer and it is long.
- Two developers bring go-live to about 43.1 weeks by formula (43.8 sequenced), and Wave 3 to 17.8 weeks (18.6 sequenced).
- Three developers bring go-live to about 28.8 weeks (30.3 sequenced) and Wave 3 to 11.9 weeks (12.6 sequenced), which is the only scenario that comes close to fitting Wave 3 into about 13 weeks.
- With the band of section 2.2, Wave 1 with two developers runs from 12.8 to 13.6 weeks, Wave 2 from 26.9 to 29.9 weeks and Wave 3 from 14.9 to 19.8 weeks.
- The shortest route to go-live (added by the lead, computed from master-register.json). The go-live checklist (07-Go-Live-Checklist.md) makes 80 items mandatory: all 49 of Wave 1 (120.25 days) and the 31 Serious Wave 2 items (107 days). Seven other Wave 2 items are prerequisites of those through dependsOn and must come too: RC-082 background jobs (7 days), RC-088 shared rate limits (2), RC-103 statutory pay items (0.5), RC-117 importers for Excel and other formats (3), RC-119 Vyapar import on a real file (2), RC-132 server-side saved-once guard (4.5) and RC-143 integration tests with recorded fixtures (6), together 25 days. That is 87 items and 252.25 developer-days: 28.0 weeks with two developers, 18.7 with three, 56.1 with one (4.5 productive days a week, the same formula as above). The remaining 82 Wave 2 items (72 Moderate and 10 Minor) are not gates; doing them after go-live is a risk the owner chooses, not a recommendation of the review.
- The calendar can be longer for reasons outside the days: an expert's turnaround, the parallel month (which is a month of elapsed time regardless of developer count), and decisions not yet made.
# 7. Planned builds that are not defects
These are new features described in 06-Frontend-and-AI-Design-Notes.md. They are not in the 222 items or the 548.75 days above, except where a register item overlaps; the overlap is shown so nobody adds both. The figures are the design notes' estimates from a code read, for one developer who knows the code. None of this has been built or run.
## 7.1 Front-end builds
Steps A-0, A-1 and A-12 of the front-end plan are before go-live and are already register Wave 2 items: RC-133 (W2, 3), RC-147 (W2, 0.25), RC-086 (W2, 5), RC-097 (W2, 0.25), RC-159 (W2, 0.75), RC-150 (W2, 7), RC-146 (W2, 1.5), RC-116 (W2, 1.5), RC-113 (W2, 2). The steps below are the builds that come after.
| Step | What | Report effort (days) | Register items that overlap (wave, days); do not add both | Needs first |
| A-2 | Shared data layer | 5 (4 to 6) | RC-188 (W3, 5), RC-214 (W3, 1) | A-1 test harness (RC-150) |
| A-3 | Shared schemas and form library | 8 to 12 | RC-186 (W3, 10) | A-2 |
| A-4 | Building blocks, tokens, accessibility | 10 to 15 | RC-187 (W3, 12), RC-189 (W3, 3) | A-2, A-3 |
| A-5 | Server prerequisites (search, catalogue delta, client_ref, notification tables, one-minute dispatcher) | 6 to 8 | RC-086 (W2, 5), RC-132 (W2, 4.5), RC-082 (W2, 7) | A-1; RC-082, RC-132 (pieces of the work sit inside these items) |
| A-6 | Counter v2: bill screen, hold and recall, one-tap print, party ledger card, day close, PDF | 10 to 14 | RC-190 (W3, 7), RC-152 (W2, 1), RC-113 (W2, 2), RC-116 (W2, 1.5) | A-4, A-5; printer trial on the shop's own printer |
| A-7 | Service worker and read-only offline catalogue | 5 | RC-185 (W3, 6.5), RC-149 (W2, 1) | A-5, A-6 |
| A-8 | Offline sale outbox: provisional bills, sync, conflict tray | 12 to 15 | None: not in the register | A-7; owner and CA decision on offline invoice numbering |
| A-9 | Push alerts | 7 to 10 | RC-185 (W3, 6.5) | A-5, A-7; RC-097, RC-082, RC-084 |
| A-10 | Lead inbox and WhatsApp template picker | 6 to 8 | RC-184 (W3, 5) | A-4; A-9 for instant arrival; RC-041, RC-068; business WhatsApp number and Meta template approval |
| A-11 | Hindi and bilingual counter screens and invoice | 4 to 6 | RC-217 (W3, 5) | A-6; a translator or reviewer |
|  | Sum of the steps above | 73 to 98 |  |  |

The steps sum to 73 to 98 developer-days (A-2 taken at its 5-day point). With A-0, A-1 and A-12 (9 days) the design notes quote 82 to 107 for the whole redesign and about 10 to 14 calendar weeks for two developers. The register's front-end theme does not contain A-5, A-8, A-10 or the PDF, so the 548.75 days do not cover this redesign.
## 7.2 AI features
There is no AI code in RadCore today. The design notes recommend building in this order, each phase on safe foundations (role binding, draft-only, audit of every AI action):
| Phase | What | Report effort (days) | Register items that overlap (wave, days); do not add both | Needs first |
| B-0 | AI foundations: leaks closed, telemetry, tool registry and executor, ai_events and redactor, queue, read-only login, idempotency | about 14.5 | RC-193 (W3, 1), RC-171 (W3, 1), RC-173 (W3, 1.5), RC-194 (W3, 1), RC-195 (W3, 1) | Wave 1 data-safety fixes (RC-003, RC-040, RC-042, RC-041, RC-007, RC-031, RC-032, RC-014, RC-011, RC-018); Wave 2 platform items (RC-132, RC-082, RC-077, RC-088, RC-095, RC-056); provider and region decision |
| B-1 | Unusual-activity rules R1 to R11, inbox, webhook (no AI model) | about 8 | RC-193 (W3, 1) | B-0 telemetry (RC-031), queue (RC-082), read-only login (RC-193) |
| B-2 | Bill reading, digital PDFs, draft only | about 14 | RC-172 (W3, 2), RC-196 (W3, 0.25) | B-0; RC-014 and RC-056; provider contract; 200-bill golden set (about 3 days of the accounts team, not developer time) |
| B-3 | Plain-English questions, read-only tools | about 12 | RC-171 (W3, 1) | B-0; RC-042 and RC-040; permission red-team set; owner decision on whose records people see (RC-041) |
| B-4 | Technician assistant (4a summary and warranty about 6; 4b similar jobs about 4) | about 10 | RC-042 (W1, 2) | B-3 executor; three months of job-card history for 4b |
| B-5 | Scan and photo bills, report specs, statistical alerts, second-person confirm | about 15 | None: not in the register | B-2 to B-4 stable; counsel's view on images that cannot be redacted |
|  | Sum of the phases (phases B-0 to B-3: 48.5) | 73.5 |  |  |

The phases sum to 73.5 developer-days (the notes round this to about 74; phases B-0 to B-3 are 48.5). The accounts team's 3 days for the 200-bill sample are not developer time. The three AI screens (draft-bill form, chat panel, alert inbox) and the technician panel are sized by the design notes at 6 to 9, 4 to 6, 3 to 4 and 2 to 3 days (their own estimates). Those days sit inside the phase totals above, so they are not added again.
Together, Part A and Part B come to 146.5 to 171.5 developer-days, before subtracting the register items they overlap.
## 7.3 Work the register does not contain
These are also outside the 548.75 days:
| Work | Size | Source |
| Review, accept and merge the three review branches, resolve the audit-test problem (RC-019), re-run the coverage check | Not costed anywhere | Section 3 |
| AWS build for the recommended hosting (VPC, server, database roles, access role, alarms) | 1.5 to 2 days, derived by the hosting write-up | 05-Hosting-Recommendation.md section 10.5 |
| Hosting decisions and account set-up before any real data | About 2 days of owner and developer time | 05-Hosting-Recommendation.md section 10.3 |
| Later move from the recommended hosting to full containers (Phase 3 of the hosting plan), if ever needed | 8 to 12 days | 05-Hosting-Recommendation.md section 10.5 |
| Accounts team time for the parallel month, and for the 200-bill sample | Not developer time | 07-Go-Live-Checklist.md, design notes |

The hosting write-up puts the whole go-live hosting work at about 8 to 9 developer-days. Of that, the register already holds RC-191, RC-015, RC-016 (managed-database route), RC-018 and RC-021, so only the AWS build is extra.
# 8. Items that need an outside expert
35 items (146.75 days) carry the register's needsExpert flag. The day counts above cover the developer's work only. The expert's answer must come before the item can be called finished, and often before it can start.
| Expert | Wave 1 items / days | Wave 2 items / days | Wave 3 items / days | All items / days | What the expert provides |
| Chartered accountant (CA) | 3 / 11.25 | 15 / 53.5 | 3 / 32.5 | 21 / 97.25 | Confirms the tax rule, threshold, rate table or retention period the code must follow, and signs off the result. |
| Counsel | 2 / 10 | 1 / 2 | 1 / 1 | 4 / 13 | Settles the notice wording, legal basis or consent rule the screens and records must carry. |
| Labour-law adviser | 0 / 0 | 4 / 13.5 | 2 / 10.5 | 6 / 24 | Supplies the statutory slabs, ceilings and rules for pay, leave and settlement, and confirms the result. |
| Security test (independent tester) | 0 / 0 | 4 / 12.5 | 0 / 0 | 4 / 12.5 | Tests the fix from outside, by trying to get round it, and reports whether it holds. |
| All experts | 5 / 21.25 | 24 / 81.5 | 6 / 44 | 35 / 146.75 |  |

What to do about it.
- Wave 1 has 5 items (RC-009 (CA), RC-010 (CA), RC-011 (counsel), RC-014 (CA), RC-032 (counsel)). Book the chartered accountant and counsel before Wave 1 starts. These answers shape data columns (foreign currency, second legal entity, supplier registration type) and retention rules, and they cannot be changed cheaply later.
- The chartered accountant is needed for 21 items, most of them GST and tax rules in Wave 2. Ask the accountant's first question now: whether aggregate turnover is above the e-invoicing threshold, because that decides whether RC-170 moves to Wave 2.
- The labour-law adviser settles the Provident Fund, ESIC, professional tax, leave and final-settlement figures. The register notes the PF ceiling figure is "To confirm" because the reviewers found conflicting reports.
- The independent security test covers four Wave 2 items (the captcha bypass, the second factor, password guessing and the forged bank-statement sender). It should be done by someone who did not write the fix.
- Legal figures are not settled by this plan. The DPDP dates in the design notes are unverified. Nothing here is legal or tax advice.
Every flagged item:
| RC id | Title | Level | Wave | Days | Expert | Register note on what is open |
| RC-009 | Foreign-currency documents keep only the rupee figure; the foreign amount is re-derived by... | Serious | 1 | 5.5 | CA | Customs and port charges in foreign terms are in the customs-charges item. Whether multi-currency stays in scope is for the owner to confirm. |
| RC-010 | The second legal entity is half-built and an admin can create one today; purchases, payments,... | Serious | 1 | 0.75 | CA | The PRD said multi-company was out of v1. Needs the owner to say whether a second GSTIN is likely within a year. |
| RC-011 | There is no way to erase, anonymise or time-limit personal data, and the audit log and event... | Serious | 1 | 6 | counsel | Retention periods need the CA and counsel. Staging is possible: the audit allow-list is the Wave 1 part, the erasure function and retention jobs can follow before go-live. |
| RC-014 | Input credit is claimed on bills from suppliers with no GSTIN, from composition dealers and from... | Serious | 1 | 5 | CA | TRD-04 asks the CA whether Radboards buys from unregistered suppliers at all. Proposal sentence "Bills from foreign suppliers claim GST credit that is not due" is Still true. |
| RC-032 | The consent record is thin and forgeable: no notice or purpose stored, a stranger can record... | Moderate | 1 | 4 | counsel | The notice wording needs counsel. Legal reading is To confirm. |
| RC-054 | The public enquiry form's captcha and strict rate limit are bypassed through the website-form... | Serious | 2 | 2 | security-test | Proposal "Both can be bypassed through another entry point" is Still true. |
| RC-055 | No second factor on the accounts that move money, run payroll or change who can do what | Serious | 2 | 5 | security-test | No further note in the register. |
| RC-057 | There is no reverse charge anywhere | Serious | 2 | 5 | CA | No further note in the register. |
| RC-058 | Expenses claim input credit with no blocked-credit check or state check, and an expense category... | Serious | 2 | 3 | CA | No further note in the register. |
| RC-059 | The GSTR-1 file has never been checked against the portal's rules, at least three things look... | Serious | 2 | 3.5 | CA | Suspected rejects need the portal or the offline tool to settle. |
| RC-060 | TDS is typed in by hand at payment time, with no thresholds, no higher no-PAN rate, and not at... | Serious | 2 | 8 | CA | No further note in the register. |
| RC-068 | A WhatsApp "STOP" is not recognised: from an unknown number it creates a consenting lead, from a... | Serious | 2 | 2 | counsel | No further note in the register. |
| RC-089 | Password guessing is limited per address only, in memory, with no per-account lockout, and... | Serious | 2 | 2 | security-test | Production reachability of the X-Forwarded-For bypass is To confirm. |
| RC-104 | PF and ESIC are worked from a made-up "Basic = 50% of gross": no real salary structure, no UAN... | Serious | 2 | 7 | labour-law | Legal figures (PF ceiling, ESIC rates) are To confirm; the area report found conflicting reports on a PF ceiling change. |
| RC-120 | Unpaid bills are not brought in one by one from Vyapar, so old invoices cannot be returned,... | Serious | 2 | 6 | CA | Proposal sentence is Partly true: parties, items and opening balances import exists (opening.ts), unpaid bills one by one do not. |
| RC-144 | A look-alike or forged sender still gets a bank statement mail imported and matched against real... | Serious | 2 | 3.5 | security-test | Proposal sentence "A statement is trusted on the sender's name alone" is Still true (substring on the sender). |
| RC-101 | Weekly offs are paid even if the person was absent every working day, and public holidays have... | Moderate | 2 | 2.5 | labour-law | No further note in the register. |
| RC-102 | Professional tax is a flat number per person (no state slabs, no February figure, charged on any... | Moderate | 2 | 3.5 | labour-law | Slab values are To confirm. |
| RC-103 | Overtime, bonus, gratuity, minimum wages and other statutory pay items are not modelled at all,... | Moderate | 2 | 0.5 | labour-law | No further note in the register. |
| RC-106 | GST on customs-agent, port and trucking charges paid in cash is added to the cost of the goods... | Moderate | 2 | 3 | CA | No further note in the register. |
| RC-107 | GSTR-1 leaves out nil-rated and exempt supplies, advances, e-commerce supplies and amendments,... | Moderate | 2 | 4 | CA | No further note in the register. |
| RC-108 | The GSTR-3B screen has two lines, no cross-head set-off, and ignores the credit brought forward | Moderate | 2 | 4 | CA | No further note in the register. |
| RC-109 | GST is never settled in the books, and nothing ties each month's return to the ledger | Moderate | 2 | 3 | CA | No further note in the register. |
| RC-110 | A credit note can reduce output tax at any age, and a price discount cannot be a credit note at all | Moderate | 2 | 3 | CA | No further note in the register. |
| RC-111 | Invoice, credit note and receipt dates are unbounded, goods are delivered before they are... | Moderate | 2 | 5.5 | CA | No further note in the register. |
| RC-113 | The printed invoice misses some Rule 46 particulars, a dealer saved without a GSTIN is reported... | Moderate | 2 | 2 | CA | The CA should confirm whether the 50,000 trigger is taxable value or invoice value. |
| RC-114 | Cash has no limit: receipts of Rs 2 lakh or more in a day and payments above Rs 10,000 go... | Moderate | 2 | 1.5 | CA | No further note in the register. |
| RC-115 | No GST rate rows are loaded for the 22 September 2025 rate change, and a newer short-code rate... | Moderate | 2 | 0.5 | CA | No further note in the register. |
| RC-116 | E-invoice IRN, acknowledgement and QR cannot be entered or printed | Moderate | 2 | 1.5 | CA | No further note in the register. |
| RC-169 | Salary TDS (Section 192) is not calculated: it is a flat monthly number someone types, with no... | Serious | 3 | 17.5 | CA | Proposal "Multi-company, multi-currency, payroll and TDS kept out of v1: all four were built" is Still true. |
| RC-170 | No e-invoice or e-way bill integration: a live IRN does not stop a cancel | Serious | 3 | 12 | CA | The finance reviewer rates FIN-01 Serious but says it becomes Critical if Radboards' aggregate turnover is above Rs 5 crore, because invoices without an IRN would then not count as invoices: ask... |
| RC-179 | The leave module is a single flat allowance: no types, no balance check when leave is asked for,... | Moderate | 3 | 7 | labour-law | Proposal sentence "Leave beyond the allowance is paid in full" is Out of date for the main case (payroll.ts:114-117). |
| RC-180 | Leaving the company has no final settlement: advances are stranded, and leave, notice and... | Moderate | 3 | 3.5 | labour-law | No further note in the register. |
| RC-181 | The TDS flow stops at the deposit: no quarterly return file, no certificates, no interest or... | Moderate | 3 | 3 | CA | No further note in the register. |
| RC-195 | No recorded legal basis or notice for AI processing | Moderate | 3 | 1 | counsel | No further note in the register. |

# 9. Risks to the plan and what to do about them
| Risk | What it does to the plan | What to do |
| The estimates come from reading code, not from building it | Every figure could be low or high; the band in section 2 covers only the doubt the reviewers wrote down | Plan on the register figure, commit to dates on the High figure, and re-estimate after the first two weeks using the actual-to-planned ratio |
| Part-fixed items cost most of their days (70.95 days at stake across 30 items) | If you assumed the branch saved 70.95 days you would finish short | Keep the full days in the plan; reduce an item only when its "what remains" text in branch-coverage.md shows nothing left |
| Branches A and B commit failing audit tests (RC-019) | Merging them makes the test run red, which stops every later merge | Fix this in the merge: keep the audit tests outside the main test run until they pass, and make the real-database CI job work (RC-005) early |
| The full test suite is slow (the fix notes report 88 minutes) | Every merge waits for the run; two developers queue behind each other | Run changed files only during work and the full suite before merge; RC-005 and RC-069 improve the tests |
| Experts reply late (35 items) | Items sit unfinished although the code is ready | Book now, send each expert the exact register question, and start with the Wave 1 items |
| Owner decisions are not made: second legal entity (RC-010), foreign currency in scope (RC-009), who sees which leads (RC-041), offline invoice numbering, hosting | A wrong default costs days later; option B for RC-010 alone is 23 to 35 days against 0.75 | Hold a decision meeting in week 0 and record each decision in the register entry |
| The hosting route changes RC-016 | Wave 1 is 120.25 days on the self-hosted route, 117.25 on the managed-database route | Choose the host in week 0 (RC-015); update the plan |
| Two developers clash in the same files | Lost days to merge conflicts, especially migrations | Use the code-area plan and the rules in section 4; one developer owns the migrations folder in any week |
| Real data arrives before Wave 1 is done | The immutability, precision and audit changes can no longer be done honestly | Enforce Gate 0: no real Vyapar file until the Wave 1 gate is signed; masked rehearsal files only |
| "To confirm" items turn out larger or unneeded (20 items, 35.45 days) | Swing of up to 35.45 days | Run the confirming check for each at the start of its fortnight; update the register |
| E-invoicing applies (RC-170) | 12 days move from Wave 3 to Wave 2 and become a go-live gate | Ask the accountant now |
| A developer new to the code does the work | The unit is a developer who knows the code; a newcomer is slower at first | Pair for the first fortnight, or add learning time |
| Wave 3 and the new builds compete for the same three months | Wave 3 alone needs 17.8 weeks with two developers; section 7 adds 146.5 to 171.5 days before overlaps | Decide what Wave 3 items and builds wait; the AI foundations and alert rules are also safety work, so keep them ahead of the rest |
| Law and rate figures change (DPDP dates, PF ceiling, GST rates) | An item built on a stale rule is rebuilt | Keep each figure in a settings table that the accountant or adviser can update, as the register recommends; confirm before building |
| Sensitive data in test and error tools | Real names and numbers reach logs and test files | Do RC-007 and RC-011 first among the privacy items; use masked files for rehearsal |

# 10. The first 30 items to do
How they are ranked. First by level (the one Critical, then Serious). Within a level, by wave. Within a wave, by the cost of delay once real data exists, in three tiers drawn from the register's own reason for the wave:
- A: cannot be redone after real data exists. The register says the item cannot be recreated, reconstructed or retrofitted honestly, or that its decision must be settled before records exist.
- B: harm starts with the first real record or pay day. Wrong credit from the first bill, personal data exposed from the first day, a guard that must hold from the first payroll, or a proof that must exist before data goes in.
- C: can be done later without losing anything, but is needed on go-live day.
Ties go to the item that more other items wait for, then to the cheaper item. The two items fully fixed on a review branch are left out of the ranking. Among the 24 Wave 1 Critical and Serious items the tiers are:
| Tier among Wave 1 Critical and Serious items | Items | Days |
| A: cannot be redone after real data exists | 17 | 49.75 |
| B: harm starts with the first real record or pay day | 6 | 19 |
| C: can be done later without losing anything | 1 | 1.5 |

The list is 96.75 developer-days: 24 from Wave 1 and 6 from Wave 2. 7 of the 30 are part-fixed on a branch and 6 need an outside expert. Where an item's prerequisite is also on the list, the prerequisite is shown first, so work down the table. Do the prerequisites in the "Depends on" column first, even when one is not itself on this list: 9 such prerequisites (28.75 days) are shown after the table.
| # | RC id | Title | Level | Wave | Days | Cost of delay after real data exists | Depends on | Branch status | Needs expert |
| 1 | RC-001 | Backups fail open: the only copy is an unencrypted dump on the same disk as the database, and nothing says so | Critical | 1 | 1.5 | A: cannot be redone after real data exists |  | None |  |
| 2 | RC-003 | The database owner password sits in the API container environment, and the app login keeps UPDATE and... | Serious | 1 | 2 | B: harm starts with the first real record or pay day |  | Part-fixed (C) |  |
| 3 | RC-011 | There is no way to erase, anonymise or time-limit personal data, and the audit log and event tables keep... | Serious | 1 | 6 | A: cannot be redone after real data exists | RC-003 | None | counsel |
| 4 | RC-012 | The filed-month GST lock guards only half the doors, nothing records what was filed, and the current month... | Serious | 1 | 2.75 | A: cannot be redone after real data exists |  | None |  |
| 5 | RC-008 | Prices and unit costs are limited to 2 decimals, so a rate such as 0.375 cannot be entered and foreign... | Serious | 1 | 3 | A: cannot be redone after real data exists |  | None |  |
| 6 | RC-016 | There is no point-in-time recovery: a server loss restores to last night, and invoice numbers already... | Serious | 1 | 4.5 | A: cannot be redone after real data exists | RC-001, RC-015 | None |  |
| 7 | RC-007 | Failed database queries put names, phone numbers, PAN and bank details, and link tokens into the error... | Serious | 1 | 1.5 | A: cannot be redone after real data exists |  | Part-fixed (A) |  |
| 8 | RC-013 | Reopening a month books the reversal into today's month, and re-approving or reopening a past month... | Serious | 1 | 3.5 | A: cannot be redone after real data exists |  | None |  |
| 9 | RC-042 | Routes an AI tool would call already return data beyond the caller's role, and rows are not scoped to the... | Serious | 1 | 2 | A: cannot be redone after real data exists | RC-040 | None |  |
| 10 | RC-038 | The Vyapar opening stock import stays open forever, posts stock on the day of import, lets Accounts... | Serious | 1 | 2.5 | A: cannot be redone after real data exists | RC-037 | None |  |
| 11 | RC-041 | Any salesperson can pull the whole lead and phone list in pages of 5,000 and edit any lead | Serious | 1 | 3.5 | A: cannot be redone after real data exists | RC-040 | Part-fixed (A) |  |
| 12 | RC-010 | The second legal entity is half-built and an admin can create one today; purchases, payments, stock,... | Serious | 1 | 0.75 | A: cannot be redone after real data exists |  | None | CA |
| 13 | RC-018 | "Data stays in India" is true only on paper: the only running copy is pinned to Singapore and several data... | Serious | 1 | 1.25 | A: cannot be redone after real data exists | RC-015 | None |  |
| 14 | RC-034 | A payroll user can pay themselves a cash advance, and an admin can unlink their own employee record to... | Serious | 1 | 3.5 | B: harm starts with the first real record or pay day | RC-033 | Part-fixed (B) |  |
| 15 | RC-036 | A change of someone's bank account is not in the audit trail and needs no second person | Serious | 1 | 2 | A: cannot be redone after real data exists | RC-034 | None |  |
| 16 | RC-004 | Posted bills, payments, expenses and payslips can be changed or deleted with plain SQL, deleting a payroll... | Serious | 1 | 2.5 | A: cannot be redone after real data exists | RC-003 | Part-fixed (C) |  |
| 17 | RC-002 | Backup keys and cloud credentials sit beside the data, so ransomware or a stolen server can read or erase... | Serious | 1 | 3 | A: cannot be redone after real data exists | RC-001 | None |  |
| 18 | RC-031 | 33 of the 230 write routes leave no audit entry, including every login, password change and almost every... | Serious | 1 | 4 | A: cannot be redone after real data exists | RC-030 | Part-fixed (A) |  |
| 19 | RC-009 | Foreign-currency documents keep only the rupee figure; the foreign amount is re-derived by division, and... | Serious | 1 | 5.5 | A: cannot be redone after real data exists | RC-008 | None | CA |
| 20 | RC-014 | Input credit is claimed on bills from suppliers with no GSTIN, from composition dealers and from foreign... | Serious | 1 | 5 | B: harm starts with the first real record or pay day |  | None | CA |
| 21 | RC-017 | The restore drill passes on an empty database, never checks uploaded files, is not scheduled, and the... | Serious | 1 | 3 | B: harm starts with the first real record or pay day | RC-001, RC-016 | None |  |
| 22 | RC-006 | The repository is public, and nothing watches dependencies or scans for secrets while Next.js published 22... | Serious | 1 | 1.5 | B: harm starts with the first real record or pay day |  | None |  |
| 23 | RC-035 | One payroll user can prepare, adjust, approve and pay a month for everyone else, and the approver approves... | Serious | 1 | 4 | B: harm starts with the first real record or pay day | RC-034 | Part-fixed (B) |  |
| 24 | RC-005 | The real-PostgreSQL CI job fails before any test runs, and the real-database suite builds a new database... | Serious | 1 | 1.5 | C: can be done later without losing anything |  | None |  |
| 25 | RC-084 | Stuck webhook events are never retried or reported, so an expired Meta token silently loses leads, and... | Serious | 2 | 4.5 | B: harm starts with the first real record or pay day | RC-082 | None |  |
| 26 | RC-133 | A failed save gets a fresh retry key, and several money and stock saves, including Receive goods and Save... | Serious | 2 | 3 | B: harm starts with the first real record or pay day | RC-132 | None |  |
| 27 | RC-052 | The migration runner is not safe on a live database, and the "way back" that update.sh prints does not work | Serious | 2 | 3.5 | B: harm starts with the first real record or pay day | RC-051 | None |  |
| 28 | RC-059 | The GSTR-1 file has never been checked against the portal's rules, at least three things look likely to be... | Serious | 2 | 3.5 | B: harm starts with the first real record or pay day |  | None | CA |
| 29 | RC-085 | Shopify edits, payments and refunds after the first message are thrown away | Serious | 2 | 5 | B: harm starts with the first real record or pay day | RC-084 | None |  |
| 30 | RC-104 | PF and ESIC are worked from a made-up "Basic = 50% of gross": no real salary structure, no UAN or ESIC... | Serious | 2 | 7 | B: harm starts with the first real record or pay day | RC-103 | None | labour-law |

Prerequisites that are not on the list but must come first:
| Prerequisite not on the list | Level | Wave | Days | Needed by |
| RC-015 Choose the production host: the code is written for a long-running server and loses... | Moderate | 1 | 2 | RC-016, RC-018 |
| RC-030 The audit trail depends on about 185 hand-written audit() calls; updated_at is not... | Moderate | 1 | 4 | RC-031 |
| RC-033 Someone given user-management rights can make themselves an administrator, and the... | Moderate | 1 | 1.25 | RC-034 |
| RC-037 The person who makes a change can usually also approve it: adjustments, purchase... | Moderate | 1 | 4 | RC-038 |
| RC-040 Personal data masking and the "who looked" log cover the detail page but not lists,... | Moderate | 1 | 2.5 | RC-042, RC-041 |
| RC-051 Nothing stops a red or untested commit from reaching the live server: main is... | Serious | 2 | 3 | RC-052 |
| RC-082 Background jobs: the 15-minute in-process loop has no queue, retry, timeout, watchdog... | Moderate | 2 | 7 | RC-084 |
| RC-103 Overtime, bonus, gratuity, minimum wages and other statutory pay items are not... | Moderate | 2 | 0.5 | RC-104 |
| RC-132 The "saved once" guard is optional, ignores what was sent, keeps whole answers (with... | Moderate | 2 | 4.5 | RC-133 |

# Appendix A. Traceability: proposal headline risks to register items
The proposal's headline-risk table has 13 rows. Each register item carries a proposalRow field when it answers one of those rows. 78 items (261.25 days) answer a row; the other 144 items (287.5 days) are findings that go beyond the headline rows.
The proposal listed "Moving off Vyapar" as Critical. The full review rates it Serious, because the opening import exists (see proposal-vs-reality.md). Backups remain the one Critical.
| Proposal headline risk | Level in the proposal | RC items | Items | Days | Wave 1 / 2 / 3 items |
| Backups | Critical | RC-001 (W1, 1.5), RC-002 (W1, 3), RC-016 (W1, 4.5), RC-017 (W1, 3), RC-050 (W2, 3) | 5 | 15 | 4 / 1 / 0 |
| Moving off Vyapar | Critical | RC-038 (W1, 2.5), RC-117 (W2, 3), RC-119 (W2, 2), RC-120 (W2, 6), RC-121 (W2, 5) | 5 | 18.5 | 1 / 4 / 0 |
| GST returns | Serious | RC-012 (W1, 2.75), RC-014 (W1, 5), RC-057 (W2, 5), RC-058 (W2, 3), RC-108 (W2, 4), RC-109 (W2, 3), RC-110 (W2, 3), RC-111 (W2, 5.5) | 8 | 31.25 | 2 / 6 / 0 |
| Closed years | Serious | RC-039 (W1, 3) | 1 | 3 | 1 / 0 / 0 |
| Stock and cash leaks | Serious | RC-056 (W2, 4.5), RC-061 (W2, 2), RC-064 (W2, 2), RC-085 (W2, 5), RC-122 (W2, 2.5), RC-126 (W2, 1.5), RC-132 (W2, 4.5), RC-133 (W2, 3) | 8 | 25 | 0 / 8 / 0 |
| Payroll | Serious | RC-013 (W1, 3.5), RC-034 (W1, 3.5), RC-035 (W1, 4), RC-036 (W1, 2), RC-098 (W2, 2.5), RC-099 (W2, 0.25), RC-100 (W2, 1.5), RC-101 (W2, 2.5), RC-102 (W2, 3.5), RC-103 (W2, 0.5), RC-104 (W2, 7), RC-169 (W3, 17.5), RC-179 (W3, 7) | 13 | 55.25 | 4 / 7 / 2 |
| Private data on links | Serious | RC-047 (W1, 2), RC-048 (W1, 2), RC-049 (W1, 1.75), RC-146 (W2, 1.5) | 4 | 7.25 | 3 / 1 / 0 |
| Who can do what | Serious | RC-033 (W1, 1.25), RC-037 (W1, 4), RC-041 (W1, 3.5), RC-055 (W2, 5), RC-065 (W2, 2), RC-089 (W2, 2) | 6 | 17.75 | 3 / 3 / 0 |
| Bank statements by email | Serious | RC-118 (W2, 2), RC-144 (W2, 3.5), RC-145 (W2, 2) | 3 | 7.5 | 0 / 3 / 0 |
| Updates and the database | Serious | RC-003 (W1, 2), RC-051 (W2, 3), RC-052 (W2, 3.5) | 3 | 8.5 | 1 / 2 / 0 |
| No alarms | Serious | RC-007 (W1, 1.5), RC-082 (W2, 7), RC-083 (W2, 4), RC-084 (W2, 4.5), RC-158 (W2, 1.5) | 5 | 18.5 | 1 / 4 / 0 |
| Compliance | Serious | RC-011 (W1, 6), RC-015 (W1, 2), RC-018 (W1, 1.25), RC-031 (W1, 4), RC-032 (W1, 4), RC-040 (W1, 2.5), RC-054 (W2, 2), RC-059 (W2, 3.5), RC-068 (W2, 2), RC-107 (W2, 4), RC-116 (W2, 1.5), RC-170 (W3, 12) | 12 | 44.75 | 6 / 5 / 1 |
| Screens | Moderate | RC-086 (W2, 5), RC-113 (W2, 2), RC-147 (W2, 0.25), RC-149 (W2, 1), RC-159 (W2, 0.75) | 5 | 9 | 0 / 5 / 0 |
| All 13 rows |  |  | 78 | 261.25 | 26 / 49 / 3 |

Detail for each row:
Backups (5 items, 15 days)
| RC id | Title | Level | Wave | Days | Branch status |
| RC-001 | Backups fail open: the only copy is an unencrypted dump on the same disk as the database, and nothing says so | Critical | 1 | 1.5 | None |
| RC-002 | Backup keys and cloud credentials sit beside the data, so ransomware or a stolen server can read or erase every... | Serious | 1 | 3 | None |
| RC-016 | There is no point-in-time recovery: a server loss restores to last night, and invoice numbers already given to... | Serious | 1 | 4.5 | None |
| RC-017 | The restore drill passes on an empty database, never checks uploaded files, is not scheduled, and the documented... | Serious | 1 | 3 | None |
| RC-050 | There is no disaster-recovery objective, runbook, on-call arrangement or rehearsal, and the whole business sits on... | Serious | 2 | 3 | None |

Moving off Vyapar (5 items, 18.5 days)
| RC id | Title | Level | Wave | Days | Branch status |
| RC-038 | The Vyapar opening stock import stays open forever, posts stock on the day of import, lets Accounts approve its own... | Serious | 1 | 2.5 | None |
| RC-117 | The importers cannot read the files the sources produce: no Excel, comma-only CSV, UTF-8 only, and a 1 MB cap | Moderate | 2 | 3 | None |
| RC-119 | The Vyapar import has never been tried on a real Vyapar file, and the file shape is an assumption | Moderate | 2 | 2 | None |
| RC-120 | Unpaid bills are not brought in one by one from Vyapar, so old invoices cannot be returned, credited or chased | Serious | 2 | 6 | None |
| RC-121 | The Vyapar compare screen is a three-list snapshot, not a parallel-month reconciliation | Serious | 2 | 5 | None |

GST returns (8 items, 31.25 days)
| RC id | Title | Level | Wave | Days | Branch status |
| RC-012 | The filed-month GST lock guards only half the doors, nothing records what was filed, and the current month can be... | Serious | 1 | 2.75 | None |
| RC-014 | Input credit is claimed on bills from suppliers with no GSTIN, from composition dealers and from foreign suppliers... | Serious | 1 | 5 | None |
| RC-057 | There is no reverse charge anywhere | Serious | 2 | 5 | None |
| RC-058 | Expenses claim input credit with no blocked-credit check or state check, and an expense category can point at any... | Serious | 2 | 3 | None |
| RC-108 | The GSTR-3B screen has two lines, no cross-head set-off, and ignores the credit brought forward | Moderate | 2 | 4 | None |
| RC-109 | GST is never settled in the books, and nothing ties each month's return to the ledger | Moderate | 2 | 3 | None |
| RC-110 | A credit note can reduce output tax at any age, and a price discount cannot be a credit note at all | Moderate | 2 | 3 | None |
| RC-111 | Invoice, credit note and receipt dates are unbounded, goods are delivered before they are invoiced, advances carry... | Moderate | 2 | 5.5 | None |

Closed years (1 items, 3 days)
| RC id | Title | Level | Wave | Days | Branch status |
| RC-039 | One accountant can move the period lock back over open months, and a closed year can be reopened with a lock that... | Moderate | 1 | 3 | Part-fixed (B) |

Stock and cash leaks (8 items, 25 days)
| RC id | Title | Level | Wave | Days | Branch status |
| RC-056 | A supplier bill is never held against the purchase order or goods received, tax is recomputed at the PO rate, and a... | Serious | 2 | 4.5 | Part-fixed (C) |
| RC-061 | The dealer's credit limit and overdue bills are checked once, when the order is confirmed; delivery, invoice and a... | Serious | 2 | 2 | None |
| RC-064 | A part already fitted can be deleted from a job card, so stock and cost have gone but nothing is ever billed, and... | Serious | 2 | 2 | Part-fixed (C) |
| RC-085 | Shopify edits, payments and refunds after the first message are thrown away | Serious | 2 | 5 | None |
| RC-122 | A hold on stock stays open after the goods leave from another place or with another serial, and the stock engine... | Moderate | 2 | 2.5 | None |
| RC-126 | A cash sale returned across the counter cannot be refunded in the books, and cancelling an invoice deletes its... | Moderate | 2 | 1.5 | None |
| RC-132 | The "saved once" guard is optional, ignores what was sent, keeps whole answers (with link tokens) for a day, and... | Moderate | 2 | 4.5 | Part-fixed (A) |
| RC-133 | A failed save gets a fresh retry key, and several money and stock saves, including Receive goods and Save bill, sit... | Serious | 2 | 3 | None |

Payroll (13 items, 55.25 days)
| RC id | Title | Level | Wave | Days | Branch status |
| RC-013 | Reopening a month books the reversal into today's month, and re-approving or reopening a past month re-reads today's... | Serious | 1 | 3.5 | None |
| RC-034 | A payroll user can pay themselves a cash advance, and an admin can unlink their own employee record to escape every... | Serious | 1 | 3.5 | Part-fixed (B) |
| RC-035 | One payroll user can prepare, adjust, approve and pay a month for everyone else, and the approver approves figures... | Serious | 1 | 4 | Part-fixed (B) |
| RC-036 | A change of someone's bank account is not in the audit trail and needs no second person | Serious | 1 | 2 | None |
| RC-098 | A salary change back-dated into an approved or paid month, and attendance or leave changes for such a month, are... | Moderate | 2 | 2.5 | Part-fixed (B) |
| RC-099 | A self clock-in can still overrule HR's absent mark, because HR edits never clear the self-marked flag | Moderate | 2 | 0.25 | None |
| RC-100 | A raise in the middle of a month is averaged over the month, so uneven attendance is paid at the wrong rate | Moderate | 2 | 1.5 | Fixed (B) |
| RC-101 | Weekly offs are paid even if the person was absent every working day, and public holidays have no calendar | Moderate | 2 | 2.5 | None |
| RC-102 | Professional tax is a flat number per person (no state slabs, no February figure, charged on any earnings) and there... | Moderate | 2 | 3.5 | None |
| RC-103 | Overtime, bonus, gratuity, minimum wages and other statutory pay items are not modelled at all, and the payroll... | Moderate | 2 | 0.5 | None |
| RC-104 | PF and ESIC are worked from a made-up "Basic = 50% of gross": no real salary structure, no UAN or ESIC number, no... | Serious | 2 | 7 | None |
| RC-169 | Salary TDS (Section 192) is not calculated: it is a flat monthly number someone types, with no PAN, regime,... | Serious | 3 | 17.5 | None |
| RC-179 | The leave module is a single flat allowance: no types, no balance check when leave is asked for, no carry forward or... | Moderate | 3 | 7 | None |

Private data on links (4 items, 7.25 days)
| RC id | Title | Level | Wave | Days | Branch status |
| RC-047 | Public link tokens are stored in plain text and copied into other tables | Minor | 1 | 2 | None |
| RC-048 | Invoice and estimate links never expire, cannot be switched off, can be created by anyone who can read invoices, and... | Moderate | 1 | 2 | None |
| RC-049 | Payslip links show salary, deductions and IFSC to anyone with the link, cannot be revoked, and the WhatsApp text... | Moderate | 1 | 1.75 | Part-fixed (B) |
| RC-146 | No browser security headers on any screen or public page, the token pages can be indexed and cached, and new tabs... | Moderate | 2 | 1.5 | Part-fixed (A) |

Who can do what (6 items, 17.75 days)
| RC id | Title | Level | Wave | Days | Branch status |
| RC-033 | Someone given user-management rights can make themselves an administrator, and the Permissions screen can grant any... | Moderate | 1 | 1.25 | Part-fixed (A) |
| RC-037 | The person who makes a change can usually also approve it: adjustments, purchase orders, price lists, service bills... | Moderate | 1 | 4 | Part-fixed (B+C) |
| RC-041 | Any salesperson can pull the whole lead and phone list in pages of 5,000 and edit any lead | Serious | 1 | 3.5 | Part-fixed (A) |
| RC-055 | No second factor on the accounts that move money, run payroll or change who can do what | Serious | 2 | 5 | None |
| RC-065 | Any sales user can create confirmed orders at any price through the marketplace import; blank prices become Rs 0 | Serious | 2 | 2 | Part-fixed (C) |
| RC-089 | Password guessing is limited per address only, in memory, with no per-account lockout, and successful sign-ins count... | Serious | 2 | 2 | Part-fixed (A) |

Bank statements by email (3 items, 7.5 days)
| RC id | Title | Level | Wave | Days | Branch status |
| RC-118 | A CSV statement with an unquoted "9,111.00" is imported as Rs 9, rows with unreadable dates vanish, and one crafted... | Serious | 2 | 2 | Part-fixed (C) |
| RC-144 | A look-alike or forged sender still gets a bank statement mail imported and matched against real receipts | Serious | 2 | 3.5 | Part-fixed (C) |
| RC-145 | Bank lines are matched to the books on amount and date alone, including lines that arrived by email | Serious | 2 | 2 | Part-fixed (C) |

Updates and the database (3 items, 8.5 days)
| RC id | Title | Level | Wave | Days | Branch status |
| RC-003 | The database owner password sits in the API container environment, and the app login keeps UPDATE and DELETE rights... | Serious | 1 | 2 | Part-fixed (C) |
| RC-051 | Nothing stops a red or untested commit from reaching the live server: main is unprotected and the server builds... | Serious | 2 | 3 | None |
| RC-052 | The migration runner is not safe on a live database, and the "way back" that update.sh prints does not work | Serious | 2 | 3.5 | None |

No alarms (5 items, 18.5 days)
| RC id | Title | Level | Wave | Days | Branch status |
| RC-007 | Failed database queries put names, phone numbers, PAN and bank details, and link tokens into the error log, the... | Serious | 1 | 1.5 | Part-fixed (A) |
| RC-082 | Background jobs: the 15-minute in-process loop has no queue, retry, timeout, watchdog or overlap guard, the PRD jobs... | Moderate | 2 | 7 | None |
| RC-083 | Nobody outside the server watches the server: the health check says ok without touching the database, there is no... | Serious | 2 | 4 | Part-fixed (A) |
| RC-084 | Stuck webhook events are never retried or reported, so an expired Meta token silently loses leads, and webhooks are... | Serious | 2 | 4.5 | None |
| RC-158 | Error tracking is home-made, blind to the browser, and its alert de-duplication is keyed on the full URL and resets... | Minor | 2 | 1.5 | None |

Compliance (12 items, 44.75 days)
| RC id | Title | Level | Wave | Days | Branch status |
| RC-011 | There is no way to erase, anonymise or time-limit personal data, and the audit log and event tables keep full copies... | Serious | 1 | 6 | None |
| RC-015 | Choose the production host: the code is written for a long-running server and loses limits, jobs and uploads on... | Moderate | 1 | 2 | None |
| RC-018 | "Data stays in India" is true only on paper: the only running copy is pinned to Singapore and several data flows... | Serious | 1 | 1.25 | None |
| RC-031 | 33 of the 230 write routes leave no audit entry, including every login, password change and almost every export | Serious | 1 | 4 | Part-fixed (A) |
| RC-032 | The consent record is thin and forgeable: no notice or purpose stored, a stranger can record consent for someone... | Moderate | 1 | 4 | None |
| RC-040 | Personal data masking and the "who looked" log cover the detail page but not lists, the phone lookup, exports or the... | Moderate | 1 | 2.5 | Part-fixed (C) |
| RC-054 | The public enquiry form's captcha and strict rate limit are bypassed through the website-form webhook, and the... | Serious | 2 | 2 | None |
| RC-059 | The GSTR-1 file has never been checked against the portal's rules, at least three things look likely to be rejected,... | Serious | 2 | 3.5 | None |
| RC-068 | A WhatsApp "STOP" is not recognised: from an unknown number it creates a consenting lead, from a known lead it makes... | Serious | 2 | 2 | None |
| RC-107 | GSTR-1 leaves out nil-rated and exempt supplies, advances, e-commerce supplies and amendments, and mis-files 0% sales | Moderate | 2 | 4 | None |
| RC-116 | E-invoice IRN, acknowledgement and QR cannot be entered or printed | Moderate | 2 | 1.5 | None |
| RC-170 | No e-invoice or e-way bill integration: a live IRN does not stop a cancel | Serious | 3 | 12 | None |

Screens (5 items, 9 days)
| RC id | Title | Level | Wave | Days | Branch status |
| RC-086 | Lists, pickers and exports silently stop at a fixed size: Show more fails, past 5,000 rows nothing can be reached or... | Moderate | 2 | 5 | None |
| RC-113 | The printed invoice misses some Rule 46 particulars, a dealer saved without a GSTIN is reported as a consumer, and... | Moderate | 2 | 2 | None |
| RC-147 | The "Signed out" dialog can be dismissed into an invisible dialog that freezes the whole page | Moderate | 2 | 0.25 | None |
| RC-149 | The app has no offline behaviour at all: a dropped connection shows "Failed to fetch" and unsaved work lives only on... | Moderate | 2 | 1 | None |
| RC-159 | No error screen, loading screen or not-found page anywhere, and a render error shows Next's blank error page and... | Moderate | 2 | 0.75 | None |

# Appendix B. Totals check
The script stops if these do not agree with the corrected totals (RC-191 in Wave 2).
| Scope | Items (computed) | Days (computed) | Items (expected) | Days (expected) | Agrees |
| Wave 1 | 49 | 120.25 | 49 | 120.25 | yes |
| Wave 2 | 120 | 267.95 | 120 | 267.95 | yes |
| Wave 3 | 53 | 160.55 | 53 | 160.55 | yes |
| All | 222 | 548.75 | 222 | 548.75 | yes |

The wave tables in master-register.md were generated before RC-191 moved from Wave 3 to Wave 2, so they show Wave 2 as 119 items and 265.45 days and Wave 3 as 54 items and 163.05 days. The banner at the top of that file and master-register.json carry the corrected figures used here (RC-191 is a Moderate item of 2.5 days, so Wave 2 shows one more Moderate item and Wave 3 one fewer than that file's summary tables).
By level and wave (days):
| Level | Wave 1 days | Wave 2 days | Wave 3 days | All days |
| Critical | 1.5 | 0 | 0 | 1.5 |
| Serious | 68.75 | 107 | 34 | 209.75 |
| Moderate | 44.5 | 152.7 | 103.5 | 300.7 |
| Minor | 5.5 | 8.25 | 23.05 | 36.8 |

# Appendix C. How this document was made
- Inputs: master-register.json (222 items), branch-coverage.json (branch status as at the three separate branches), 06-Frontend-and-AI-Design-Notes.md (planned builds), 05-Hosting-Recommendation.md (hosting days), 07-Go-Live-Checklist.md (gate lines), proposal-vs-reality.md, and the area reports in areas\.
- Script: _build-fix-plan.cjs in the same folder reads the two JSON files and fills the tables and numbers. Rerun it after the branches are merged and branch-coverage.json is refreshed.
- Dependency chains: longest path by days over the register's dependsOn links, per wave; a prerequisite in an earlier wave counts as done.
- Sequenced plans: a list schedule over the same links, with one developer per code area at a time, the longest remaining chain first, then level. It is a plan for two developers, not a promise.
- Not covered: hours of coordination, waiting time, the work in section 7.3, and anything found after the review commit 194e288.
# Appendix D. Files named in more than one item
The register names files for some items and not others, so this is a floor and not a full list. Files named in two or more items need one editor at a time within a period.
| File | RC items that name it | Waves |
| opening.ts | RC-038, RC-119, RC-120, RC-121 | W1, W2 |
| payroll.ts | RC-013, RC-049, RC-101, RC-179 | W1, W2, W3 |
| update.sh | RC-051, RC-052, RC-073, RC-174 | W2, W3 |
| backup.sh | RC-001, RC-074, RC-174 | W1, W2, W3 |
| db-app-user.sh | RC-003, RC-080, RC-193 | W1, W2, W3 |
| purchasing.ts | RC-129, RC-175, RC-196 | W2, W3 |
| accounting.ts | RC-095, RC-175 | W2, W3 |
| alerts.ts | RC-083, RC-158 | W2 |
| app.ts | RC-155, RC-165 | W2 |
| bank-mail.ts | RC-007, RC-137 | W1, W2 |
| compose.prod.yml | RC-051, RC-075 | W2 |
| crm.ts | RC-173, RC-175 | W3 |
| helpers.ts | RC-155, RC-222 | W2, W3 |
| http.ts | RC-008, RC-037 | W1 |
| jobs.ts | RC-007, RC-082 | W1, W2 |
| online.ts | RC-140, RC-141 | W2 |
| restore-drill.sh | RC-001, RC-174 | W1, W3 |
| secret-box.ts | RC-055, RC-213 | W2, W3 |
| server.ts | RC-082, RC-095 | W2 |
| serverless.ts | RC-018, RC-071 | W1, W2 |
| ui.tsx | RC-150, RC-187 | W2, W3 |
