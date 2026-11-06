# ADR-004: Runtime and hosting target

- Status: accepted on the D-01 default. **D-01 (hosting) is still open with Sarthak** and is confirmed before M1
  starts.
- Date: 2026-11-06
- Ticket: RAD-10 (M0-05). Covers RC-015.
- Builds on: [ADR-001](001-layers.md) (API and worker processes), [ADR-002](002-data-access.md) (pool, timeouts, no
  transaction-mode pooler), [ADR-003](003-libraries.md) (Node 26.13.0, pg-boss, S3 client).
- Source: Hosting recommendation §1, §2, §8, §10.2; Handover call pack D-01.

## Context

v1 was written for a long-running server but deployed to Vercel (RC-015). There it lost three things:
- **rate limits**, kept in one function's memory;
- **jobs**: the 15-minute chores ran once a day;
- **uploads**, capped at 4.5 MB and stored inside the database.

v2 is built for the place it will run, so jobs, uploads and limits behave the same in development, CI and
production.

## Decision

### 1. What runs

| Piece | What it is | Where (D-01 default, Option 4: AWS Mumbai hybrid) |
|---|---|---|
| `api` | `apps/api`: a long-running Node 26 HTTP server. Answers requests, runs no jobs. | Docker container on one EC2 server, Mumbai (`ap-south-1`) |
| `worker` | `apps/worker`: a separate long-running Node process. It runs pg-boss: queued jobs, the outbox relay, and the schedule (the 15-minute chores, monthly partitions). Exactly one scheduler. | Docker container on the same server |
| `web` | `apps/web`: the Next.js server | Docker container on the same server |
| `proxy` | Caddy: TLS on our own domain, request-size limit, passes `/api` to `api` | Docker container on the same server |
| `migrate` | a one-off container that runs the migrations with the **owner** login, then exits. Runs before a new `api` or `worker` starts (M1-07). | Same image, run by the deploy step |
| Database | PostgreSQL **16**, Amazon RDS, with automated backups and point-in-time recovery (up to 5 minutes lost), and cross-region backup copies to Hyderabad (`ap-south-2`). Single-zone at first; two-zone is a setting. | RDS, Mumbai |
| Files | Amazon S3: bill photos, resumes, statements, exports. Versioning on, public access blocked, encrypted with KMS, replicated to Hyderabad. | S3, Mumbai |
| Jobs | pg-boss tables in the same PostgreSQL. No other queue service. | RDS |
| Monitoring | a small separate server watching health and heartbeats from outside (RC-083) | Outside the app server |

The same major versions run everywhere:
- **Development:** `compose.dev.yml` runs PostgreSQL 16 and MinIO, bound to `127.0.0.1` with generated passwords
  (M0-07, RC-198).
- **CI:** a PostgreSQL 16 service (M0-08).
- **Production:** RDS PostgreSQL 16.

Files use the S3 API in every environment: MinIO in development and CI, S3 in production. There is no
"files in the database" or "files on disk" mode, so the code has one path.

### 2. Rules the runtime keeps

