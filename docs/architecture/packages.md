# RadCore v2: packages and who calls whom

One page. The rules behind it are in [ADR-001](adr/001-layers.md). An arrow means "may import". Every arrow
points down a rank, so there are no cycles.

```mermaid
flowchart TB
  WEB["apps/web<br/>screens, typed client"]
  API["apps/api<br/>routes as data, one generic handler"]
  WORKER["apps/worker<br/>queued and scheduled jobs"]

  subgraph MODS["Module libraries: index.ts for servers, contract.ts for everyone"]
    direction TB
    SERVICE["lib-service"]
    SALES["lib-sales"]
    PURCH["lib-purchasing"]
    CRM["lib-crm"]
    STOCK["lib-stock"]
    PAYROLL["lib-payroll"]
    ACC["lib-accounts"]
    GST["lib-gst"]
    OPS["lib-ops"]
    HR["lib-hr"]
    INT["lib-integrations"]
  end

  PLAT["lib-platform<br/>db client, Ctx, sessions, permissions, saved-once, jobs,<br/>files, secrets, approvals, links, lists, imports, numbering"]
  DB[("packages/db<br/>schema per module, relations, views, migrations")]
  COMMON["lib-common<br/>money, dates, ids, base schemas: no I/O"]

  WEB -.->|contract.ts only| MODS
  WEB --> COMMON
  API --> MODS
  API --> PLAT
  WORKER --> MODS
  WORKER --> PLAT

  SERVICE --> SALES & PURCH & STOCK & ACC
  SALES --> CRM & STOCK & ACC & GST & INT
  PURCH --> STOCK & ACC & GST
  CRM --> ACC & INT
  STOCK --> ACC & GST
  PAYROLL --> HR & ACC
  ACC --> GST & INT
  GST --> INT
  OPS --> HR

  MODS --> PLAT
  MODS --> DB
  MODS --> COMMON
  PLAT --> DB
  PLAT --> COMMON
  DB --> COMMON
```

Read the module arrows as "calls the service of". For example, lib-sales calls lib-stock to move goods and
lib-accounts to post the journal. lib-integrations is the one module library that never touches packages/db.

## Never

| From | Never imports | Why |
|---|---|---|
| apps/web | lib-platform, packages/db, a library's `index.ts`, Node built-ins | server code must not reach the browser bundle |
| apps/api, apps/worker | packages/db | the database is reached through services and lib-platform's transaction |
| any `packages/*` | Express, Next, anything in `apps/` | the worker must run any service without the web layer (RC-175) |
| any library | another module's tables in `packages/db/src/<module>/` | one owner writes each table; others read by relation or view |
| a `contract.ts` | db, lib-platform, services | the web imports it |
| a route or job file | anything but contracts, library entries, `defineRoute` / `defineJob` | no rule lives in a route |

## One request

```
apps/web ── typed client (from lib-x/contract) ──► apps/api generic handler
   guards ─► session ─► parse input ─► route permission ─► saved-once
   ─► transaction (timeouts) ─► lib-x service(ctx, input) ─► record-scope check, rules, other libraries' services
   ─► packages/db (own tables; relations and views for others) ─► commit ─► output as declared
```
