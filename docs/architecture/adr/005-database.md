# ADR-005: Database conventions

- Status: accepted
- Date: 2026-11-06
- Ticket: RAD-11 (M0-06). The basis for M1-05, M1-06 and M1-12, which cover RC-024, RC-029, RC-044, RC-003,
  RC-193, RC-030 and RC-046.
- Builds on: [ADR-001](001-layers.md) (one owner per table), [ADR-002](002-data-access.md) (the SQL zone: CHECKs in
  `tables.ts` and `columns.ts`, triggers in `migrations/`, views in `views/`).

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

Every rule below is enforced by the database or by a test that reads the schema. Each names the ticket that builds
it.

### 1. Types and precision (M1-05)

Every numeric column is declared through a helper in `packages/db/src/columns.ts`. The helper fixes the type and adds
its CHECK, so a column can't be declared without one.

| Helper | PostgreSQL type | Default CHECK | Used for |
|---|---|---|---|
| `money()` | `numeric(18,2)` | `>= 0`. `money({ signed: true })` allows negatives (round-off, adjustments, balances) | amounts in rupees |
| `foreignMoney()` | `numeric(18,4)` | `>= 0` | an amount in the document's own currency, kept as entered (RC-009) |
| `unitPrice()` | `numeric(18,6)` | `>= 0` | rates per unit: a price of 0.375 or a foreign unit price is stored exactly (RC-008) |
| `qty()` | `numeric(18,3)` | `> 0` on document lines, `>= 0` elsewhere | quantities |
| `percent()` | `numeric(9,6)` | `between 0 and 100`. `percent({ max })` raises the cap where the law allows more, for example a cess rate | GST, cess, TDS, discount and other rates |
| `fxRate()` | `numeric(18,8)` | `> 0` | exchange rates |

- **Quantity follows its unit.** A document line copies its unit's code and decimals (`uom_code`, `uom_decimals`)
  when it is created. A CHECK holds `qty = round(qty, uom_decimals)`, so 1.5 Nos is refused (M2-10).
- **Dates.** A business date is `date`; a moment is `timestamptz`. No column default uses `current_date` or a
  server time zone. "Today" in India comes from lib-common and is passed in.
- **Ids.** `uuid` primary keys with the default `gen_random_uuid()`.
- **Text.** Text a person types has a length CHECK (the `boundedText()` helper, 200 characters unless set
  otherwise). Codes are `text` with a pattern CHECK.
- **Money on the wire** is a decimal string, a date is `YYYY-MM-DD`, and a moment is ISO 8601 with its offset.

**Proof (M1-05):** a test reads every table through Drizzle's schema metadata. It fails on a numeric column whose
CHECK constraint (named `ck_<table>_<column>`) is missing.

### 2. Arithmetic identities (M1-05 for the helpers; each module's tables in M2 to M6)

The database checks the identities that hold whatever rounding rule is used. The price arithmetic itself
(quantity × rate − discount, tax at a rate) stays in lib-common and lib-gst, where it is tested and mutation-tested
(M2-08). Writing it twice would make two copies to keep in step.

- **Within one row, as a CHECK.** For example, on every taxed line:
  - `line_total = taxable + cgst + sgst + igst + cess`;
  - `cgst = sgst`;
  - `igst = 0 or (cgst = 0 and sgst = 0)`;
  - `taxable >= 0`.
  The same pattern holds on journal lines (exactly one of debit or credit is above zero) and on payment
  allocations (`amount > 0`).
- **Across rows, as a deferred constraint trigger** checked at commit (`DEFERRABLE INITIALLY DEFERRED`):
  - a document's header total equals the sum of its lines plus its round-off, with `abs(round_off) < 1`;
  - a journal entry's debits equal its credits (M2-03);
  - allocations against a document never exceed its total.
- Each failure raises its own error code (§9), which lib-platform maps to a message a person can act on.

### 3. Keys and indexes (M1-05)

