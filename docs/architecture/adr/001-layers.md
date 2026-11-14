# ADR-001: Layers: module-wise libraries, thin routes

- Status: accepted
- Date: 2026-11-05
- Ticket: RAD-7 (M0-02). Covers RC-175.
- Decided by: N2 (Sarthak, 5 Nov 2026: "yes, and we can have multiple library module-wise for better management").
  `lib-platform`, `apps/worker` and where the masters and engines go were approved by the coordinator on 5 Nov.
- Diagram: [../packages.md](../packages.md)

## Context

In v1, seven files of 700 to 1,400 lines mixed routes, SQL and business rules (RC-175). The background worker
could not reuse a service without loading the web layer. Permission checks sat only in route files (Technical
report Theme 1). One request held one transaction with no time limit (Theme 12).

v2 starts empty on `dev`. This ADR fixes its shape before the skeleton is built (M0-07, RAD-13), so every later
ticket lands in a known place.

## Decision

### 1. Packages

npm workspaces, scope `@radcore/`. Every package and app is TypeScript. There are 17 workspaces: 14 packages and 3 apps.

| Workspace | Holds | I/O |
|---|---|---|
| `packages/lib-common` | Money and decimal helpers, dates and financial year, identity formats (GSTIN, PAN, phone, ids), base zod schemas (including the `pii()` field marker), `defineContract`, and the permission key names (which roles hold them is lib-platform data). | **None**: no database, network, file system, environment or clock reads. Safe in the browser. |
| `packages/db` | Drizzle schema split per module, relations, repositories, view declarations, migrations. See ADR-002 and ADR-005. | Database only |
| `packages/lib-platform` | Shared server-side pieces: database client and transactions, `Ctx`, sessions, permission checks with record scope, saved-once, jobs queue, file store, secrets, maker-checker, public links, lists/search/export, file import, numbering, settings, logging, config, webhook intake. | Yes. **Never imported by `apps/web`.** |
| `packages/lib-integrations` | Adapters to outside services: Meta, WhatsApp, Google, Shopify, marketplaces, the statements mailbox, a GSP. Clients, payload parsers, signature checks. It knows no RadCore module. | Network |
| `packages/lib-<module>` (×10) | One per module: lib-crm, lib-sales, lib-stock, lib-purchasing, lib-accounts, lib-gst, lib-hr, lib-payroll, lib-ops, lib-service. Each holds that module's rules, schemas and service functions. | Through `Ctx` and `packages/db` |
| `apps/api` | The HTTP server: route declarations run by one generic handler. | HTTP |
| `apps/worker` | A separate process that runs queued and scheduled jobs. | Queue |
| `apps/web` | Next.js screens calling a typed client. | Browser |

That makes 12 libraries (lib-platform, lib-integrations and the 10 module libraries) plus lib-common.

### 2. Each library's public surface

A library has exactly two entry points, declared in its `package.json` `exports`. Nothing else is importable from
outside it.

```
packages/lib-sales/
  package.json      "exports": { ".": "./src/index.ts", "./contract": "./src/contract.ts" }
  src/index.ts      services and types for the server (api, worker, other libraries)
  src/contract.ts   route contracts and zod schemas: browser-safe, imports only zod, lib-common
                    and other libraries' contract entries
  src/rules/        pure functions: no Ctx, no db, no platform (the money and tax rules that M2-08 mutation-tests)
  src/services/     functions of the form (ctx, input) => Promise<result>
```

The second entry, `contract`, exists so the web app can share the module's schemas without pulling server code
into the browser bundle.

lib-platform has three entries:
- `.`, server-only;
- `./contract`, browser-safe. It holds the contracts for what every screen needs from the platform: sign-in,
  sign-out, the second factor, invites and password change, the current session (`/me`), the person's sessions,
  settings, file upload and download links, and approvals. The error and list envelopes those contracts use are
  in lib-common (§7a), so every contract shares them.
- `./runtime`, which opens transactions, builds the pool and starts the server or worker. Only `apps/api` and
  `apps/worker` may import it, so no library can open its own transaction (ADR-002, rule L7).

lib-common's single `.` entry is already browser-safe.

### 3. Where each master, engine and document lives

| Library | Owns (its tables, its services) |
|---|---|
| lib-platform | users, roles and the permission matrix, sessions, saved-once keys, jobs, files, secrets, settings, numbering series, approvals (maker-checker), public links, webhook deliveries; the audit context the database triggers read |
| lib-integrations | no tables: provider clients, payload parsers and signature checks only (inbound work lives in the owning module, §8a) |
| lib-hr | employees master, hiring, attendance, leave |
| lib-gst | GST rates by date, tax maths (split, cess, place of supply), returns (GSTR-1, GSTR-3B) read from views, e-invoice adapter use |
| lib-ops | tasks, routines, projects, allocation, assets, maintenance; the cross-module home overview (read from views only) |
| lib-accounts | company profile, parties, chart of accounts, journal engine (post and reverse), payments and allocations, expenses, bank and reconciliation, TDS, currency and rates, year close, the books reports |
| lib-crm | leads, capture, pipeline, follow-ups and plans, quick replies, campaigns, ad spend, consent |
| lib-stock | items and units of measure, locations, units by serial, stock engine (in, out, transfer), reservations, transfers, counts, adjustments, job work |
| lib-payroll | payroll runs, payslips, salary history, advances |
| lib-purchasing | purchase orders, goods receipt and QC, purchase bills, supplier returns and debit notes, imports and landed cost |
| lib-sales | price lists, credit and price checks, quotes, orders, deliveries, invoices, credit notes, quick bill, vehicle bookings and test rides, invoice and estimate links, printouts |
| lib-service | job cards, warranty rules, fault codes, supplier warranty claims |

Each module keeps its own dashboard. A flow that writes into several modules lives in the lowest library that may
depend on all of them, and calls their services. For example, the quick bill lives in lib-sales and calls
lib-stock and lib-accounts.

### 4. Who may depend on whom

The foundations come first: lib-common imports nothing from `@radcore/*`; packages/db imports lib-common;
lib-platform imports lib-common and packages/db.

Each library in the table below may import lib-common and lib-platform. Each may also import packages/db within
the ownership rule in §5, except lib-integrations, which has no tables. The last column is the full list of other
libraries it may import. Every edge points from a higher rank to a lower one, so there can be no cycle.

| Rank | Library | Other libraries it may import |
|---|---|---|
| 3 | lib-integrations | none (and not packages/db) |
| 3 | lib-hr | none |
| 4 | lib-gst | lib-integrations |
| 4 | lib-ops | lib-hr |
| 5 | lib-accounts | lib-gst, lib-integrations |
| 6 | lib-crm | lib-accounts, lib-ops (follow-ups that become tasks), lib-integrations |
| 6 | lib-stock | lib-accounts, lib-gst, lib-integrations (stock levels pushed to Shopify) |
| 6 | lib-payroll | lib-hr, lib-accounts |
| 7 | lib-purchasing | lib-stock, lib-accounts, lib-gst |
| 7 | lib-sales | lib-stock, lib-accounts, lib-gst, lib-crm, lib-integrations |
| 8 | lib-service | lib-sales, lib-stock, lib-accounts, lib-purchasing, lib-ops (technicians allocated to job cards) |

