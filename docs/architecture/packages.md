# RadCore v2: packages and who calls whom

One page. The rules behind it are in [ADR-001](adr/001-layers.md). An arrow means "may import". Every arrow
points down a rank, so there are no cycles.

```mermaid
flowchart TB
  WEB["apps/web<br/>screens, typed client"]
  API["apps/api<br/>routes as data, one generic handler"]
  WORKER["apps/worker<br/>queued and scheduled jobs"]

  subgraph MODS["Module libraries with tables: index.ts for servers, contract.ts for everyone"]
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
  end

  INT["lib-integrations<br/>outside-service clients, parsers, signature checks; no tables"]
  PLAT["lib-platform<br/>db client, Ctx, sessions, permissions, saved-once, jobs,<br/>files, secrets, approvals, links, lists, imports, numbering"]
  DB[("packages/db<br/>schema per module, relations, views, migrations")]
  COMMON["lib-common<br/>money, dates, ids, base schemas: no I/O"]

  WEB -.->|contract.ts only| MODS
  WEB --> COMMON
  API --> MODS
  API --> INT
  API --> PLAT
  WORKER --> MODS
  WORKER --> PLAT

  SERVICE --> SALES & PURCH & STOCK & ACC & OPS
  SALES --> CRM & STOCK & ACC & GST & INT
  PURCH --> STOCK & ACC & GST
  CRM --> ACC & OPS & INT
  STOCK --> ACC & GST & INT
  PAYROLL --> HR & ACC
  ACC --> GST & INT
  GST --> INT
  OPS --> HR

  MODS --> PLAT
  MODS --> DB
  MODS --> COMMON
  INT --> PLAT
  INT --> COMMON
  PLAT --> DB
  PLAT --> COMMON
  DB --> COMMON
```

Read the module arrows as "calls the service of". For example, lib-sales calls lib-stock to move goods and
lib-accounts to post the journal. apps/api imports lib-integrations only to hand a provider's signature check to
the webhook intake (ADR-001 §8a).

Where the rules are, rather than repeated here:

- What may import what, and what never may: [ADR-001 §4](adr/001-layers.md#4-who-may-depend-on-whom) and the
  [Enforcement table](adr/001-layers.md#enforcement-for-m0-07-to-add-m0-08-to-run-in-ci).
- Who writes and reads each table: [§5](adr/001-layers.md#5-one-owner-per-table).
- The path of one request, the webhook lane and saved-once:
  [§6](adr/001-layers.md#6-routes-declared-as-data-one-generic-handler).
- Who a request runs as: [§6a](adr/001-layers.md#6a-who-a-request-runs-as).