- **An index on every foreign key.** Each foreign key's columns are the leading columns of an index (or of the
  primary key). Proof: a schema-metadata test fails on any foreign key without one (RC-029).
- **Foreign keys never cascade a delete.** `on delete restrict` is the default and is never overridden for
  ledgers or posted documents (RC-004: deleting a payroll run wiped its payslips). Masters are switched off
  (`active = false`), not deleted. A draft document's lines may cascade, and a trigger refuses deleting a document
  once it is posted.
- **Names.** Tables are plural snake_case. Constraints are named `pk_`, `fk_`, `ck_`, `ix_`, `ux_` plus the table
  and columns, so an error code can name the rule that failed.

### 4. Lookup tables, not growing enums (M1-05)

No PostgreSQL `enum` type is used (ADR-002 L9 also bans `pgEnum` outside the schema files, and the schema doesn't
use it). There are two kinds of list:

- **A fixed state machine** (an invoice's status, a journal entry's kind) is `text` with a CHECK listing its values.
  The CHECK is generated from the one constant in the owning library's contract, so code and database agree.
  Changing it is a migration, which is right for a state machine.
- **A list that grows or that people edit** (roles, units of measure, lead sources, lost reasons, location kinds,
  expense categories) is a lookup table: `code text primary key` with a pattern CHECK (`^[a-z][a-z0-9_]*$`), a
  `label`, and `active`. Rows reference it by foreign key. Adding a value is an insert, never an `ALTER TYPE`.

Proof: the schema-metadata test fails if the schema declares any enum.

**Names stay distinct.** In every lookup table, codes are unique, and labels are unique ignoring case
(`ux_<table>_label_lower`). A seed test fails when two codes are equal after removing case, `_` and a trailing `s`.
So `store` and `stores` can't both exist (RC-044). Roles get descriptive codes (`counter_staff`, `stores_keeper`).

### 5. Who and when, on every table (M1-12)

Every table has `created_at`, `created_by`, `updated_at` and `updated_by`.
- They are filled by triggers, never by the application. The triggers read the principal and time from the
  request context set by `request-context.ts` (ADR-002 §3).
- The principal is read with `nullif(current_setting('app.principal', true), '')`. A trigger **raises** when it is
  missing, so a write with no principal fails instead of being recorded as nobody.
- `created_by` and `updated_by` hold the principal's id (a user, a named system principal or a link; ADR-001 §6a).
  They aren't foreign keys, so the index rule in §3 doesn't apply to them. On an append-only table, `updated_*`
  always equals `created_*`.
- Proof: a schema-metadata test fails on a table without the four columns or without the trigger.

### 6. Business date and posting time on every ledger row (M2-03, M2-05)

Every ledger row has both:
- `business_date date`, the date the document says, which the period lock, the financial year and the reports use;
- `posted_at timestamptz`, when it reached the books, which the audit uses.

A back-dated document is visible as one, and the lock is checked against `business_date`. A CHECK bounds
`business_date` to the company's first financial year onwards (RC-111). The ledger tables are journal lines and
entries, stock movements, unit events, payment allocations and credit applications. Each is marked as a ledger in
its declaration, and the schema-metadata test fails on a marked table without both columns.

### 7. Append-only, enforced by triggers (M1-12, M2-03, M2-05)

The ledgers and logs are append-only:
- journal entries and lines, stock movements, unit events;
- the audit, access and event logs;
- webhook deliveries and the jobs outbox history.

The protection has three parts:
- A `BEFORE UPDATE OR DELETE` row trigger and a `BEFORE TRUNCATE` statement trigger raise `RC001`.
- A correction is a new mirror-image entry, never an edit.
- **Posted documents** (issued invoices and credit notes, posted bills, payments, expenses, payslips) refuse any
  change after posting except the named cancel columns. The trigger lists those columns, raises `RC004` for
  anything else, and refuses a delete. This closes RC-004 for every posted document, not only invoices.