Some flows need no edge. When lib-accounts records a receipt against an invoice, it writes only its own allocation
rows. "Paid" is then read from a view, so lib-accounts never writes a sales table.

| App | May import |
|---|---|
| apps/api | lib-platform and every library's `.` and `./contract` entries; **not** packages/db |
| apps/worker | the same as apps/api |
| apps/web | lib-common and every library's `./contract` entry, lib-platform's included, **nothing else**: not lib-platform's `.` or `./runtime`, not packages/db, not a library's `.` entry. This holds for all of `apps/web`, including server components, route handlers and middleware: the web server also talks to the API over HTTP |

**Test-only helpers** (RAD-49, M1-31). `packages/test-helpers` (`@radcore/test-helpers`: the fake clock and the
test-data factories) is an 18th workspace that ships no production code. Only `*.test.ts` and `*.test.tsx` files may
import it, from any workspace; any other import of it fails D2. It imports nothing from `@radcore/*` today; an edge
to lib-common (for the Clock type, RAD-20) is added here in the PR that first needs it.

No package under `packages/` imports an HTTP framework (Express, Next) or anything under `apps/`. That is what lets
the worker run any service without loading the web layer, which is RC-175's fix.

Adding an edge to the table means amending this ADR in a PR the architect reviews.

### 5. One owner per table

Each table belongs to exactly one library: its schema file sits in `packages/db/src/<module>/`, the same module
as the library. packages/db publishes exactly these entries:

```
"exports": {
  "./<module>":         "./src/<module>/index.ts",     one per module with tables (platform, hr, gst, ops, accounts,
                                                        crm, stock, payroll, purchasing, sales, service); only lib-<module>
  "./views":            "./views/index.ts",            every library
  "./schema":           "./src/schema.ts",             lib-platform only (builds the client)
  "./request-context":  "./src/request-context.ts",    lib-platform only
  "./migrate":          "./src/migrate.ts"             lib-platform only
}
```

**How ownership is enforced.** Each point below fails a check, and has a fixture (see Enforcement):

- `ctx.tx` is **opaque**. Its type has no `query`, `select`, `insert`, `update`, `delete`, `execute` or `_`, so a
  service can only pass it on (T1).
- A library gets a usable transaction for its own module only: `const tx = salesTx(ctx)`, from `@radcore/db/sales`.
  Only lib-sales may import that entry (D7), so only lib-sales can obtain a `SalesTx`. The type exposes `query`
  for the sales tables only, plus `select`, `insert`, `update` and `delete`, and has no `execute` and no `_` (T1).
  `insert`, `update` and `delete` accept only sales tables by type, so even a foreign table object obtained some
  other way can't be written through it. At run time it is the same transaction.
- `insert`, `update`, `delete` and `select().from(table)` all need the table object, and only the owner can import
  it (D7). D7 sees type-only imports too: `import type { SalesTx } from '@radcore/db/sales'` in lib-crm fails it.
  So a library can't read or write another module's tables directly.
- No way around it. Each route below is closed by a named rule:
  - SQL text: no `sql` template or `sql.*` call anywhere outside the SQL zone, including the `sql` that Drizzle
    passes into relational `where` and `orderBy` callbacks, and no `.execute` (ADR-002 L1 to L3).
  - Self-declared tables: no `pgTable`, `pgView`, `pgSchema` or `pgMaterializedView` outside packages/db's table
    and view files, so a library can't declare its own handle on another module's table (ADR-002 L9).
  - Casts and reflection: no `any`, double cast, unsafe member access, `Reflect` or `getTableConfig` in libraries
    (E4).

**Reads across modules.** A library reads other modules' data in two ways only:

- as rows related to its own records, through a relational query on its own tables
  (`salesTx(ctx).query.invoices.findMany({ with: { party: { columns: { name: true } } } })`);
- from a named view in `@radcore/db/views`.

**Record scope: what is enforced, and what is reviewed.** It is enforced that a library can't list another
module's table at all. It isn't machine-checked that related rows and view rows show only what the person may see.
That is the rule below, reviewed by the auditor and tested in M1-17:

- Related rows appear only next to the reading library's own records, and those are scope-checked.
- Rows from a view are filtered by the service with `ctx.can` before they are returned.
- To list another module's records for a person, call that module's service.
- Masking is structural either way: `pii()` fields are masked on the declared output (§6).

### 6. Routes declared as data, one generic handler

A route contract is data: method, path, auth kind, permission, input schema and output schema. It lives in the
module's `contract.ts`, so the API, the web client and the permission manifest test (M1-19) all read the same
declaration.

```ts
// packages/lib-sales/src/contract.ts  (browser-safe)
export const createOrder = defineContract({
  method: 'POST', path: '/sales/orders', auth: 'session', perm: 'sales:write',
  input: CreateOrderInput, output: SalesOrder,
});

// apps/api/src/routes/sales.ts  (declarations only: no function bodies)
import { createOrder, listOrders } from '@radcore/lib-sales/contract';
import * as sales from '@radcore/lib-sales';
export default [
  defineRoute(createOrder, sales.createOrder),
  defineRoute(listOrders, sales.listOrders),
];
```

`defineRoute(contract, service)` is the ticket's `defineRoute({ perm, input, handler })`: `perm` and `input` come
from the contract, and `handler` is the service function itself. The compiler checks that the service's input and
output match the contract. `auth` is `session`, `public` (with a named rate-limit class), `link` (a public link's
one action, §6a) or `webhook` (signature checked by the webhook intake).

The one generic handler (`apps/api/src/http/`, M1-08) runs every `session`, `public` and `link` route in the same
order:

```
request ─► origin and rate guards ─► principal (§6a: session, or a link token) ─► parse input (contract.input)
        ─► route permission (contract.perm) for that principal
        ─► new-password check, only on a field marked newPassword() (§7a): length, the bundled list,
           Pwned Passwords. It runs outside any transaction, with no pooled connection held
        ─► the route's `before` step, if it has one (§8): outside any transaction, with `deps` (`secrets`, and `read`
           for a short read-only transaction of its own)
        ─► one transaction with statement, lock and idle timeouts; Ctx built
        ─► saved-once claim (writes only): insert (principal, route, key, input hash) under a unique constraint
        ─► service(ctx, input, { before }) ─► record-scope checks inside the service: ctx.can(...)
        ─► output checked against contract.output, camelCase as is, pii() fields masked for this principal
        ─► saved-once: store the masked answer on the claimed row ─► commit
        ─► errors mapped by code, never by message text
```

**Saved-once (M1-09).** The claim and the stored answer are in the same transaction as the work.
- A second request with the same key waits on the unique index until the first ends. If the first committed, the
  second replays the stored answer. If it rolled back, the second runs.
