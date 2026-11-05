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

### 3. Where each master, engine and document lives

| Library | Owns (its tables, its services) |
|---|---|
| lib-platform | users, roles and the permission matrix, sessions, saved-once keys, jobs, files, secrets, settings, numbering series, approvals (maker-checker), public links, webhook deliveries; the audit context the database triggers read |
| lib-integrations | no tables: provider clients and parsers only |
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
| 6 | lib-crm | lib-accounts, lib-integrations |
| 6 | lib-stock | lib-accounts, lib-gst |
| 6 | lib-payroll | lib-hr, lib-accounts |
| 7 | lib-purchasing | lib-stock, lib-accounts, lib-gst |
| 7 | lib-sales | lib-stock, lib-accounts, lib-gst, lib-crm, lib-integrations |
| 8 | lib-service | lib-sales, lib-stock, lib-accounts, lib-purchasing |

| App | May import |
|---|---|
| apps/api | lib-platform and every library's `.` and `./contract` entries; **not** packages/db |
| apps/worker | the same as apps/api |
| apps/web | lib-common and every library's `./contract` entry, **nothing else**: not lib-platform, not packages/db, not a library's `.` entry |

No package under `packages/` imports an HTTP framework (Express, Next) or anything under `apps/`. That is what lets
the worker run any service without loading the web layer, which is RC-175's fix.

Adding an edge to the table means amending this ADR in a PR the architect reviews.

### 5. One owner per table

Each table belongs to exactly one library: its schema file sits in `packages/db/src/<module>/`, the same module
as the library.

- **Writes.** Only `lib-<module>` imports `@radcore/db/<module>`. Insert, update and delete need the table object,
  so no other library can write that module's tables. To change another module's data, call that library's
  service.
- **Reads across modules.** Use Drizzle relational queries from your own tables (`ctx.tx.query.salesOrders.findMany({ with: { party: true } })`),
  or a named view from `@radcore/db/views`. Neither needs the other module's table objects.
- **Record scope follows the record.** A view that another library reads returns totals, or rows the reading
  library may show to anyone who can open its screen. To list another module's records for a person, call that
  module's service, so its `ctx.can` scope check runs (M1-17). Reading another module's rows through a relation
  or view never widens what a person can see.
- `@radcore/db/platform` and the full schema (`@radcore/db/schema`, used to build the typed client) are imported
  only by lib-platform.

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
output match the contract. `auth` is `session`, `public` (with a named rate-limit class) or `webhook` (signature
checked by the webhook intake).

The one generic handler (`apps/api/src/http/`, M1-08) runs every route in the same order:

```
request ─► origin and rate guards ─► session ─► parse input (contract.input)
        ─► route permission (contract.perm) ─► saved-once lookup
        ─► one transaction with statement, lock and idle timeouts; Ctx built
        ─► service(ctx, input) ─► record-scope checks inside the service: ctx.can(perm, row)
        ─► commit ─► saved-once store ─► output checked against contract.output, camelCase as is,
           fields marked pii() masked for a role without pii:read
        ─► errors mapped by code, never by message text
```

Masking happens on the declared output, not in each service. A phone number that reaches a response through a
relation is masked like one read directly (M1-22).

The route-level permission says whether this role may use the feature. The record-scope check happens inside the
service (M1-17), so a job or script calling the same service gets the same check.

### 7. The web client

`apps/web` builds its client from the same contracts: one client per module, for example
`salesApi = createClient(salesContracts)`, which gives typed functions such as `salesApi.createOrder(input)`. A
screen imports only its own module's client, so its bundle carries only that module's schemas. The types come
from the contracts at compile time, so there is no code generation step to forget to rerun. Forms validate with
the same zod schemas the API uses.

### 8. The worker

`apps/worker` is its own process (M1-26). Jobs are declared like routes:
`defineJob(jobContract, service)` in `apps/worker/src/jobs/`. Job contracts live in the owning library's `.` entry
(server-only). A service queues a job with `ctx.jobs.send(contract, input)` inside its own transaction, so a save
that rolls back queues nothing. This means the queue must accept a send on the caller's transaction connection.
M1-26 proves that with a rolled-back save, and ADR-003 names the library. The API process runs no jobs.

### 9. File size

No source file (`.ts`, `.tsx`, `.js`, `.mjs`) under `apps/` or `packages/` is over 400 lines, tests included.
Generated files (Drizzle's migration metadata) are excluded. SQL migrations and views keep one change or one view
per file.

## Enforcement (for M0-07 to add, M0-08 to run in CI)

**dependency-cruiser** handles the import graph, because it sees resolved imports across workspaces and has a
built-in cycle rule. The version goes in ADR-003. **ESLint** handles what is inside a file. Each rule must fail CI.

| # | Rule | Tool | Fails when |
|---|---|---|---|
| D1 | `no-circular` | dependency-cruiser | any import cycle, inside or between packages |
| D2 | allowed-dependency table (§4) as `allowed` rules; everything else is `not-in-allowed` | dependency-cruiser | a library imports a library not in its row |
| D3 | no deep import | dependency-cruiser | a file outside `packages/X/` imports `packages/X/src/**` other than `src/index.ts` or `src/contract.ts` (group-matched path rule) |
| D4 | web stays in the browser | dependency-cruiser | `apps/web/**` imports `packages/db`, `packages/lib-platform`, a library's `src/index.ts`, or a Node built-in |
| D5 | contracts are browser-safe | dependency-cruiser | a `contract.ts` (or a file it imports) reaches `packages/db`, `lib-platform`, `src/services/**` or a Node built-in |
| D6 | rules are pure | dependency-cruiser | `src/rules/**` imports `packages/db`, `lib-platform` or `src/services/**` |
| D7 | one owner per table (§5) | dependency-cruiser | anything other than `packages/lib-<m>` (and `packages/db` itself) imports `packages/db/src/<m>/**`; anything other than lib-platform imports `db/src/platform/**` or the full schema |
| D8 | apps never touch the database directly | dependency-cruiser | `apps/api/**` or `apps/worker/**` imports `packages/db` |
| D9 | no HTTP in libraries | dependency-cruiser | `packages/**` imports `express`, `next`, or anything under `apps/` |
| E1 | no rule in a route or job file | ESLint `no-restricted-syntax` on `apps/api/src/routes/**` and `apps/worker/src/jobs/**` | the file has a function (arrow, expression or declaration), `if`, `switch`, a loop, `?:`, `&&`/`\|\|`/`??`, or an arithmetic operator. Route files hold only `defineRoute(contract, service)` calls. |
| E2 | file size | ESLint `max-lines` (`max: 400`, blank lines and comments counted) | any source file over 400 lines |

Proof for M0-07: one throwaway commit per rule that breaks it, each failing the check with a message that names the
rule. The commits aren't merged.

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
