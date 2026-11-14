# ADR-005: Database conventions

- Status: accepted
- Date: 2026-11-06, revised after the auditor's review the same day
- Ticket: RAD-11 (M0-06). The basis for M1-05, M1-06 and M1-12, which cover RC-024, RC-029, RC-044, RC-003,
  RC-193, RC-030 and RC-046.
- Builds on: [ADR-001](001-layers.md) (one owner per table, principals), [ADR-002](002-data-access.md) (the SQL
  zone: CHECKs in `tables.ts` and `columns.ts`, triggers in `migrations/`, views in `views/`).

## Context

v1's database protected invoices, journals, stock and the audit log with triggers, and that was its strength
(Technical report Theme 3). But:
- the protection stopped there: posted bills, payments, expenses and payslips could be changed with plain SQL
  (RC-004);
- 119 of 159 numeric columns and 61 of 110 tables had no CHECK (RC-024);
- 124 of 214 foreign keys had no index (RC-029);
- there were 52 enums with 24 `ADD VALUE` migrations, and two roles called `store` and `stores` (RC-044);
- prices were limited to 2 decimals (RC-008);
- `updated_at` was not maintained and `updated_by` didn't exist (RC-030);
- the only login could write everywhere (RC-003, RC-193).

v2's tables are empty, so the rules can be in force from the first migration.

## Decision

Every rule below is enforced by the database, or by a test that reads the migrated database. Each names the ticket
that builds it.

**How the rules are tested (M1-05).** The schema tests run in CI against a database migrated from zero on
PostgreSQL 16. They read `pg_catalog` through views in `packages/db/views/` (the SQL zone), because Drizzle's
metadata has no triggers or grants. The pg-boss, migration and rate-limit schemas are excluded: each holds a
library's own table, which carries no audit columns (the rate-limit store, `ratelimit.limits`, is
rate-limiter-flexible's, ADR-003, RAD-32).

### 1. Types and precision (M1-05)

Every numeric column is declared through a helper in `packages/db/src/columns.ts`. Drizzle 0.45's `check()` is
table-level, and a column builder doesn't know its table. So the helpers are used through a table wrapper,
`radcoreTable(name, columns, extras)`, which adds each helper column's CHECK. The schema test catches a numeric
column declared any other way.

| Helper | PostgreSQL type | Default CHECK | Used for |
|---|---|---|---|
| `money()` | `numeric(18,2)` | `>= 0`. `money({ signed: true })` allows negatives (round-off, adjustments, balances) | amounts in rupees |
| `foreignMoney()` | `numeric(18,4)` | `>= 0` | an amount in the document's own currency, kept as entered (RC-009) |
| `unitPrice()` | `numeric(18,6)` | `>= 0` | rates per unit: a price of 0.375 or a foreign unit price is stored exactly (RC-008) |
| `qty()` | `numeric(18,3)` | `> 0` on document lines, `>= 0` elsewhere | quantities |
| `percent()` | `numeric(9,6)` | `between 0 and 100`. `percent({ max })` raises the cap where the law allows more, for example a cess rate | GST, cess, TDS, discount and other rates |
| `fxRate()` | `numeric(18,8)` | `> 0` | exchange rates |

- **Quantity follows its unit.** A document line copies its unit's code and decimals (`uom_code`, `uom_decimals`)
  when it is created.
  - A composite foreign key `(uom_code, uom_decimals)` points at the unit table, which is unique on
    `(code, decimals)`, so a wrong copy is refused.
  - `uom_decimals` is `between 0 and 3`.
  - A CHECK holds `qty = round(qty, uom_decimals)`, so 1.5 Nos is refused (M2-10).
- **Dates.** A business date is `date`; a moment is `timestamptz`. No column default uses `current_date` or a
  server time zone. "Today" in India comes from lib-common and is passed in.
- **Ids.** Documents, ledgers and masters have `uuid` primary keys with the default `gen_random_uuid()`. Lookup
  tables are keyed by `code` (§4). The partitioned logs are keyed by `(id, occurred_at)` (§8).
- **Text.** Text a person types has a length CHECK (the `boundedText()` helper, 200 characters unless set
  otherwise). Codes are `text` with a pattern CHECK.
- **On the wire** (ADR-001 §7a): money is a decimal string, a date is `YYYY-MM-DD`, and a moment is ISO 8601 in
  UTC (`Z`).