- The same key with a different body is refused. The key is scoped to the principal and the route, so one person's
  key can't replay another's answer.
- A crash after commit can't lose the answer, because it was committed with the work.

**Masking** happens on the declared output, not in each service. A phone number that reaches a response through a
relation is masked like one read directly (M1-22). Exports use the same output path (§8b).

**Webhook routes** (`auth: 'webhook'`) take their own lane, because a signature is over the raw bytes:

```
request ─► rate guard ─► raw body kept, not parsed ─► no verifier registered for this route? refuse 401, store nothing
        ─► verify the signature over the raw body ─► bad: refuse 401, store nothing
        ─► one transaction: insert the delivery under unique (provider, delivery id) ─► already there: answer 200, queue nothing
        ─► queue the job in the same transaction ─► commit ─► 200
```

The delivery id is the provider's own (for example Shopify's `X-Shopify-Webhook-Id`), extracted by the
lib-integrations adapter. Where a provider sends none, the id is a hash of the raw body. Retries and replays are
stored once and acted on once (M1-27).

### 6a. Who a request runs as

`ctx.can` always checks a named principal. There are four kinds:

| Principal | Comes from | Permission checked | Record scope |
|---|---|---|---|
| user | a session | the user's roles at that moment | the role's scope (M1-17) |
| link | a public link token, on an `auth: 'link'` route | only the one action on the one record the token names | that record (M1-23) |
| job for a user | `ctx.jobs.send` during a user's request | the enqueuer's roles, **rechecked when the job runs**; a revoked permission fails the job and raises the dead-letter alert | the enqueuer's scope (M1-26) |
| system | a schedule or a webhook | only the permissions listed in the job contract, for example `principal: system('online-orders', ['sales:write', 'parties:write'])` | every record, for the listed permissions only |

**Public links** (M1-23, RAD-41). A link route declares `auth: 'link'` and its one `action`. The handler resolves
the token, which travels in the URL fragment then a POST body, and is stored only as a hash. It strips the token from
the input and runs the request as the link principal. An unknown, expired, revoked, used-up or wrong-action token gets
the same 404 `not_found`. A link expires within `platform.public_link_max_days` (30) and can be revoked. Answers carry
`noindex` and `no-store`.

There is no principal that passes every check. Audit rows record the principal: a user id, `system:<name>` or a
link id.

The feature permission is checked once, at the entry: the route contract's `perm`, or the job contract's
principal. Inside, services check record scope with `ctx.can`. A service called by another service runs under the
same principal. The scope rules are keyed by the kind of data, so payroll reading employees asks "may this principal
see this employee's pay", not "does this principal hold hr:read". M1-17 defines the scope rules. A role grants each
key at `own` or `all` scope (RAD-35). A list whose key the principal holds only at `own` is filtered to the principal's
own records by the list engine, and get-one and writes check with `ctx.see` or `ctx.can`. Admin holds every key as an
explicit grant, never a wildcard, and a test checks that it holds the whole catalogue. `users.role_since` and each
grant's `created_at` say when a person gained a key, which the approval rules use (§8b).

**The permission manifest (RAD-37, M1-19, RC-153).** `tools/permission-manifest.ts` states, by hand, the key each
route checks (or `public`) and the principal each job runs as. Its test builds the api's and worker's real lists
(`apiRoutes`, `workerJobs`, the same ones the processes mount), never reading the table from them. It fails on a
route or job with no line, a line for one that's gone, or a check that differs, so deleting or lowering a check fails
CI. Every key named must be in the matrix's catalogue (`permissions.ts`). A change to a route's check changes its line
in the same review. Which services each route and job reaches isn't listed yet.

**How the scope rule reads (RAD-35).** A record's owner is named as audit rows name a principal (`user:<id>`): usually
its `created_by`, or a module's own owner column. `ctx.can(perm, { owner })` answers it; `ctx.see(perm, { owner })`
throws `not_found` out of scope, so it answers 404 like a record that doesn't exist; a list adds
`listScope(ctx, perm, ownerColumn)` to its filter. A system principal reaches every record for the keys its contract
lists. A person's role and grants are read from the database on every request and every job (`loadPrincipal`), never
cached, so a change applies at once in every process (RC-095).

**A forgotten scope fails lint (RAD-85, E7).** The catalogue names, for each key, the tables that hold its records
(`records`). Any key may be granted at `own`, so a module service (`src/services/**`) that reads one of those tables
must apply the scope in the same function: `ctx.see`, `ctx.can` or `listScope`. This is a backstop to the list engine's
filter and each module's own-scope tests. It can't follow a read or a check into another function, a table passed
around as a value, or whether the check names the right owner.

**Nobody gives themselves more power (RAD-36, M1-18, RC-033).** The matrix and a person's role are changed only
under these rules, each refused by name:
- Only an admin gives or takes away the admin role, and nobody gives or takes away a role whose keys they don't all
  hold, since that would pass on or remove keys they lack (`role_not_grantable`; `grantable` on the roles list says
  the same). Nobody changes their own role (`own_account`), and the last active admin stays one (`last_admin`). Two admins demoting each other at once take
  turns, and the second is refused, because it's no longer an admin.
- The admin role's grants aren't edited, since it holds every key, and nor are the caller's own role's
  (`role_not_editable`).
- A key must be in lib-platform's catalogue (`permissions.ts`; `unknown_permission`). Nobody grants a key they don't
  hold, or takes one away (`permission_not_held`). No role loses the signed-in basics, `session:read` today (`basics_required`). A key
  kept for named roles goes to no other: `pay:read` stays with admin and owner (D-20, `permission_not_for_role`).
- The matrix's `version` is the SHA-256 of every grant, so a change made from a stale copy is refused
  (`matrix_changed`). A key a role keeps keeps its scope; a key it gains reaches every record.
- A role change ends that person's sessions (`role_changed`), so the new role's keys and second-factor rule apply
  from their next sign-in.

**Roles are data** (RAD-83, decided 14 Nov).
- **Built-in roles.** The plan's 11 roles ship as built-in templates. Each can be edited, and reset to its template
  (the grants shipped with it).
- **Custom roles** can be created, copied, renamed and deleted. A role someone holds can't be deleted.
- **Who changes them.** Changing a role's grants needs `roles:write`, and changing someone's role needs `users:write`.
  Admin and owner hold both, and both are bound by the rules below: nobody gives a key they don't hold.
- **Keys that need the second factor.** The permission catalogue marks the keys that move money or reach payroll, HR
  or user administration. A role holding any of them requires the second factor, whatever its own setting (D-19).
- **Screens follow permissions.** The web shows what the person's keys allow, with no separate view setting.

### 7. The web client

`apps/web` builds its client from the same contracts: one client per module, for example
`salesApi = createClient(salesContracts)`, which gives typed functions such as `salesApi.createOrder(input)`. A
screen imports only its own module's client, so its bundle carries only that module's schemas. The types come
from the contracts at compile time, so there is no code generation step to forget to rerun. Forms validate with
the same zod schemas the API uses.

### 7a. What crosses the wire