- **No state in one process's memory.** These all live in PostgreSQL from day one, so a second `api` copy or a
  restart changes nothing (Theme 10, RC-088, RC-095):
  - sessions and rate-limit counters (rate-limiter-flexible's PostgreSQL store, ADR-003);
  - the permission matrix, re-read on change;
  - saved-once keys and job state.
- **Uploads stream to S3.** The browser uploads straight to S3 with a short-lived presigned URL (M1-25). Neither the
  API nor the database holds a whole file. The size limit is set per kind of file, with the bank-statement limit
  above 12 MB.
- **No pooler in transaction mode.** The API and worker connect straight to RDS from their own pools, so the
  timeouts set as connection options hold (ADR-002 §4).
- **Graceful stop.** On a stop signal, `api` stops taking requests and finishes the ones it has, and `worker`
  finishes or releases its current jobs. Both exit within 30 seconds (RC-079).
- **Health.** `/health` touches the database. The worker sends a heartbeat after each scheduled run. The outside
  monitor alerts on a failed check or a missing heartbeat (RC-083).
- **Settings validated at start.** Both processes refuse to start, naming each missing or weak setting, rather than
  start in a half-safe mode (M1-10, Theme 2).
- **Three database logins** (ADR-005 §7, M1-06):
  - `radcore_owner` runs migrations only;
  - `radcore_app` is the runtime login (no DDL, no UPDATE, DELETE or TRUNCATE on append-only tables);
  - `radcore_read` is read-only (reports, the restore drill).

  The owner's credentials exist only for the `migrate` step and are never in the `api` or `worker` containers
  (RC-003).
- **Images are built in CI and pulled, never built on the server.** Deploying takes an RDS snapshot first, runs
  `migrate`, then swaps containers (M8-04).

### 3. Vercel is not used for real data

No environment that holds real data runs on Vercel. The v1 review copy (`radcore-erp.vercel.app`, Singapore,
sample data) is retired before real data enters (M8-09, RC-018). Until then, the Vercel Git integration still
builds this repository's branches. Disconnecting it is Sarthak's call, already raised by the coordinator.

### 4. Settings

Every setting the processes read, validated at start by M1-10. "Secret" means the value grants access. Secrets
live in AWS Secrets Manager in staging and production, and the deploy step hands them to the containers that need
them. Non-secrets live in SSM Parameter Store. In development, `npm run setup` generates a `.env` with fresh random
values; it's never committed.

**Integration credentials are not environment settings.** Meta, WhatsApp, Shopify, the statements mailbox and a GSP
hold tokens that rotate. They are set on the Admin screen and kept encrypted in the database by the secrets library
(M1-24), under the KMS key below. So the environment holds only the few values needed to start.

| Name | Purpose | Secret | Where (staging, production) | Read by |
|---|---|---|---|---|
| `NODE_ENV` | `production` outside development and CI | no | Parameter Store | all |
| `APP_ENV` | `development`, `ci`, `staging` or `production`. Production refuses demo data and weak settings | no | Parameter Store | all |
| `PUBLIC_ORIGIN` | the site's own `https://` origin, for the Origin check, links and cookies | no | Parameter Store | api, web, worker |
| `TRUST_PROXY` | how many proxy hops sit in front of `api` (Caddy: 1), so the client address for rate limits is the real one | no | Parameter Store | api |
| `DATABASE_URL` | runtime login `radcore_app` | **yes** | Secrets Manager | api, worker |
| `DATABASE_READ_URL` | read-only login `radcore_read` | **yes** | Secrets Manager | api (reports), restore drill |
| `MIGRATION_DATABASE_URL` | owner login `radcore_owner` | **yes** | Secrets Manager | `migrate` only |
| `DB_POOL_MAX`, `DB_POOL_WAIT_MS` | pool size and wait limit | no | Parameter Store | api, worker |
| `DB_STATEMENT_TIMEOUT_MS`, `DB_LOCK_TIMEOUT_MS`, `DB_IDLE_TX_TIMEOUT_MS` | connection timeouts (ADR-002 §4) | no | Parameter Store | api, worker |
| `S3_REGION`, `S3_BUCKET_FILES` | where files live | no | Parameter Store | api, worker |
| `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO in development and CI only. In AWS the server's instance role grants access and these are unset. | **yes** (dev and CI only) | generated `.env` / CI | api, worker |
| `SECRETS_KMS_KEY_ID` | the KMS key that wraps the secrets library's data keys (M1-24) | no (the key never leaves KMS) | Parameter Store | api, worker |
| `SECRETS_LOCAL_KEY` | development and CI stand-in for KMS, at least 32 random bytes; refused when `APP_ENV` is staging or production | **yes** | generated `.env` / CI | api, worker |
| `TURNSTILE_SITE_KEY` | the public "I am a person" check on public forms | no | Parameter Store | web |
| `TURNSTILE_SECRET` | verifies that check | **yes** | Secrets Manager | api |
| `ALERT_WEBHOOK_URL` | where alerts go (the URL carries a token) | **yes** | Secrets Manager | api, worker |
| `HEARTBEAT_URL` | the outside monitor's heartbeat address | **yes** | Secrets Manager | worker |
| `SEED_ADMIN_EMAIL` | who gets the first admin invite link (no password is created or printed; M1-14) | no | Parameter Store | `migrate` (first run) |
| `LOG_LEVEL` | pino level | no | Parameter Store | all |

There is no `SESSION_SECRET`: sessions are random tokens stored hashed in PostgreSQL. There is no `TZ`: processes
run in UTC and lib-common works out India dates. Adding a setting means adding its row here.

### 5. If D-01 picks another option

The code doesn't depend on the host. It needs containers, PostgreSQL 16, the S3 API and the settings above. Each
other option changes only the following:

| D-01 choice | What changes |
|---|---|
| **Option 2: AWS containers (ECS Fargate)** | `api`, `web` and `worker` become ECS services, and a load balancer replaces Caddy (proxy hops in `TRUST_PROXY` set to match). `api` can run two copies at once, since no state is in memory. `migrate` becomes a one-off ECS task. RDS goes two-zone. No code change. |
| **Option 3: one rented server, database on it** | PostgreSQL runs in a container on the same server, so there's no managed point-in-time recovery. WAL archiving to S3 (pgBackRest or WAL-G) is added and drilled, or RC-016 isn't met. Files still go to S3 (or a compatible store). The rest is the same as Option 4. |
| **Option 1: Vercel plus Supabase (Mumbai)** | The biggest change, which is why it isn't the default. **The worker can't run on Vercel**, so it needs its own always-on host, and Vercel serves only `web` and `api`. Supabase's pooler must be used in session mode, or the timeouts move to `ALTER ROLE ... SET`. Uploads go presigned to storage (the 4.5 MB body limit). The data-location statements for Vercel's logs and builds must be obtained in writing. ADR-001's shape survives, but this ADR is rewritten. |

If Sarthak picks another option, this ADR is amended in a PR before M1 starts, and the devops tickets (M8-01 to
M8-07) follow it.

## Consequences

- Development, CI and production run the same processes against the same PostgreSQL major version and the same
  file API. A job, an upload or a rate limit that works in one works in the others.
- The `api` process can be doubled without a code change. Under Option 4 it starts as one copy to keep the cost
  down (Hosting recommendation §4).
- Integration tokens can rotate without a deploy, because they live in the encrypted secrets store, not in the
  environment.
- The first-week AWS work (account, RDS, S3, roles, Secrets Manager, monitoring) belongs to the devops session from
  the end of M1 (M8-01 to M8-07).

## Alternatives considered

- **Running jobs inside the API process** (v1's way). That's one process fewer, but a slow job holds up requests and
  a second API copy would run the schedule twice. Rejected (ADR-001 §8).
- **Files in the database.** It avoids S3 in development, but files grow to most of the data and slow backups
  (Hosting recommendation §2). Rejected; MinIO gives development the same API.
- **A transaction-mode pooler (PgBouncer, RDS Proxy pinned).** It isn't needed at 20 to 150 users, and it drops the
  connection-level timeouts. Revisit with Option 2 at scale.