**Proof (M1-05):** the schema test fails on a numeric column without its CHECK (`ck_<table>_<column>`), or on any
constraint or index name over 63 bytes, which PostgreSQL would truncate.

### 2. Arithmetic identities (M1-05 for the helpers; each module's tables in M2 to M6)

The database checks the identities that hold whatever rounding rule is used. The price arithmetic itself
(quantity × rate − discount, tax at a rate) stays in lib-common and lib-gst, where it is tested and mutation-tested
(M2-08). Writing it twice would make two copies to keep in step.

- **Within one row, as a CHECK.** For example, on every taxed line:
  - `line_total = taxable + cgst + sgst + igst + cess_ad_valorem + cess_per_unit_amount`;
  - `cgst = sgst`;
  - `igst = 0 or (cgst = 0 and sgst = 0)`;
  - `taxable >= 0`.

  On journal lines, exactly one of debit and credit is above zero. A value-only credit or debit note line has no
  quantity: `(qty is null) = (kind = 'value')`.
- **Across rows, as a deferred check at commit.** A document's header total equals the sum of its lines plus its
  header-level charges (freight, TCS) plus its round-off, with `abs(round_off) < 1`. Other examples: a journal
  entry's debits equal its credits (M2-03), and net allocations never exceed a document's total (§7a).
  - Each module's ticket names the exact columns of its identity, worked out with lib-gst (M2-01, M3-01).
  - The check runs **once per document**, not per row. PostgreSQL 16's constraint triggers can't use transition
    tables, so:
    - per-event statement triggers (with transition tables) on the lines and the header insert each touched
      document's id into `pending_document_checks`, a small table unique per document;
    - a deferred constraint trigger on that table checks each document once at commit, then removes its row.
  - These raise at `COMMIT`. The generic handler maps codes raised at commit like any other (§9).

### 3. Keys and indexes (M1-05)

- **An index on every foreign key.** Each foreign key's columns are the leading columns of an index (or of the
  primary key). Proof: the schema test fails on any foreign key without one (RC-029).
- **Foreign keys never cascade a delete** on ledgers or posted documents. `on delete restrict` is the default
  (RC-004: deleting a payroll run wiped its payslips). Masters are switched off (`active = false`), not deleted. A
  draft document's lines may cascade, and the line trigger (§7) refuses any change once the document is posted.
- **Names.** Tables are plural snake_case. Constraints are named `pk_`, `fk_`, `ck_`, `ix_`, `ux_` plus the table
  and columns, so an error can name the rule that failed (§9).

### 4. Lookup tables, not growing enums (M1-05)

No PostgreSQL `enum` type is used. ADR-002 L9 bans `pgEnum` outside the schema files, and the schema test fails on
any enum. There are two kinds of list:

- **A fixed state machine** (an invoice's status, a journal entry's kind) is `text` with a CHECK listing its values.
  - The values **and the allowed transitions** live as plain constants in lib-common (`src/states/<module>.ts`).
  - The contract's schema and the table's CHECK both import them. packages/db may import lib-common (ADR-001 §4),
    so there's one list and no cycle.
  - Changing a state machine is a migration plus a constant change in one PR.
- **A list that grows or that people edit** (roles, units of measure, lead sources, lost reasons, location kinds,
  expense categories) is a lookup table: `code text primary key` with a pattern CHECK (`^[a-z][a-z0-9_]*$`), a
  `label`, and `active`. Rows reference it by foreign key. Adding a value is an insert, never an `ALTER TYPE`.

**Names stay distinct, in the database.** Every lookup table has two generated columns, both with plain unique
indexes:
- `code_key`: the code in lower case, with `_` removed and one trailing `s` dropped;
- `label_key`: the label in lower case.

Generated columns use `sql` only inside `.generatedAlwaysAs()`, a position ADR-002 L1 allows. So `store` and
`stores` can't both exist (RC-044), whether a seed or a screen tries to add the second. Roles get descriptive
codes (`counter_staff`, `stores_keeper`).

### 5. Who and when, on every table (M1-12)

Every table has `created_at`, `created_by`, `updated_at` and `updated_by`.
- They have database defaults, so they aren't required in Drizzle's insert type. The trigger **always overwrites
  them** from the request context on insert, and on update it keeps `created_*` as they were. So the application
  can't set them, or forge `created_by`.