These rules are the contract between `apps/web` and `apps/api`. The shared schemas live in lib-common, including
the error and list envelopes. The platform contracts live in lib-platform's `./contract`.

**Wire format.**
- JSON with camelCase keys (ADR-005 §10).
- Money, quantities and rates are decimal strings (`"1250.50"`), checked by lib-common's base schemas. They are
  never JavaScript numbers.
- Dates are `"YYYY-MM-DD"`. Moments are ISO 8601 in UTC (`"2026-11-06T08:30:00Z"`). Ids are UUID strings.
- A status or kind is its string code.
- An optional field is left out; a field that can be empty is sent as `null`.
- Contract schemas describe the wire exactly: no `.transform()` in a contract. One schema therefore validates the
  same JSON on both sides, and the client's types are plain JSON types. Services turn strings into decimals and
  dates.
- **The client keeps them as strings.** `apps/web` never turns a money, quantity, rate or date string into a
  JavaScript number or `Date`.
  - It shows them with lib-common's formatters (lakh and crore grouping, `DD-MM-YYYY`, India time for moments).
  - Any arithmetic in the browser, such as a form's running total, uses lib-common's decimal helpers on the
    strings.
  - What it sends back is a string again.

**Errors.** Every failure has one shape, lib-common's error envelope:
`{ code, message, issues: [{ path, code, message }], requestId, retryAfterSeconds? }`.
- `message` is a sentence a person can act on.
- `issues` lists each problem with one input. `path` is the list of keys to the field, as zod reports it, so a
  form can put the message beside the field. `code` is the issue's own code. `issues` is empty when the failure
  isn't about one field.
- `code` comes from a closed list: lib-common's platform codes, plus the codes each contract declares in its
  `errors` list. The client switches on the code, never on the message.
- The status codes are fixed:

  | Status | Code | When |
  |---|---|---|
  | 400 | `invalid_input` | the request fails the schema (with `issues`) |
  | 400 | `idempotency_key_required` | a write was sent without its key |
  | 401 | `signed_out` | no session, or it has ended |
  | 403 | `forbidden` | the principal lacks the route's permission |
  | 404 | `not_found` | the record doesn't exist, **or it is outside the principal's scope**. Both get the same answer, so a person can't learn that a record they may not see exists (M1-17) |
  | 409 | `conflict`, `idempotency_mismatch`, `answer_not_kept` | a version clash; a key reused with another body; a key repeated on a route that keeps no answer (§7a) |
  | 422 | the contract's own codes, such as `credit_limit_exceeded` | a business rule refused it |
  | 429 | `rate_limited`, `account_locked` | too many requests from one client IP, or too many failed sign-ins for one email address (M1-14) |
  | 500 | `server_error` | the message is generic and the detail is in the log under `requestId` |

- **Waiting before a retry** (RAD-61). `rate_limited` and `account_locked`, and only they, carry
  `retryAfterSeconds`: whole seconds until a retry can succeed, rounded up. The response also sets the HTTP
  `Retry-After` header to the same number, so the screen and any HTTP client read one value.