Defence in depth (M1-06):
- The runtime login has no `UPDATE`, `DELETE` or `TRUNCATE` on the append-only tables, and no DDL anywhere.
- The owner login runs migrations only and never sits in the API or worker containers (RC-003).
- A read-only login serves reports and the restore drill (RC-193).
- Even SQL that slipped past ADR-002's lint couldn't disable a trigger.

Proof (M1-06, M1-12): for every append-only table, a test connects as the runtime login and tries `UPDATE`,
`DELETE` and `TRUNCATE`. Each is refused. The same statements run as the owner are refused by the trigger with
`RC001`.

### 8. Logs partitioned by month (M1-12)

`audit_log`, `access_log` and `event_log` are partitioned by range on their `occurred_at`, one partition per
calendar month in UTC (RC-046):

- Their primary key is `(id, occurred_at)`, as PostgreSQL requires the partition key in it.
- A scheduled job (M1-26) creates the next three months' partitions. A default partition catches anything outside
  them, and a row landing there raises an alert.
- Old partitions are detached and dropped only under the retention rule (D-12), never by hand.
- Drizzle can't declare a partitioned table. These three are therefore created by hand-written migrations
  (`drizzle-kit generate --custom`). Their Drizzle declarations exist only for typed reads, and drizzle-kit's
  `tablesFilter` skips them so it never tries to create them.

### 9. Error codes

Triggers and constraints raise a custom SQLSTATE that lib-platform maps by code, never by message text
(ADR-001 §6):

| Code | Meaning |
|---|---|
| RC001 | an append-only row was changed, deleted or truncated |
| RC002 | a journal entry's debits and credits differ |
| RC003 | the business date falls in a locked period |
| RC004 | a posted document was changed outside its cancel columns, or deleted |
| RC005 | a write ran with no principal in the request context |
| RC006 | a document's header and lines disagree (total, round-off, allocations) |

### 10. camelCase on the wire, snake_case in the database, no conversion layer (M1-05, M1-08)

- Columns are snake_case. Drizzle's `casing: 'snake_case'` option maps them, so table objects, relational results
  and view rows have camelCase keys with no code of ours in between.
- The zod output schemas in each contract are camelCase. The generic handler returns what the service returns,
  checked against the output schema (ADR-001 §6). There is no per-row key conversion anywhere, which v1 had in
  `app.ts`.

## Agreement with ADR-002

| Thing | Where it lives (ADR-002 §3) |
|---|---|
| Column CHECKs, row identities, length and pattern CHECKs | `packages/db/src/columns.ts` helpers and `packages/db/src/*/tables.ts` |
| Deferred constraint triggers, append-only and posted-document triggers, audit triggers, partitioned logs | hand-written migrations in `packages/db/migrations/` |
| Report views (with their scope columns) | `packages/db/views/*.ts` |
| The principal and the per-contract statement timeout | `packages/db/src/request-context.ts` |

## Consequences

- Wrong data is refused at the database, whatever path the write took: a service, a job, or SQL typed into a
  console with the runtime login.
- Adding a value to a list that people edit is an insert; adding a status to a state machine is a migration and a
  constant change in one PR.
- Every table carries four audit columns and triggers. The cost on writes is small, and it removes v1's 185
  hand-written `audit()` calls (RC-030).
- The three logs need a partition-creation job from the first month.

## Alternatives considered

- **Postgres enums.** They're compact, but values can't be removed and each addition is a migration (RC-044's
  24 `ADD VALUE`s). Rejected.
- **Row identities as hand-written CHECKs on the price arithmetic** (taxable = round(qty × price ...)). This would
  copy the rounding rule into SQL beside lib-gst's. Rejected; the database checks sums and splits only.
- **`created_by` as a foreign key to users.** It would need an index on every table and would exclude system and
  link principals. Rejected; the triggers write the principal's id.
- **pg_partman for partitions.** It works and is available on RDS, but one small job does three tables, and the job
  queue already exists.