- The principal is read with `nullif(current_setting('app.principal', true), '')` (set by ADR-002's
  `request-context.ts`). A trigger **raises `RA005`** when it is missing, so a write with no principal fails
  instead of being recorded as nobody.
- `created_by` and `updated_by` hold the principal (a user, a named system principal or a link; ADR-001 §6a).
  They aren't foreign keys, so the index rule in §3 doesn't apply to them. On an append-only table, `updated_*`
  always equals `created_*`.
- **Migrations and the bootstrap write as named system principals.** A migration that writes rows sets
  `app.principal = 'system:migrate'` at its start, and the first-admin bootstrap uses `system:seed` (ADR-004).
- Proof: the schema test fails on a table without the four columns or without the trigger.

### 6. Business date and posting time on every ledger row (M2-03, M2-05)

Every ledger row has both:
- `business_date date`, the date the document says, which the period lock, the financial year and the reports use;
- `posted_at timestamptz`, when it reached the books, which the audit uses.

A back-dated document is visible as one, and the lock is checked against `business_date`.
- **Bounds:** each ledger row has a generated `fy_start` (1 April of the business date's financial year) with a
  foreign key to `financial_years`. A business date outside a financial year the company has opened is therefore
  refused (RC-111). A CHECK can't read the company profile; a foreign key can.
- **The ledger tables** are journal entries and lines, stock movements, unit events, payment allocations and
  credit applications.
- Each is marked as a ledger in its declaration, and the schema test fails on a marked table without both columns.

### 7. Append-only, enforced by triggers and grants (M1-12, M2-03, M2-05)

**Append-only tables, exactly:**
- `journal_entries`, `journal_lines`;
- `stock_movements`, `unit_events`;
- `payment_allocations`, `credit_applications`;
- `audit_log`, `access_log`, `event_log`;
- `webhook_delivery_attempts`.

On each of them, and on **each partition** of the partitioned ones:
- a `BEFORE UPDATE OR DELETE` row trigger raises `RA001`;
- a `BEFORE TRUNCATE` statement trigger raises `RA001`. A TRUNCATE of one partition doesn't fire the parent's
  trigger, so each partition gets its own.

A correction is a new mirror-image row, never an edit.

**Not append-only, by design:**
- **`jobs_outbox`** is a queue. The relay deletes rows (ADR-002 §4).
- **`webhook_deliveries`.** The raw payload, headers, provider and delivery id are write-once: a trigger refuses to
  change them. Retries and outcomes are rows in the append-only `webhook_delivery_attempts`, and the current status
  is read from the latest attempt.
- **pg-boss's own tables**, which the library manages.

#### 7a. Allocations and credit applications

They are append-only with explicit reversals:
- **Rows.** Each row has `direction` (`apply` or `reverse`) and `amount > 0`. The net applied amount is applies
  minus reverses.
- **A reversal can only undo exactly one apply** (all enforced by the database, with no trigger):
  - `CHECK ((direction = 'reverse') = (reverses_id is not null))`: only a reversal names a row, and every
    reversal names one;
  - `reverses_id` is unique, so a row is reversed at most once;
  - a generated column `reverses_direction` (`'apply'` when `reverses_id` is set);
  - a composite foreign key `(reverses_id, document_id, payment_id, amount, reverses_direction)` to a unique key
    on `(id, document_id, payment_id, amount, direction)`.

  So a reversal must point at an `apply` row on the same document and payment, for the same amount. A reversal
  of 1,000 against an apply of 10, or one filed against another document, is refused.
- **When rows may be written.** An apply needs its document to be posted. A posted document moves to cancelled
  only when its net allocations are zero.
- **The cap.** A deferred check holds net allocations plus net credit applications at or below the document's
  total.
  - It **first locks the document row** (`SELECT ... ORDER BY id FOR UPDATE`, so locks are always taken in one
    order) and only then sums.
  - So two transactions allocating 60 each against an invoice of 100 can't both pass: the second waits for the
    first's commit, sums again, and is refused (`RA006`).

#### 7b. Posted documents (issued invoices and credit notes, posted bills, payments, expenses, payslips)

- **Transitions.** Each document kind's allowed status transitions live in a `state_transitions` table seeded by
  an owner migration. A test checks it equals the lib-common constant, since a SQL trigger can't read a TypeScript
  constant.
  - For a posted document the only transition is **posted → cancelled**, and cancelled is final, so a document
    can't be reopened or un-cancelled. The trigger checks `(old.status, new.status)` against the table.
  - **On insert**, a document must start in its initial state (draft), with its cancel and write-once columns
    null, so nothing can be inserted already posted or cancelled.
- **What may change after posting:**
  - **Cancel columns** (`cancelled_at`, `cancelled_by`, `cancel_reason`, `cancel_entry_id`). Each is written once,
    from null, and only in the same update that moves the status to cancelled.
  - **Write-once reference columns** (e-invoice IRN, acknowledgement number and date, signed QR). Each goes from
    null to a value once, and never changes again. E-way bills, which can be extended, updated (Part B) or
    cancelled and regenerated, and IRN cancellation are events in an append-only child table, not columns.
  - The audit columns (§5) and stored generated columns, which the guard doesn't compare.

  Any other change, or a delete, raises `RA004`. This closes RC-004 for every posted document, not only invoices.
- **Lines.** A trigger on each line table (`BEFORE INSERT OR UPDATE OR DELETE`) checks the parent's status, locking
  it with `FOR NO KEY UPDATE` (the same lock strength the document trigger takes, so the two can't deadlock), and
  refuses unless the parent is a draft.
  - **A line's parent column can't change**: a line moves to another document only by a delete and an insert, each
    checked against its own parent. This trigger therefore checks the `OLD` parent on update and delete, and the
    `NEW` parent on insert, and a line can't be moved off a posted invoice.
  - When a draft document is deleted and its lines go with it by cascade, the parent row no longer exists, and the
    trigger allows the delete.
  - An edit that keeps the totals can't slip past.
- **Cancelling in a locked period.** A cancellation's mirror entries are dated with the cancellation's own
  business date, not the original's, so the period lock (`RA003`) applies to the day of the cancellation.

#### 7c. Triggers can't be captured or bypassed

- **Trigger functions run as their owner.** Every trigger function is `SECURITY DEFINER`, owned by
  `radcore_owner`, with `SET search_path = pg_catalog, radcore, pg_temp` (pg_temp last), and names tables with
  their schema. A session's temporary table can't stand in for `audit_log`.
- **No temporary tables:** `REVOKE TEMPORARY ON DATABASE radcore FROM PUBLIC`, and the runtime login isn't granted
  it.
- **The runtime login** (M1-06):
  - It has no `UPDATE`, `DELETE` or `TRUNCATE` on the append-only tables, no DDL anywhere, and **no `INSERT` on
    `audit_log`, `access_log` or `event_log`**.
  - The audit log is written only by triggers.
  - The event log is written only through `record_event(kind, user_id, device, detail)` (RAD-31), a
    `SECURITY DEFINER` function like `record_access`. The app chooses `user_id`, the account the event concerns, as
    it chooses `record_access`'s record: it's trusted code, and the row's principal and time stay the database's
    own. `detail` holds references only and is at most 2 KB; `kind` is one of a CHECKed list.
  - Every refused sign-in adds a row, so a locked address being tried adds one per try. Nothing dedupes them: a
    known and an unknown address must do the same work (RAD-64). The per-IP limit (RAD-39) bounds the rows one
    source can add, and each is under 2 KB (RAD-34).
  - The access log is written only through one `SECURITY DEFINER` function, `record_access(record_table,
    record_id)`. It takes **no** principal or time argument: it reads the principal from the request context and
    the time from `now()` itself. The runtime login can therefore append an access row, but can't alter one or
    choose who or when.
- **No function is callable by default.**
  - `REVOKE EXECUTE ON FUNCTION record_access FROM PUBLIC`, then `GRANT` it to `radcore_app` only. `radcore_read`
    can't call it. The same goes for `record_event`.
  - `ALTER DEFAULT PRIVILEGES FOR ROLE radcore_owner REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`, so a function added
    later isn't callable by everyone either.
  - A schema test fails on any non-trigger `SECURITY DEFINER` function that PUBLIC can execute or that has no fixed
    `search_path`. Trigger functions can't be called directly.
- **Three facts on every audit and access row:**
  - `app.principal`: who the request was for. Any session can set it.
  - `session_user`: the login that ran it. The database sets it.
  - `inet_client_addr()`: the client address the database saw.

  `api` and `worker` share `radcore_app`, so separate logins per process are an option for M1-06 if the audit needs
  to tell them apart.
- **What an audit row holds** (RAD-30, M6-16: references, not copies). `table_name`, `record_id`, `seq`, `op`, and
  `changed` as jsonb (an insert's new row, an update's changed columns as old and new, or a delete's old row), without
  the four who-and-when columns. Each column of an audited table is listed at `audit_attach` as `keep` (recorded) or
  `redact` (written as `[redacted]`). Secrets, hashes and all personal data are redacted, and the schema test fails on
  an unlisted column. An update that changes nothing kept or redacted writes no row. Machinery tables (`saved_once`,
  `jobs_outbox`, `webhook_deliveries`, `sessions`, `change_reasons`) get the who-and-when trigger only. A session's
  `last_seen_at` changes on every request, and its start and end are security events (RAD-34).
- **Why a change was made** (RAD-36). When a write's contract asks for a reason (lib-common's `reason()`), the handler
  stores it in `change_reasons` and sets `app.reason_id`, and each audit row of that change carries `reason_id`, a
  reference, never the text. The reason's own table isn't copied into the audit log (`capture => false`), so the text
  can be corrected or erased later without touching an append-only row.
  - It's written only through `radcore.record_change_reason`, a `SECURITY DEFINER` function that inserts the reason
    and sets `app.reason_id` for the transaction. `audit_log.reason_id` takes it as a column default, as
    `created_by` takes `app.principal`.
  - The runtime login has no INSERT, UPDATE or DELETE on the table, and `radcore_read` has nothing on it.
- **The owner login** runs migrations and the partition top-up only, from CI. It never sits on the server or in the
  API or worker containers (RC-003, ADR-004 §3). A read-only login, `radcore_read`, serves the restore drill and
  support queries (RC-193).
- **How the three are made (M1-06).**
  - **The logins.** A superuser, or on RDS the master user, makes them with `npm run db:logins`
    (`tools/db-logins.ts`), once, before the first migration. Each login is plain: no superuser, no CREATEROLE, no
    CREATEDB, no replication, no BYPASSRLS. A login that has one of these is refused, not changed. The owner
    login gets the database. Passwords are sent as SCRAM verifiers, so none lands in the server log.
  - **What each may do** is the owner migration `0002_logins.sql`. PUBLIC loses every database privilege
    (`TEMPORARY` included), and besides the owner only `radcore_app` and `radcore_read` get `CONNECT`. The
    owner's default privileges give `radcore_app` `SELECT, INSERT, UPDATE, DELETE` on new tables in `radcore`, and
    `radcore_read` `SELECT`. `radcore_app` also gets the rows of pg-boss's tables and of `ratelimit.limits`
    (RAD-32); `radcore_read` gets neither. Neither login owns anything, so neither can alter or drop it.
  - **Per table.** An append-only table's own migration revokes `UPDATE, DELETE, TRUNCATE`, plus `INSERT` on
    `audit_log` and `access_log`. A view's migration revokes `INSERT, UPDATE, DELETE`, because a simple view
    writes as its owner.
  - **Every partition** gets `REVOKE ALL ... FROM radcore_app, radcore_read`, whether a migration or the
    top-up (§8) made it. Rows go through the parent, and the owner's default privileges would otherwise let the
    app insert straight into an `audit_log` partition and forge audit rows.
  - **Closed to the read-only login:** `radcore.secrets` (RAD-65). Its migration revokes everything from
    `radcore_read`, and `tools/logins.test.ts` checks it.
  - **The guard.** `tools/logins.test.ts` fails on any append-only table, log or view that `radcore_app` can
    still write, and on any partition either login holds a privilege on.
  - **The settings check** refuses `radcore_owner` as `DATABASE_URL` everywhere. In staging and production it
    requires `radcore_app` there, and refuses a set `MIGRATION_DATABASE_URL`, `DATABASE_ADMIN_URL`,
    `POSTGRES_PASSWORD` or `RADCORE_OWNER_PASSWORD`.
  - **pg-boss's index rebuild** needs the index's owner, so the worker's queue runs with `reindex: false`.
    Rebuilding the job indexes is an owner task.
- **Extensions.** Only trusted extensions, each named here: `pg_trgm` (RAD-47, the list search index). The owner
  migration creates them in the schema `radcore_ext`, where neither login has `USAGE`, so neither can call their
  functions; index scans don't need it. Their member objects belong to the bootstrap superuser, so the owner's
  default `REVOKE EXECUTE` doesn't reach them, and the missing `USAGE` does that job.

**Access logging and read-only requests.** A GET runs read-only (ADR-002 §4), so it can't write `access_log`. When
a GET opens a full record:
1. lib-platform commits the read.
2. It writes the access row through `record_access` in its own short transaction, before the response goes out.
3. If that write fails, the request fails, and the record isn't returned without its log.

A public link's request (`auth: 'link'`, ADR-001 §6a, RAD-41) is logged the same way, by the generic handler, after
every such request's work commits. Its row names the record's table and id, like any opening, and its principal is
`link:<id>`, whose link row names the action. The module names the table when it makes the link
(`public_links.record_table`, which must be one of radcore's tables). That check runs only when a row is written, so
a migration that renames such a table also updates `public_links.record_table`.

A full record is served, and its access logged, only when the browser's `Sec-Fetch-Site` is `same-origin`, or
`none` (a typed address or a bookmark). Otherwise a cross-site link could make a person "open" a record they never
looked at, for example to make it seem they viewed someone's pay.
- The browser sets this header itself, and a page can't change it.
- It reaches `api` in one of two ways (ADR-004 §3): straight from the browser through `proxy`, or forwarded by
  `web`'s server components. `web` forwards the browser's own value **unchanged** on every call to `api`, and never
  sets one itself.
- A request without the header, or with `cross-site` or `same-site`, gets the record's page without the full
  record. A link from an email is one of these. The person opens the record with one click, which is a same-origin
  request.

**Proof (M1-06, M1-12):**
- For every append-only table **and every partition, the default included, by name**, a test connected as the
  runtime login tries `UPDATE`, `DELETE`, `TRUNCATE` and `INSERT` into `audit_log`. Each is refused.
- The same statements run as the owner are refused by the trigger with `RA001`.
- A runtime session's `CREATE TEMP TABLE audit_log (...)` is refused, and an audited write still lands in
  `radcore.audit_log`.
- A posted invoice can't be moved to `draft`, its lines can't be edited, and a write-once column can't be written
  twice.
- A full-record read with `Sec-Fetch-Site: cross-site`, or with no header, returns no full record and writes no
  access row. With `same-origin` or `none` it does both, including through `web`'s server-side call.

### 8. Logs partitioned by month (M1-12)

`audit_log`, `access_log` and `event_log` are partitioned by range on their `occurred_at`, one partition per
calendar month in UTC (RC-046).

- **Keys.** The primary key is `(id, occurred_at)`, as PostgreSQL requires the partition key in it.
- **The time is the database's.** `occurred_at` defaults to `now()`. A trigger refuses a caller-supplied value more
  than five minutes from `now()`, so nobody can plant a row far ahead in the default partition and break the next
  top-up.
- **Partitions are created ahead, by the owner.**
  - The first migration creates 24 months of partitions.
  - The top-up runs inside `migrate()`, after the migrations, under the same lock (`radcore.add_log_partitions`,
    ADR-002 L3), on every deploy and in the test setup. It is idempotent, keeps `LOG_MONTHS_AHEAD` = 12 future
    months, and gives each new partition its revokes and TRUNCATE trigger.
  - Each new partition, from the first migration or the top-up, gets `REVOKE ALL ... FROM radcore_app,
    radcore_read` (§7c), so rows reach it only through the parent's grants.
  - The runtime login can't create, drop or truncate a partition, because it owns none and has no DDL.
- **The worker only watches.** A scheduled job reads a view of the partitions. It raises an alert when fewer than
  3 future months remain, or when any row sits in the default partition.
- **The default partition** catches only a row outside every partition, which should never happen. Recovering one
  is a reviewed owner migration:
  1. detach the default partition;
  2. create the missing month;
  3. move its rows through the parent;
  4. drop the detached table;
  5. re-create the default with its triggers.

  The moved rows are re-stamped by the audit trigger, so the migration records `system:migrate` and the recovery's
  time; their own `occurred_at` stays as it was.
- **Retention.** Partitions are never dropped: D-12 keeps all data permanently. Dropping one would take a change to
  D-12 and an owner migration, never the application.
- **Drizzle.** Drizzle can't declare a partitioned table, so these three are created by hand-written migrations
  (`drizzle-kit generate --custom`). Their Drizzle declarations exist only for typed reads, and live in a file
  outside the schema glob in `drizzle.config.ts`, which also sets `casing: 'snake_case'`. M1-05 confirms that
  drizzle-kit `generate` then leaves them alone.

### 9. Error codes

A trigger raises a custom SQLSTATE in the `RA` class. A constraint raises PostgreSQL's own code: `23514` for a
CHECK, `23505` for a unique violation, `23503` for a foreign key, `23502` for a not-null. lib-platform maps
errors by **SQLSTATE plus constraint name**, never by message text (ADR-001 §6). That's why constraint names stay
under 63 bytes (§1).

| Code | Meaning |
|---|---|
| RA001 | an append-only row was changed, deleted or truncated |
| RA002 | a journal entry's debits and credits differ |
| RA003 | the business date falls in a locked period |
| RA004 | a posted document was changed outside its cancel and write-once columns, moved to a status it may not reach, or deleted, or its lines were touched |
| RA005 | a write ran with no principal in the request context |
| RA006 | a document's header and lines disagree (total, round-off), or allocations exceed it |
| RA007 | stock: a document's movements and its Stock in Hand lines disagree, an empty location holds value, a movement's units don't match its quantity, or an issue would take stock below zero (ADR-006 §4) |
| RA008 | a unit event isn't allowed from the unit's current state (ADR-006 §5) |

(The `RA` prefix keeps them apart from the register's RC-numbers, which name v1 defects.)

### 10. camelCase on the wire, snake_case in the database, no conversion layer (M1-05, M1-08)

- Columns are snake_case. Drizzle's `casing: 'snake_case'` option, set in both the client and
  `drizzle.config.ts`, maps them. Table objects, relational results and view rows have camelCase keys with no code
  of ours in between.
- The zod output schemas in each contract are camelCase. The generic handler returns what the service returns,
  checked against the output schema (ADR-001 §6). There is no per-row key conversion anywhere, which v1 had in
  `app.ts`.

## Agreement with ADR-002

| Thing | Where it lives (ADR-002 §3) |
|---|---|
| Column CHECKs, row identities, generated keys, length and pattern CHECKs | `packages/db/src/columns.ts` helpers and `packages/db/src/*/tables.ts` |
| State-machine values and transitions | lib-common constants, imported by contracts and tables |
| Deferred checks, append-only, posted-document and line triggers, audit triggers, `record_access`, the partitioned logs and their partitions | hand-written migrations in `packages/db/migrations/`, run as the owner |
| Report views (with their scope columns) and the `pg_catalog` views the schema tests read | `packages/db/views/*.ts` |
| The principal and the per-contract statement timeout | `packages/db/src/request-context.ts` |

## Consequences

- Wrong data is refused at the database, whatever path the write took: a service, a job, or SQL typed into a
  console with the runtime login. The audit trail can't be redirected, rewritten or truncated by that login.
- Adding a value to a list that people edit is an insert; adding a status to a state machine is a migration and a
  constant change in one PR.
- Every table carries four audit columns and triggers. The cost on writes is small, and it removes v1's 185
  hand-written `audit()` calls (RC-030).
- Partitions are created by deploys, not by the application, so a long gap between deploys is what the watch job
  alerts on.

## Alternatives considered

- **Postgres enums.** They're compact, but values can't be removed and each addition is a migration (RC-044's
  24 `ADD VALUE`s). Rejected.
- **Row identities as hand-written CHECKs on the price arithmetic** (taxable = round(qty × price ...)). This would
  copy the rounding rule into SQL beside lib-gst's. Rejected; the database checks sums and splits only.
- **`created_by` as a foreign key to users.** It would need an index on every table and would exclude system and
  link principals. Rejected; the triggers write the principal.
- **The runtime login creating partitions.** It would own them, and could truncate or drop them. Rejected;
  partitions are the owner's.
- **pg_partman for partitions.** It works and is available on RDS, but it would run maintenance with DDL rights at
  run time. Creating partitions ahead in deploys keeps every DDL step with the owner.