- **Two counters** (RAD-64, M1-14's "per account and per address"):
  - `account_locked` counts failed sign-ins per **email address typed**;
  - `rate_limited` counts requests per **client IP**, the address `api` takes from `proxy` through `TRUST_PROXY`
    (ADR-004 §3).

  Both live in the shared store (ADR-003, rate-limiter-flexible), which keeps each email or address only as its
  HMAC under `RATE_LIMIT_KEY` (RAD-73, ADR-004 §5), never as it was typed.
- **Nothing tells anyone an account exists:**
  - Failed attempts are counted for the email address typed, whether or not an account has it, so an unknown
    address locks the same way.
  - Timing gives nothing away either. An unknown address is checked against a fixed dummy Argon2id hash, made
    once at start-up with the current parameters, so it takes as long as a wrong password and gets the same
    answer (RAD-64).
  - A password-reset request gets the same answer, in the same time, whatever address is typed (RAD-68, M1-14).
    It always just queues the reset, through the outbox (ADR-002 §4). The worker looks the address up and sends
    the email only if an account has it, at most once per address in a short window, so the form can't flood
    anyone's inbox. The request counts against the per-IP `rate_limited` limit. A reset job is deleted as soon as
    it completes, with no archive, so no list of typed addresses is kept.
- **The lockout trade-off** (RAD-64). Anyone who knows a person's email address can lock them out by failing to
  sign in as them. These limit it (M1-14 sets the numbers):
  - a lock is short and ends on its own, with `retryAfterSeconds` saying when;
  - the per-IP limit slows one source trying many addresses;
  - a password reset from the email link still works while the account is locked, and clears the lock;
  - an admin can lift a lock, and lifting it is an audited admin action.

  A permanent lock would make that attack worse, so there is none.

**Passwords** (M1-14, RAD-32). A new password, set from an invite, a reset or a change, must pass these rules on
the server. The form shows the same rules but decides nothing.
- **At least 15 characters** (`PASSWORD_MIN_LENGTH` in lib-common). Length counts Unicode code points after NFC
  normalisation, and the NFC form is what gets hashed; sign-in normalises the same way.
  - The only upper bound is the schema's cap, `PASSWORD_MAX_LENGTH` = 1024 UTF-16 units, which zod counts. It
    applies to every password field, sign-in included, so a password that could be set can always be typed at
    sign-in. 1024 units is at least 512 code points, well above NIST's 64.
  - D-19 adds the second factor for admin, owner, accounts and HR. Every other role signs in with the password
    alone, and NIST SP 800-63B-4 requires 15 for a password used alone.
  - The four roles with a second factor get the same minimum. One rule is simpler, and the accounts that move money
    and run payroll are no place to relax it.
- **No composition rules and no forced expiry.** Spaces and pasting are allowed, so a passphrase works.
- **Not a common or breached password** (ADR-003 §3). Two checks, in this order:
  - **Always: the bundled list.** The whole password, lower-cased, is compared with a list of common passwords
    shipped with the app. This list is NIST's required blocklist, so the rule holds even with no network.
  - **Then: Pwned Passwords** (ADR-004). The server hashes the password with SHA-1 and sends only the first five
    hex characters to the range API, through the outbound client (ADR-002 L8), with `Add-Padding: true` and a
    3-second timeout. It refuses the password if the rest of the hash is in the answer. The password itself never
    leaves the server.
  - **If Pwned Passwords can't answer**, the password stands on the bundled list alone. The server logs
    `breached_check_skipped` and raises an alert, at most one an hour (RAD-44's alerts). Refusing every password
    instead would block invites and resets for the length of the outage, and a reset is how a locked-out person
    gets back in.
- **Not the current password**, on a change or a reset.
- **Checked before the transaction** (§8). A contract marks its new-password field with lib-common's
  `newPassword()`: invite accept, reset and change. The generic handler checks such a field after the route
  permission and before it opens the transaction and claims the saved-once key. It checks the length, the bundled
  list and Pwned Passwords.
  - A refusal answers at once, with no transaction opened. The 3-second call never holds a transaction or a pooled
    connection.
  - A request that passes goes on as usual. A retried key repeats the check, which is harmless, and then replays
    or runs as saved-once says.
  - The service checks only `same_as_old`, because it needs the stored hash.
  - lib-platform's contract test fails on a `newPassword()` field outside those three routes.
- A refusal is `password_rejected`, with the reason on the password field: `too_short`, `breached` or
  `same_as_old`, never `invalid_input`. The schema's `.min()` would count UTF-16 units, so `newPassword()` sets
  only the 1024 cap and leaves the length rule to the check.
- Sign-in checks only the stored hash, never these rules, so a rule change never locks anyone out.

**Your own account** (RAD-32). The routes that act only on the caller's own session and password (`/me`, sign-out,
password change, the person's sessions) use one key, `session:read`, which every role holds. Ending the current
session from the sessions list is refused with `current_session`: sign-out does that, because it clears the cookie.

**Sessions** (M1-16, RAD-34). A session is a random token in the `__Host-radcore_session` cookie; only its SHA-256 is
stored.
- **Over plain http (development and CI only), the cookie is `radcore_session` and not Secure.** WebKit stores a
  Secure cookie from `http://127.0.0.1` but never sends it back, so Safari couldn't stay signed in. Deployed origins
  are https, which config enforces.
- It signs nobody in after **30 minutes without a request or 12 hours after sign-in**, whichever comes first
  (Sarthak, 11 Nov 2026), or once it's ended. A request moves the idle expiry on, never past the 12 hours. `GET /me`
  doesn't count, since the shell reads it every minute.
- It ends on sign-out; when the person ends it from their sessions list; when an admin ends it; on a password change
  (the person's other sessions) or reset (all of them); and on a role change or deactivation (RAD-35, RAD-36).
- A sign-in ends the session the browser's cookie already names, so none lingers on a shared computer.
- A request whose cookie names an ended or expired session gets 401 `signed_out`, and the cookie is cleared with it,
  sign-out's included.
- A sign-in is a `sign_in` security event, and each session that ends is a `session_ended` event with the reason.
  Every refused sign-in is a `sign_in_failed` row, a locked address's included, whether or not an account has the
  address: recording only some would make a known address do different work, and timing would tell (RAD-64). The
  per-IP limit (RAD-39) bounds the rows one source can add (ADR-005 §7c).
- **Only the sign-in routes touch the cookies.** The handler gives `ctx.cookie` to the key-exempt routes and to the
  second-factor enrolment start (which stores no answer), and sets or clears each cookie only after the transaction
  commits, so a rolled-back sign-in sets nothing.
- **A failed sign-in is still recorded.** Its service throws `RecordedRefusal`. On a key-exempt route the handler
  commits that transaction, which holds the `sign_in_failed` event, and still answers with the refusal. Elsewhere it
  rolls back like any error.

**The second factor** (M1-15, RAD-33, D-19). A TOTP authenticator (ADR-003's settings) and ten single-use recovery
codes.
- **Step 1 starts no session for someone with a factor, or whose role needs one.** It answers `second_factor` or
  `enrol_second_factor` and sets the pending-sign-in cookie, `__Host-radcore_pending` (plain `radcore_pending` over
  http, as above). The pending sign-in is a random token, stored as its SHA-256. It lasts five minutes and is spent
  when the sign-in finishes. A missing, spent or expired one answers `sign_in_expired`.
- **The verify step** takes a TOTP code or a recovery code (any case, dashes optional), then starts the session and
  clears the pending cookie. A TOTP code is refused if its step isn't later than the last one accepted, so it works
  once. A refusal is `sign_in_failed` (`second_factor` or `account_locked`), recorded through `RecordedRefusal`.
- **Enrolling during sign-in.** Start answers the otpauth URI for a new 20-byte secret, replacing an unconfirmed one.
  Confirm takes its first code, then confirms the factor, signs the person in and answers the ten recovery codes,
  which are shown once.
- **Signed in,** `POST /me/second-factor/recovery-codes` takes a current code, voids the old set and answers a new
  one (`storesAnswer: false`).
- **An admin** removes someone else's factor and codes after a lost phone
  (`POST /admin/users/:id/second-factor/remove`), and ends their sessions; it's a `second_factor_changed` event. They
  enrol again at their next sign-in if their role needs it.
- **Attempts:** five per account in 15 minutes, then a 15-minute wait. They're counted in the shared store, like the
  sign-in lockout.
- **Who needs a factor** is the role's `second_factor_required` (RAD-35): D-19's admin, owner, accounts and HR.
- The secret is kept by the secrets library. Each route seals or opens it in its `before` step (§8), so no KMS call
  runs inside a transaction.

**Saved-once key.** Every write contract (`tx.readOnly: false`, ADR-002 §4) requires an `Idempotency-Key` header:
- It is a UUID made by `apps/web` once per submit. The client keeps it across retries of that submit and makes a
  new one only after a success (Design notes A-0).
- A write without it is refused with `idempotency_key_required`, so the protection fails closed (RC-132).
- The server scopes the key as §6 says.
- **Four routes are exempt** (RAD-61, RAD-32): sign-in, sign-out, the second-factor verify step, and confirming a
  second-factor enrolment during sign-in (M1-14, M1-15, M1-16). Their answer sets or clears the session cookie,
  and a stored answer replayed for a repeated key can't do that.
  - Each declares `idempotency: 'exempt'` on its route. It's exempt from the key only: the write-Origin check
    (M1-21) and the rate limits still apply.
  - The generic handler accepts the declaration only from those four routes, a fixed list in lib-platform, and
    refuses to start otherwise. lib-platform's contract test fails on any other route that declares it.
  - Repeating one is harmless. A second sign-in starts another session, listed under the person's sessions; a
    second sign-out finds no session; a TOTP code already used is refused (ADR-003); a second enrolment confirm
    finds no pending enrolment and is refused.
  - **A recovery code goes through the verify step** (RAD-64, M1-15). The verify step takes either a TOTP code or
    a recovery code. A recovery code is just another kind of second factor, so one route finishes the second step
    and sets the cookie, and the exempt list doesn't grow for it. A recovery code is used once: the second use is
    refused like a reused TOTP code.
  - **Confirming an enrolment finishes signing in** (RAD-32, M1-15). It proves the password (step 1) and the new
    factor (its first code), which is what the verify step proves. Without it, the person would wait up to 30
    seconds for a fresh code, because the one they just used is spent. If its answer is lost, the person signs in
    again and makes new recovery codes from their account (M1-15).
- **Answers that hold a secret aren't stored** (RAD-32). A route whose answer holds a secret declares
  `storesAnswer: false`:
  - starting a second-factor enrolment (the new TOTP secret);
  - making new recovery codes;
  - asking for a file's download link, `POST /files/<kind>/:id/download` for photo, resume, statement and import
    (RAD-43), or an export's, `POST /exports/:id/download` (RAD-47). The answer is a live presigned link, and a
    stored answer must carry no tokens (RC-132).

  How it works:
  - Saved-once still claims the key, so a repeat can't run the work twice. It stores no answer, though, so the
    secret is never at rest in the saved-once table.
  - A repeated key after a commit gets 409 `answer_not_kept`, and the client starts again with a new key.
  - The generic handler accepts the flag only from those routes, a fixed list in lib-platform
    (`ANSWER_NOT_STORED_ROUTES`), and lib-platform's contract test fails on any other route that declares it.
  - Confirming an enrolment returns the recovery codes too, but it is exempt, so it stores nothing anyway.

**Links that carry a token** (RAD-61). Invite and password-reset links carry their token in the URL fragment
(`/invite#token=…`), never in the path or the query string. Browsers don't send a fragment to the server or in
`Referer`, so the token stays out of Caddy's and pino-http's logs (ADR-004 §3).
- The page reads the token, removes it from the address bar (`history.replaceState`), and sends it in the body of
  a POST, which is an ordinary write with its saved-once key.
- The API never accepts these tokens from a path or query parameter.
- **Accepting an invite or resetting a password doesn't start a session** (RAD-64, M1-14). Afterwards the person
  signs in, and passes the second factor if their role needs it (D-19), so a link from an email can never stand
  in for the second factor. A password reset also ends the person's other sessions (M1-16).

**Lists.** Every list contract returns lib-common's list envelope, `{ items, next }`:
- `next` is an opaque cursor, or `null` on the last page.
- `limit` is capped at 200 (ADR-002 §4).
- There is no total count. A screen that needs counts, such as count cards, calls a count contract of its own, so a
  list never adds up a whole ledger (RC-176).

**Masked fields.** A `pii()` field sent to a principal without `pii:read` arrives masked (`"••••••3210"`) and
marked as masked in the output type.
- Salaries and bank details carry the stricter `pii('pay')`. It needs `pay:read`, which only admin and owner hold
  (D-20, Sarthak, 6 Nov 2026), so a role with `pii:read` still gets them masked (M1-22).
- Edit forms show it read-only and never send it back. Edit contracts change only the fields they receive (patch
  semantics), so a field left out is left alone.
- The server also refuses an input value shaped like a mask, with `invalid_input`. A masked value can never be
  saved over the real one.

**Same origin, no CORS.**
- Caddy serves `web` at `/` and `api` at `/api` on one origin (ADR-004).
- The API sends no `Access-Control-Allow-*` headers, so no other site can read its answers.
- The session cookie is `HttpOnly`, `Secure` and `SameSite=Lax`, and every write must carry a matching `Origin`
  header (M1-21).
- The one cross-origin call is the browser's presigned upload to S3, a **POST** (so the bucket enforces the size
  limit; ADR-004 §2). The bucket's CORS rule allows `POST` from `PUBLIC_ORIGIN` only.

### 8. The worker

`apps/worker` is its own process (M1-26). Jobs are declared like routes:
`defineJob(jobContract, service)` in `apps/worker/src/jobs/`. Job contracts live in the owning library's `.` entry
(server-only). A service queues a job with `ctx.jobs.send(contract, input)` inside its own transaction, so a save
that rolls back queues nothing. `send` writes an outbox row on lib-platform's `jobs_outbox` table with the query
builder (no SQL). The worker's relay hands committed rows to the queue library and deletes them (ADR-002 §4). M1-26
proves that a rolled-back save queues nothing; ADR-003 names the queue library. The API process runs no jobs.

**No network call inside a transaction.** A service that needs an outside call, such as an e-invoice IRN or a
WhatsApp send, queues a job. The job makes the call (with the provider's idempotency key where the provider has
one) and records the result in its own transaction. A rolled-back invoice therefore never leaves an IRN behind,
and a slow provider never holds a transaction open past the idle timeout. The one outside call a request makes
itself, the breached-password check, runs in the generic handler before the transaction opens (§6, §7a).

**Files through `ctx`** (RAD-43, M1-25). `ctx.files` gives a service the file store's two presigning calls,
`presignUpload` and `downloadUrl`, and nothing else.
- **Presigning is safe inside the transaction.** It signs locally with the store's credentials and sends nothing,
  and the store loads its credentials when the process starts.
- **The two calls that reach S3 run outside any transaction:** `verifyUpload` (the HEAD and the first 1 KB) and
  `putFile`.
  - Confirming an upload records the file as `checking` and queues a job. The job verifies the file in its
    `before` step (below), then records `ready` or `refused` in its own transaction.
  - An export uploads its file after its commit (ADR-002, Exports).
  - Only a file that is `ready` can be downloaded.
- **Ctx's members** are then `tx`, `principal`, `requestId`, `settings`, `jobs` and `files`. `ctx.files` is frozen
  like `ctx.jobs`, and the Ctx test in `tools/module-tx.test.ts` pins the list.
- **Each process builds its store once,** from `config.s3`, in the `api` and `worker` mains, and hands it to
  `runInTransaction`. There's no process-wide registry, so a test passes its own store.

**A job's outside call goes in its `before` step** (RAD-43). `defineJob(contract, service, { before, afterCommit })`
takes two optional steps; `before(input, deps)` is the first.
- **When it runs.** The worker calls it outside any transaction, after rechecking the job's principal (§6a), so a
  revoked permission stops the job before anything leaves the process.
- **Its result.** The service gets the result as `meta.before` and records it in the job's own transaction. A
  retry runs `before` again, so a call with side effects there carries the provider's idempotency key.
- **What it can reach.** `deps` holds the worker's clients for outside calls: `files` (the whole store) today, and
  the outbound client when the first provider job needs it.
- **No other route.** The `before` and `afterCommit` steps are the only ways a job reaches the network. `before`'s
  first user is the upload check.

**A route's outside call goes in its `before` step too** (RAD-33). `defineRoute(contract, service, { before })` runs
`before(input, deps)` after the route permission, outside any transaction, and hands its result to the service as
`meta.before`. `deps` holds `secrets` and `read(work)`, a short read-only transaction that closes before `before` goes
on, so a KMS call never runs inside one. It also holds the request's principal and, on the sign-in routes, its
cookies, so `before` knows whose row to read. The service checks that what `before` read is unchanged (`conflict` if
not). The second-factor routes, its first users, compare the factor's ciphertext rather than `updated_at`, because
each accepted code moves `last_step`, and with it `updated_at`, while the ciphertext is exactly what was opened. The
new-password check (§7a) is the same idea, built into the handler.

**A call that needs what the transaction decided goes in its `afterCommit` step** (RAD-32). `afterCommit(result,
again)` runs after the service's transaction commits, with the service's result; `again` opens one more transaction,
as the same principal, to record the outcome. The outcome is recorded through `again` only after the call has
succeeded; the service never records it as done ("sent"), since the call may still fail. A retry runs the service
again, so the service makes the step safe to repeat: the password-reset email, its first user, dedupes on its job id,
and a link minted but never mailed is spent and replaced.

**A job's transaction.** A job runs in a `read committed` write transaction, unless its contract gives `tx` (an
export: `{ readOnly: true, isolation: 'repeatable read', statementTimeoutMs }`, ADR-002 Exports). A job for a user
names its permission as `perm`. That is a key, or a pure function from the input to a key (the export job looks it up
by kind), with no I/O. `afterCommit` gets the same `deps` as `before`.

### 8b. Platform engines, module functions

lib-platform's lists, exports, imports and approvals are engines that know no module, and lib-platform can't call
up into module libraries. So each module supplies the function that does its part, and the route or job file wires
the two together:

```ts
...defineExport(sales.salesExports),                                        // engine: paging, streaming, file format
defineImport(stock.contracts.importItems, stock.importItemRow),          // engine: parsing, limits, per-row errors
...defineApproval(purchasing.contracts.poApproval, purchasing.poApproval), // engine: maker-checker record and hash
```

The module function runs under `ctx` like any service. Scope, rules and `pii()` masking apply to an export exactly
as they do on a screen (M1-22, M1-28, M1-29, M1-20).

**Approvals (maker-checker, M1-20, RAD-38).** A module's `contract.ts` declares
`approvalContracts('purchase-order', 'purchasing:approve')`. That gives three contracts under one static
permission: the pending list, one request with its version hash, and the decision. The route file spreads
`...defineApproval(contracts, spec)`, where `spec` is the module's part: the version the approver sees, and what
approving and rejecting do. A decision is made in one transaction, with the record's row locked, and is refused
unless:
- **a user decides,** who holds the permission;
- **the decider made no change to what is being approved** (`own_request`): they're not the requester, and made no
  change to the record or its parts since its last approval (or since it was made). The engine reads the makers from
  the audit log: each part table is attached with `owner =>` its record's key and `owner_table =>` its record's table,
  so its audit rows carry the record's id (`owner_id`). "Since" is by the log's write order (`seq`), so a save that
  began before the approval but wrote after it still counts. Jobs aren't makers. Writes made by a decision itself (a
  send-back's status and reason) don't make the decider a maker. A spec's `approved` and `rejected` change only the
  record's status and decision fields, never what is approved;
- **the approver's account was created before the request** (`approver_too_new`), so a requester can't invite a
  fresh account to approve it;
- **the version is the one the approver saw** (`version_changed`). It's a SHA-256 over sorted-key JSON of what the
  approver is shown, taken when the request is made and checked again at the decision;
- **the request is still pending,** and a conditional status update means two approvers can't both win.

Every write to a part locks its record's row first (a trigger from `audit_attach`'s `owner`), so a save and a
decision on one record never overlap.

**Known limit:** an account invited before the request, possibly by the requester, can still approve. "The approver
wasn't invited by the requester" isn't a rule, because the admin invites nearly everyone, so the admin's own
requests could never be approved. Three things bound the limit:
- only admin and owner grant roles, and only keys they hold (RAD-36, RAD-83);
- every grant is in the audit trail;
- once role grants carry their time (RAD-35), the approver's approving role must also predate the request.

### 8a. Inbound work from outside services

lib-integrations only speaks to outside services. It holds their clients, payload parsers and signature checks,
and it never imports a module library. Inbound work (a Shopify order becoming a sales order, a WhatsApp message
becoming a lead) lives in **the module that owns the result**. It always takes the same path:

```
outside service ─► apps/api webhook route ─► lib-platform webhook intake: check the signature (the provider's
check from lib-integrations, passed in by the route), store the raw delivery once, answer 200 quickly, queue a job
─► apps/worker job ─► owning library's service: parse the payload with lib-integrations, then act
(retries, replay protection and the stuck-event alarm belong to the intake, M1-27)
```

Example: a Shopify order.

```ts
// apps/api/src/routes/hooks.ts  (declarations only)
import { shopify, whatsapp } from '@radcore/lib-integrations';
import * as sales from '@radcore/lib-sales';
import * as crm from '@radcore/lib-crm';
export default [
  defineWebhook(shopify.orderCreated, shopify.verifySignature, sales.jobs.takeShopifyOrder),
  defineWebhook(whatsapp.message, whatsapp.verifySignature, crm.jobs.captureWhatsappMessage),
];

// apps/worker/src/jobs/sales.ts
export default [defineJob(sales.jobs.takeShopifyOrder, sales.takeShopifyOrder)];

// packages/lib-sales/src/services/online-orders.ts
export async function takeShopifyOrder(ctx: Ctx, delivery: WebhookDelivery): Promise<SalesOrder> {
  const order = shopify.parseOrder(delivery.payload); // lib-integrations: Shopify's shape, checked
  // ...match items by SKU and the customer by phone, then create a confirmed order (lib-sales' own rules)
}
```

lib-platform can't import lib-integrations, which ranks above it. So the route hands the provider's signature
check to the intake as data. Outbound calls go the other way, as normal downward imports. For example, lib-crm's
send-message service calls `whatsapp.send()` from lib-integrations.

### 9. File size

No source file (`.ts`, `.tsx`, `.js`, `.mjs`) under `apps/` or `packages/` is over 400 lines, tests included.
Generated files (Drizzle's migration metadata) are excluded. SQL migrations and views keep one change or one view
per file.

## Enforcement (for M0-07 to add, M0-08 to run in CI)

**dependency-cruiser** handles the import graph, because it sees resolved imports across workspaces and has a
built-in cycle rule. The version goes in ADR-003. **ESLint** handles what is inside a file. Each rule must fail CI.

**One ESLint rule per E-rule.** Each E-rule here, and each L-rule in ADR-002, is its own rule in a local ESLint
plugin (`radcore/e1-route-files`, `radcore/e3-no-io`, and so on). They are never entries in a shared
`no-restricted-syntax`, `no-restricted-imports` or `no-restricted-globals`. In flat config, a later block's options
for a core rule replace the earlier block's options: E4's selectors would silently wipe L1's in every library. The
config test (ADR-002) calls `calculateConfigForFile` and asserts each local rule's full selector set and its
`error` severity, not the severity alone.

| # | Rule | Tool | Fails when |
|---|---|---|---|
| D1 | `no-circular` | dependency-cruiser | any import cycle, inside or between packages |
| D2 | allowed-dependency table (§4) as `allowed` rules; everything else is `not-in-allowed` | dependency-cruiser | a library imports a library not in its row |
| D3 | no deep import | dependency-cruiser | a file outside `packages/X/` imports a file of X that is not one of X's declared entries: `src/index.ts` and `src/contract.ts` for a library, `src/runtime.ts` for lib-platform, and for packages/db every entry listed in §5: each `./<module>`, plus `./views`, `./schema`, `./request-context` and `./migrate` (group-matched path rule) |
| D4 | web stays in the browser | dependency-cruiser | any file in `apps/web/**` (client and server components, route handlers, middleware) imports `packages/db`, lib-platform's `.` or `./runtime`, or a library's `src/index.ts`; or a file of the app's source imports a Node built-in. `apps/web/next.config.*` and build scripts in `apps/web/scripts/**` are exempt from the Node built-in ban only. Every library's `./contract`, lib-platform's included, is allowed. |
| D5 | contracts are browser-safe | dependency-cruiser | a `contract.ts` (or a file it imports) reaches `packages/db`, lib-platform's `.` or `./runtime` code, `src/services/**` or a Node built-in. lib-platform's own `contract.ts` may import its other browser-safe files. |
| D6 | rules are pure | dependency-cruiser | `src/rules/**` imports `packages/db`, `lib-platform` or `src/services/**` |
| D7 | one owner per table (§5) | dependency-cruiser with `tsPreCompilationDeps: true`, so `import type` counts | anything other than `packages/lib-<m>` (and `packages/db` itself) imports `@radcore/db/<m>`, including a type-only import; anything other than lib-platform imports `@radcore/db/platform`, `/schema`, `/request-context` or `/migrate` |
| T1 | the opaque transaction (§5) | TypeScript (`tsc --noEmit`, the typecheck job) | a library touches `ctx.tx.query`, `.select`, `.insert`, `.update`, `.delete`, `.execute` or `._`; or reaches another module's table through its own module transaction (`salesTx(ctx).query.parties`). Its proof lands with M1-08 (`Ctx` and the generic route handler), not with M0-07 (RAD-13). |
| D8 | apps never touch the database directly | dependency-cruiser | `apps/api/**` or `apps/worker/**` imports `packages/db` |
| D9 | no HTTP in libraries | dependency-cruiser | `packages/**` imports `express`, `next`, or anything under `apps/` |
| E1 | no rule in a route or job file | local rule `radcore/e1-route-files` on `apps/api/src/routes/**` and `apps/worker/src/jobs/**` | the file has a function (arrow, expression or declaration), `if`, `switch`, a loop, `?:`, `&&`/`\|\|`/`??`, or an arithmetic operator; or an argument of a `define*` call is itself a call (so `defineRoute(c, wrap(sales.x))` fails); or the file imports anything except libraries' `.` and `./contract` entries and the `define*` helpers. Route and job files hold only `defineRoute`, `defineWebhook`, `defineJob`, `defineExport`, `defineExportJob`, `defineImport` and `defineApproval` calls. |
| E2 | file size | ESLint `max-lines` (`max: 400`, blank lines and comments counted) | any source file over 400 lines |
| E3 | no I/O without an import | local rule `radcore/e3-no-io` on `packages/lib-common/**`, every `contract.ts` and every `src/rules/**` | use of `process`, `fetch`, `setTimeout`, `setInterval`, `crypto`, `Math.random`, `Date.now()` or `new Date()` with no argument. Time and randomness come in as arguments or from `ctx.clock`. |
| E4 | no escape hatch in libraries | on `packages/lib-*/**` and `packages/db/src/*/repo.ts`, with type information: `@typescript-eslint/no-explicit-any`, `no-unsafe-member-access`, `no-unsafe-call`, `no-unsafe-assignment` (these typed rules aren't shared with any other E- or L-rule); plus local rule `radcore/e4-no-escape`, which bans a double cast (`x as unknown as T`), `as any`, the `Reflect` global and importing `getTableConfig` | a library casts or reflects its way past T1 (`Reflect.get(ctx.tx, '_')`), or reads table metadata |
| E5 | no switching the type checker off | `@typescript-eslint/ban-ts-comment` at `error`, with no description allowance, over `packages/**` and `apps/**` | a `// @ts-ignore`, `// @ts-expect-error`, `// @ts-nocheck` or `// @ts-check` comment (T1 would otherwise be silenced on one line) |
| E6 | no float maths or text comparison on money (M1-01, RC-215) | local rule `radcore/e6-no-float-money` on `apps/**` and `packages/**` | `parseFloat` or `Number.parseFloat` anywhere; or a value named like money, a rate or a quantity (`total`, `grandTotal`, `totalGST`, `unit_price`, `cgst`, `grossSalary`, `creditLimit`, and the other words in `eslint.config.mjs`) appears anywhere inside `Number()`, `Math.*` or a unary `+` or `-`; is an operand, bare or inside `?.`, `!`, `as`, `satisfies` or a spread, of `-`, `*`, `/`, `%`, `**`, a `+` that isn't joining a string, a compound assignment or `++`/`--`; is compared with `<`, `<=`, `>` or `>=`; or is compared with `===`, `!==`, `==` or `!=` to another such value; or such a name is declared with `number` anywhere in its type or a `.number()` schema anywhere in its value. Money is a decimal string on the wire (§7a), so these convert it to a float or compare it as text (`"9.00" > "10.00"`). Use lib-common: `dec(a).plus(b)`, `dec(a).gt(b)`, `dec(a).cmp(b)`, `dec(a).eq(b)` |
| E7 | a scoped read applies the record scope (§6a, RAD-85) | local rule `radcore/e7-scope-on-owned-reads` on `packages/lib-*/src/services/**`, test files out, with the catalogue's `records` tables as its options | a function reads one of those tables (as an argument of `.from` or a join, imported by name, aliased or through a namespace, or as `.query.<table>`) and neither it nor the function around it calls `ctx.see`, `ctx.can` or `listScope` |

**Proof.** Every rule has one violating fixture per clause, kept in `tools/boundary-fixtures/<rule>-<clause>/`, so
D4, D5, D7, E1 and E3 have one fixture for each thing they forbid. D7's fixtures include a type-only import with a
single cast (`(ctx.tx as SalesTx).query.invoices` from lib-crm). E4's include `Reflect.get(ctx.tx, '_')`, and E5's
include `// @ts-expect-error` above a T1 violation.
A CI job runs each check against each fixture on
every run, and fails if any fixture passes. A rule that stops working is caught the day it breaks. The fixtures sit
outside the normal lint and typecheck globs.

## Consequences

- A business rule has one home, and both the API and the worker reach it through the same service function, so RC-175's
  "the worker cannot reuse a service" cannot recur.
- Backend sessions working in parallel touch different `packages/lib-*` folders and route files. Only `apps/api`'s
  route index and this ADR are shared.
- Cross-module reads need a relation or a view, so a few reports need a view where v1 joined in the route.
- The two-entry rule means a module's schemas are written in `contract.ts` or files only it imports, never next
  to the services.
- Changing the dependency table is a reviewed ADR change, not a quiet import.

## Alternatives considered

- **One shared `packages/contracts` for every route** (the second shape). The web app would depend on one package,
  but each module's schemas would sit away from its rules, and every backend session would edit the same package.
  That breaks the rule that two writers never touch the same files. Rejected.
- **Platform pieces inside lib-common.** One fewer package, but lib-common would gain I/O and the browser bundle
  could pull in server code. Rejected; lib-platform holds them.
- **One `packages/core` for all business functions** (the plan's first draft). Superseded by N2's module-wise
  libraries: a single core rebuilds v1's large files.
- **eslint-plugin-boundaries instead of dependency-cruiser.** It works per file and needs every element typed by
  hand. It has no built-in cycle check across packages. dependency-cruiser does both, so it's the pick.
