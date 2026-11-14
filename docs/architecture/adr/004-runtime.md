# ADR-004: Runtime and hosting target

- Status: accepted. **D-01 decided by Sarthak, 7 Nov 2026:** production is AWS Option 4 (Mumbai hybrid), as this
  ADR describes, after testing. Testing runs on a Vercel test copy with sample data only (§7).
- Date: 2026-11-06, revised after the auditor's review the same day
- Ticket: RAD-10 (M0-05). Covers RC-015.
- Builds on: [ADR-001](001-layers.md) (API and worker processes), [ADR-002](002-data-access.md) (pool, timeouts, the
  outbound client), [ADR-003](003-libraries.md) (Node 26.13.0, pg-boss, the S3 client, envelope encryption),
  [ADR-005](005-database.md) (the three logins, system principals).
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

| Piece | What it is | Where (production, D-01: Option 4, AWS Mumbai hybrid) |
|---|---|---|
| `api` | `apps/api`: a long-running Node 26 HTTP server. Answers requests, runs no jobs. | Docker container on one EC2 server, Mumbai (`ap-south-1`) |
| `worker` | `apps/worker`: a separate long-running Node process. It runs pg-boss: queued jobs, the outbox relay, and the schedule (the 15-minute chores, the partition watch). Exactly one scheduler. | Docker container on the same server |
| `web` | `apps/web`: the Next.js server | Docker container on the same server |
| `proxy` | Caddy: TLS on our own domain, request-size limit, `/api` to `api`, everything else to `web` | Docker container on the same server |
| `migrate` | the migrations, run with the **owner** login from the CI deploy job (§3), never on the server | CI, through a tunnel to RDS |
| Database | PostgreSQL **16**, Amazon RDS, with automated backups and point-in-time recovery (up to 5 minutes lost), and cross-region backup copies to Hyderabad (`ap-south-2`). Single-zone at first; two-zone is a setting. | RDS, Mumbai |
| Files | Amazon S3: bill photos, resumes, statements, exports. Versioning on, public access blocked, encrypted with KMS, replicated to Hyderabad (§4) | S3, Mumbai |
| Jobs | pg-boss tables in the same PostgreSQL. No other queue service. | RDS |
| Mail | Amazon SES in Mumbai, for invites, password resets and alerts to people. Its client library is added under ADR-003 §4 by the first ticket that sends mail (M1-14) | SES |
| Breached passwords | the Pwned Passwords range API (`api.pwnedpasswords.com`): free, no key, no rate limit. `api` calls it through the outbound client only when someone sets a password, and sends only the first five hex characters of the password's SHA-1, with padding (ADR-001 §7a, RAD-32) | Outside service |
| Monitoring | a small separate server watching health and heartbeats from outside (RC-083) | Outside the app server |

The same major versions run everywhere:
- **Development:** `compose.dev.yml` runs PostgreSQL 16 and an S3-compatible dev server (SeaweedFS, Apache-2.0,
  pinned by digest), bound to `127.0.0.1` with generated passwords (M0-07, RC-198). MinIO's image can no longer be
  pulled anonymously, so it was replaced on 6 Nov.
- **CI:** a PostgreSQL 16 service (M0-08).
- **Production:** RDS PostgreSQL 16.

Files use the S3 API in every environment: an S3-compatible dev server (SeaweedFS) in development and CI, AWS S3 in
production. The dev server's smoke test covers what production relies on: a presigned **POST** with its
`content-length-range` and content-type conditions (§2) is accepted within the limits and refused outside them, and
a presigned GET works. A presigned PUT alone isn't enough. Mail in development and CI goes to a local catcher, never
out.

### 2. Rules the runtime keeps

- **No state in one process's memory.** These all live in PostgreSQL from day one, so a second `api` copy or a
  restart changes nothing (Theme 10, RC-088, RC-095):
  - sessions and rate-limit counters;
  - the permission matrix, re-read on change;
  - saved-once keys and job state.
- **Uploads go straight to S3, with limits the bucket enforces.** The browser uploads with a presigned **POST**.
  A presigned PUT can't limit size. The POST policy fixes:
  - the exact `bucket` and `key` (made by the server, under `incoming/`);
  - the `Content-Type`;
  - a `content-length-range` for the kind of file;
  - an expiry of 5 minutes.

  The client can't set an ACL, encryption or any other field: encryption is the bucket's default (KMS). The
  bucket's CORS allows `POST` from `PUBLIC_ORIGIN` only (ADR-001 §7a).
  - Limits by kind: photos 10 MB, resumes 5 MB, bank statements 15 MB, import files 25 MB (M1-25).
  - After upload, a job copies the object from `incoming/<kind>/<uuid>` to `<kind>/<uuid>`, which no POST policy
    names, once (a retried job checks the copy it already made), then checks the copy's size, type and magic bytes,
    and removes the upload. Only that checked copy is ever downloaded, so bytes posted again to the upload key while
    its policy lasts never reach a reader (RAD-43). A refused copy stays where it is, never served: only a file
    checked as ready gets a download link.
  - Downloads are short-lived presigned GETs with `Content-Disposition: attachment`.
  - Neither the API nor the database holds a whole file.
- **Connections.** The API and worker connect straight to RDS from their own pools: no transaction-mode pooler,
  so the timeouts set as connection options hold (ADR-002 §4).
  - TLS to RDS is verified: `sslmode=verify-full` with the RDS CA bundled in the image, and `rds.force_ssl=1` on
    the database. Start-up refuses a database URL without verification in staging and production.
  - **The connection budget** is counted against RDS's `max_connections`, with room for the owner's migrations
    and the restore drill:

    | Pool | Connections |
    |---|---|
    | `api` | 10 |
    | `worker` | 5 |
    | pg-boss | 4 |
    | rate limiter | 2 |
- **The app uses one login.** `api` and `worker` both use `radcore_app` (read-only transactions where the contract
  says so). `radcore_read` is for the restore drill (pointed at the restored instance) and for support queries.
- **Graceful stop.** On a stop signal, `api` stops taking requests and finishes the ones it has, and `worker`
  finishes or releases its current jobs. Both exit within 30 seconds (RC-079). Compose sets
  `stop_grace_period: 30s` and `init: true`, because Docker kills after 10 seconds by default.
- **Health.** Caddy routes `/api/health` to `api`, which touches the database; it is rate-limited. `web` has its own
  `/health`. The worker sends a heartbeat every 5 minutes. The outside monitor alerts on a failed check, or on no
  heartbeat for 15 minutes. Who answers the alert is D-18.
- **Settings validated at start.** Both processes refuse to start, naming each problem, rather than start in a
  half-safe mode (M1-10, Theme 2). See the checks in §5.
- **Containers:**
  - each runs as a non-root user, with a read-only root filesystem, `cap_drop: ALL` and `no-new-privileges`;
  - no container mounts the Docker socket;
  - logs rotate (`json-file` with a size cap);
  - export temp files go to a size-limited volume.

### 3. Credentials, deploys and rollback

**What can reach AWS credentials.** The server's instance role is the only AWS credential on the server. Only `api`
and `worker` may reach it, by an allowlist:
- **Metadata service:** IMDSv2 is required (`HttpTokens=required`), with a hop limit of 2. Its IPv6 endpoint is
  off (`HttpProtocolIpv6=disabled`).
- **One network.** All four containers sit on a single Docker network with a **pinned** subnet (`172.30.0.0/24`)
  and bridge name (`br-radcore`), and **fixed** addresses: `proxy` .2, `web` .3, `api` .10, `worker` .11.
  Docker uses the iptables backend, pinned in its daemon config.
- **Firewall rules,** in the `DOCKER-USER` chain:
  - traffic to `169.254.169.254` is **accepted only from .10 and .11**, and dropped from every other container
    address;
  - traffic to RDS's port 5432 is likewise accepted only from .10 and .11.
- **The rules hold across reboots.** A systemd unit installs them, and it is ordered before `docker.service`.
- **A continuous check.** `web`'s `/health` tries the metadata address with a 1-second timeout, and reports
  unhealthy if it gets an answer. The outside monitor reads it every 5 minutes, so a lost rule is noticed the same
  day, not at the next audit. M8 also proves it once from a shell inside `web`.

**What the instance role may do**, and nothing else:
- read and write objects in the files bucket, and delete them under `incoming/` (an upload, once its checked copy
  is made, RAD-43);
- list the files bucket (`s3:ListBucket`), so a missing object answers 404, which the upload check relies on. Without
  it S3 answers 403 for a missing object. It shows key names only, which are server-made ids;
- use the secrets KMS key (encrypt, decrypt, generate data keys);
- read the named **runtime** secrets in Secrets Manager (`DATABASE_URL`, `TURNSTILE_SECRET`, `ALERT_WEBHOOK_URL`,
  `HEARTBEAT_URL`), and the runtime settings in Parameter Store;
- send mail from the verified SES identity, with the condition `ses:FromAddress = MAIL_FROM`;
- pull the app's images from its ECR repository;
- run the SSM agent (`AmazonSSMManagedInstanceCore`).

It has no `s3:DeleteObjectVersion`, so it can't remove old versions of a file.

It can't read the owner secret.
- `api` and `worker` fetch their runtime secrets at start through the role and keep them in memory. They are never
  in the environment and never in a file.
- Rotating one means restarting the containers.
- The RDS master credential is managed by RDS in Secrets Manager, and no application uses it.

**Migrations run from CI, so the owner credential never reaches the server.** The deploy job runs in GitHub
Actions with its own AWS role, assumed through OIDC (no stored keys). That role is the only one that can read
`MIGRATION_DATABASE_URL`. The job:

1. takes an RDS snapshot;
2. opens an SSM port-forwarding session through the server to RDS, which isn't public;
3. runs the `migrate` image in CI with the owner login. TLS is still verified through the tunnel: `ssl.servername`
   is the RDS endpoint name, so `verify-full` checks the right certificate. It runs under `lock_timeout = 5s` and a
   statement timeout, so a migration never queues behind live traffic for long. The same step tops up the log
   partitions under the same lock (ADR-005 §8);
4. closes the session;
5. tells the server, through SSM, to pull the new images **by digest** and swap containers.

Deploys are serialised: one GitHub Actions concurrency group per environment, with `cancel-in-progress: false`, so
two deploys never overlap and a running one is never cut off. The previous five image digests are kept.

**The deploy role is bound to `main` and to the deploy workflow.** It can read the owner secret and run commands
on the server, so its OIDC trust policy requires all three of:
- `aud` = `sts.amazonaws.com`;
- `sub` = `repo:sarthakradboards-hash/radcore-erp:ref:refs/heads/main`;
- `job_workflow_ref` = `sarthakradboards-hash/radcore-erp/.github/workflows/deploy.yml@refs/heads/main`.

A workflow on any other branch, or any other workflow file, can't assume it. GitHub Environments with required
reviewers aren't available on a private Free repository, so this binding is the guard. Only the coordinator merges
to `main`.
- `ssm:StartSession` is limited to the port-forwarding document (`AWS-StartPortForwardingSessionToRemoteHost`),
  with the RDS endpoint and port 5432 as its only parameters, on the one instance.
- `ssm:SendCommand` is limited to the named documents `radcore-deploy` and `radcore-bootstrap-admin`, on the one
  instance.
- Session Manager logging (to CloudWatch Logs) and CloudTrail are on.
- An interactive shell on the server needs a person's own IAM identity with MFA: Sarthak, or the devops role once
  it exists. The deploy role can't open one.

**Migrations stay compatible, checked in CI.** A migration that drops or renames a column or table fails CI
(M0-08) unless the PR names the earlier release that stopped using it (the contract step of expand/contract). Job
payloads follow the same rule: a job queued by the previous release must still run on the new one.

**Rollback keeps the data.**
- Every migration works with the previous release as well as the new one (expand, then contract). A column or
  table is dropped only in a later release, once nothing reads it.
- So rollback means redeploying the previous image's digest. **The snapshot is never restored over live data.** It
  exists for disaster recovery, and restoring it would lose everything written since.

**The first admin** is created by a one-off bootstrap command in the `api` image (`bootstrap-admin`), run once by
the deploy job through SSM:
- It runs under the runtime login, as the system principal `system:seed` (ADR-005 §5).
- It does nothing if a bootstrap record already exists. That record is permanent and unique, so the invite is
  minted once ever, and a later deploy can't mint another.
- It sends the invite link by email (SES) to `SEED_ADMIN_EMAIL`. The link is never written to a log or to the
  command's output, which shows only that an invite was sent to a masked address (M1-14).
- SES must be out of its sandbox (production access) before this runs.
- **Re-issue.** If the invite bounces or expires before any admin has accepted, the same command can re-issue it.
  That invalidates the old invite, is logged, and goes only to `SEED_ADMIN_EMAIL`. Once an admin exists, it does
  nothing.
- **Tokens stay out of URLs that get logged.** Invite and password-reset links carry their token in the URL
  fragment (`#...`), which browsers don't send to the server or in `Referer`. The page exchanges it by POST.

**Network.**
- **The server's security group** allows 80 and 443 in, and nothing else: no SSH, since administration goes
  through SSM Session Manager.
- **RDS** accepts 5432 only from the server's security group, and isn't publicly reachable.
- **Ports:** only `proxy` publishes ports on the host. `api` and `web` are reachable only on the Docker network.
- **Caddy:** its admin API is off, its `/data` volume persists (Let's Encrypt has rate limits), and it overwrites
  any `X-Forwarded-*` headers arriving from outside.
- **Client addresses:**
  - `api` trusts forwarded-for headers only from the fixed addresses in `TRUST_PROXY` (`proxy` and `web`), parsed
    and validated at start.
  - `web`'s server components call **only read contracts** on `api` (at `API_INTERNAL_URL`). They pass on the
    person's cookie and the client address Caddy gave them.
  - **Every write comes from the browser itself,** carrying its own `Origin`, so the API's write-Origin check
    (M1-21) still sees where the person really came from. The web server never sets `Origin` for them.

### 4. Copies in Hyderabad that can actually be used

- **One multi-Region KMS key** for secrets and files: its primary is in Mumbai and its replica in Hyderabad. The
  AWS Encryption SDK uses its multi-Region-aware keyring, so ciphertexts written in Mumbai decrypt in Hyderabad
  with the replica. The key has a 30-day deletion waiting period.
- **S3 replication** to a bucket in `ap-south-2` opts in to KMS-encrypted objects (`SseKmsEncryptedObjects`) and
  names the Hyderabad replica key. Without that, it would copy nothing.
  - A daily canary object is written in Mumbai. The monitor alerts if it hasn't appeared in Hyderabad within an
    hour.
  - Lifecycle rules abort incomplete uploads after a day, and expire everything under `incoming/` after a day,
    current and old versions alike: an upload is working data, and its checked copy is the record (D-12). Old
    versions elsewhere are kept: D-12 keeps all data, so none expires.
  - A bucket policy denies any request not over TLS.
- **RDS** has deletion protection on, keeps its automated backups on deletion, and replicates them to `ap-south-2`
  with a key in that region. M8-01 confirms that the Mumbai-to-Hyderabad pair is offered, and sets the retention
  (D4).
- **Backups out of reach of one compromised admin:** the cross-region copies sit in a backup vault with a
  deletion lock (M8).
- **Files, still open:** the Hyderabad files bucket has no Object Lock yet, and one key protects both regions. Object
  Lock would protect files from one admin as the vault protects backups, but it would also block deleting a
  person's files on request (DPDP). D-12 keeps everything, so Object Lock no longer conflicts with retention, but
  it would rule out an erasure on request, which D-09 leaves open. It's decided at M8, after D-09.
- **Recovery time:** about 30 to 60 minutes to rebuild the server from images and reattach RDS, rehearsed in M8
  (Hosting recommendation §3).

### 5. Settings

Every setting the processes read, validated at start by M1-10. "Secret" means the value grants access.
- In staging and production, secrets live in AWS Secrets Manager (fetched as §3 says), and other settings in SSM
  Parameter Store.
- Only the CI deploy role may write Parameter Store, because several settings change security behaviour.
- In development, `npm run setup` generates a `.env` with fresh random values; it's never committed.

**Integration credentials are not environment settings.** Meta, WhatsApp, Shopify, the statements mailbox and a GSP
hold tokens that rotate. They are set on the Admin screen and kept encrypted in the database by the secrets library
(ADR-003, M1-24).

**No `NEXT_PUBLIC_*` settings.** Next.js fixes those at build time, which would tie an image to one environment. The
browser gets what it needs (for example the Turnstile site key) from the server at run time.

| Name | Purpose | Secret | Required in | Where (staging, production) | Read by |
|---|---|---|---|---|---|
| `NODE_ENV` | `production` outside development and CI | no | all | Parameter Store | all |
| `APP_ENV` | `development`, `ci`, `review` (the Vercel test copy, §7), `staging` or `production`. Production refuses demo data and weak settings; `review` refuses anything but sample data | no | all | Parameter Store (Vercel's environment settings for `review`) | all |
| `PUBLIC_ORIGIN` | the site's own `https://` origin, for the Origin check, links and cookies | no | all | Parameter Store | api, web, worker |
| `API_INTERNAL_URL` | where `web`'s server reaches `api` on the Docker network (read contracts only, §3) | no | all | Parameter Store | web |
| `TRUST_PROXY` | the fixed addresses of `proxy` and `web`, whose forwarded-for headers `api` trusts | no | all | Parameter Store | api |
| `DATABASE_URL` | runtime login `radcore_app`, with `sslmode=verify-full` | **yes** | all | Secrets Manager | api, worker |
| `DATABASE_READ_URL` | read-only login `radcore_read` | **yes** | staging, production | Secrets Manager | restore drill, support |
| `MIGRATION_DATABASE_URL` | owner login `radcore_owner` | **yes** | all | Secrets Manager, readable only by the CI deploy role (for `review`, a GitHub Actions secret, §7) | `migrate` in CI only |
| `DB_POOL_MAX`, `DB_POOL_WAIT_MS` | pool size and wait limit (§2) | no | all | Parameter Store | api, worker |
| `DB_STATEMENT_TIMEOUT_MS`, `DB_LOCK_TIMEOUT_MS`, `DB_IDLE_TX_TIMEOUT_MS` | connection timeouts (ADR-002 §4) | no | all | Parameter Store | api, worker |
| `S3_REGION`, `S3_BUCKET_FILES` | where files live | no | all | Parameter Store | api, worker |
| `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | the S3-compatible dev server (SeaweedFS) in development and CI only | **yes** | development, CI | generated `.env` / CI | api, worker |
| `S3_FILES_ORIGIN` | the files bucket's origin as the browser sees it: `https://<bucket>.s3.<region>.amazonaws.com`, or SeaweedFS's `http://127.0.0.1:8333` in development and CI. `web`'s CSP lets pages upload to it (`connect-src`, `form-action`) and show previews from it (`img-src`), and allows no other outside origin (RAD-43) | no | all | Parameter Store | web |
| `SECRETS_KMS_KEY_ID` | the multi-Region KMS key that wraps the secrets library's data keys | no | staging, production | Parameter Store | api, worker |
| `SECRETS_LOCAL_KEY` | stand-in for KMS in development, CI and the test copy, at least 32 random bytes | **yes** | development, CI, review | generated `.env` / CI / Vercel (§7) | api, worker |
| `MAIL_FROM` | the sender address for invites and resets (a verified SES identity) | no | staging, production | Parameter Store | api, worker |
| `TURNSTILE_SITE_KEY` | the public "I am a person" check on public forms, served to the browser at run time | no | all | Parameter Store | api |
| `TURNSTILE_SECRET` | verifies that check | **yes** | staging, production | Secrets Manager | api |
| `ALERT_WEBHOOK_URL` | where alerts go; the URL carries a token | **yes** | staging, production | Secrets Manager | api, worker |
| `HEARTBEAT_URL` | the outside monitor's heartbeat address; the URL carries a token | **yes** | staging, production | Secrets Manager | worker |
| `SEED_ADMIN_EMAIL` | who gets the one-time first-admin invite (§3) | no | staging, production | Parameter Store | `bootstrap-admin` |
| `LOG_LEVEL` | pino level | no | all | Parameter Store | all |

**Start-up refuses when:**
- `SECRETS_KMS_KEY_ID` and `SECRETS_LOCAL_KEY` aren't exactly one of them set;
- `S3_ENDPOINT` or static S3 keys are set in staging or production;
- `S3_FILES_ORIGIN` (in `web`) isn't an origin alone (no path or wildcard), or isn't `https://` outside development and CI;
- `APP_ENV` is `development` or `ci` while `NODE_ENV` is `production`;
- a setting its column marks as required is missing;
- the database URL doesn't verify TLS in staging or production.

**Tokens in URLs aren't logged.** The alert and heartbeat URLs carry their token in the path. ADR-002's outbound
client logs origin and path by default, so these two clients are created with `logPath: false`, which logs the
origin only. M1-11 makes that option required for any client whose URL carries a credential.

There is no `SESSION_SECRET`: sessions are random tokens stored hashed in PostgreSQL. There is no `TZ`: processes
run in UTC and lib-common works out India dates. Adding a setting means adding its row here.

### 6. If the production choice ever changes

D-01 is decided (Option 4). This section stays as the record of what another option would cost to move to. The
code needs containers, PostgreSQL 16, the S3 API, an outgoing mail service and the settings above. In every option,
`api` enforces request-body limits itself, and never relies on the proxy for them. Each other option changes the
following:

| Option | What changes |
|---|---|
| **Option 2: AWS containers (ECS Fargate)** | `api`, `web` and `worker` become ECS services with their own task roles, so the IMDS network rule isn't needed. A load balancer replaces Caddy: set `TRUST_PROXY` to match, and note that a load balancer enforces no body limit, which `api` already does. `api` can run two copies, since no state is in memory. The `worker` service runs `maximumPercent: 100`, so a deploy never starts a second scheduler. `migrate` stays a CI step, through an ECS one-off task or the same tunnel. RDS goes two-zone. No code change. |
| **Option 3: one rented server, database on it** | PostgreSQL runs in a container on the same server, so there's no managed point-in-time recovery: WAL archiving to S3 (pgBackRest or WAL-G) is added and drilled, or RC-016 isn't met. **There is no instance role**: the server holds a scoped access key for S3 and KMS in a root-only file, and the owner login is still used only from CI over a tunnel. Mail goes through a provider's SMTP. |
| **Option 1: Vercel plus Supabase (Mumbai)** | The biggest change, which is why it isn't the default. **The worker can't run on Vercel**, so it needs its own always-on host, and Vercel serves only `web` and `api`. There's no instance role: credentials go in each platform's secret store. Supabase's pooler must be used in session mode, or the timeouts move to `ALTER ROLE ... SET`. Uploads go presigned to storage (the 4.5 MB body limit). The data-location statements for Vercel's logs and builds must be obtained in writing. ADR-001's shape survives, but this ADR is rewritten. |

A move would be amended here in a PR first, and the devops tickets (M8-01 to M8-07) would follow it.

### 7. Test copy on Vercel (sample data only)

Until production is up, people try v2 on a test copy on Vercel (D-01). It never holds real data.

**What runs there.**
- `web` and `api` as Vercel functions, in the Mumbai region (`bom1`).
- The database is a **Supabase free-tier project in Mumbai** (`ap-south-1`). Neon, Vercel's own Postgres, has no
  India region.
  - The functions connect through Supabase's pooler in **session mode**, never transaction mode (ADR-002 §4),
    with a pool of one connection per function.
  - Supabase runs its own current major version, not 16, so CI on PostgreSQL 16 stays the reference.
  - A free project pauses after a week without use.
- Sessions, rate limits and saved-once keys live in that database, so they work as in production.
- `APP_ENV=review`.
- **Its settings** are the Vercel project's environment variables, with every secret marked Sensitive. It uses
  the local keyring (`SECRETS_LOCAL_KEY`, generated for the test copy alone), because nothing in it is real. Its
  database URLs and keys are never reused anywhere else.
- **Migrations and the sample-data seed** run from a CI job, with the test database's owner URL as a GitHub
  Actions secret, never from a function. Any branch's workflow could read that secret (GitHub Free has no
  branch-restricted environments for private repositories). That is accepted only because the database holds
  sample data.

**What doesn't run there, and is therefore tested in CI instead:**
- **The long-running worker, so pg-boss doesn't run.** Nothing queued is ever processed: imports, large exports,
  PDF printouts, webhook processing (deliveries are stored but never acted on), the statements mailbox, the
  one-minute schedule and the outbox relay. Vercel's free cron runs once a day, and it isn't wired to jobs: the
  code keeps one path.
- **Request bodies over 4.5 MB**, Vercel's function limit. Files go straight to storage by presigned POST. Where
  Supabase Storage's S3 API accepts that POST, uploads work on the test copy; either way, the POST's size and type
  conditions are proven in CI against SeaweedFS.
- **Mail.** The test copy sends none.

CI covers every one of these on PostgreSQL 16 with SeaweedFS (M0-08), so nothing goes untested. It's only that a
person trying the test copy won't see them happen.

**No real data, ever.**
- The API refuses to start on Vercel unless `APP_ENV=review` and the database carries the sample-data marker.
- Production refuses `APP_ENV=review` (RC-018).
- Sign-ins are seeded sample users, whose passwords Sarthak sets on the test copy itself, never in the repository.
- The test copy is retired before Gate 0 (M8-20 to M8-22; M8-09, RC-018), and so is v1's review copy at
  `radcore-erp.vercel.app`.

**Plan.** Vercel's free Hobby plan is for personal, non-commercial use. A company's test copy may not fit that,
so Sarthak should check Vercel's terms, or use the Pro plan.

Until the test copy replaces it, the Vercel Git integration (Sarthak's team) still builds this repository's
branches, and its red check on PRs is noise.

## Consequences

- Development, CI and production run the same processes against the same PostgreSQL major version and the same
  file API. A job, an upload or a rate limit that works in one works in the others.
- The owner credential exists only in CI for the length of a migration, and the server's own role can't reach it.
  A compromise of `web` reaches no AWS credential.
- A bad release is undone by redeploying the previous image. No data is lost, because migrations are always
  compatible with the release before.
- The Hyderabad copies are tested by a canary, not assumed.
- The first-week AWS work (account, RDS, S3, KMS, roles, SES, Secrets Manager, monitoring) belongs to the devops
  session from the end of M1 (M8-01 to M8-07).

## Alternatives considered

- **Running jobs inside the API process** (v1's way). That's one process fewer, but a slow job holds up requests and
  a second API copy would run the schedule twice. Rejected (ADR-001 §8).
- **Files in the database.** It avoids S3 in development, but files grow to most of the data and slow backups
  (Hosting recommendation §2). Rejected; an S3-compatible dev server gives development the same API.
- **Migrations in a container on the server** (this ADR's first draft). The owner credential would sit on the
  server and be readable through its role. Rejected; CI runs them through a tunnel.
- **A transaction-mode pooler (PgBouncer, RDS Proxy pinned).** It isn't needed at 20 to 150 users, and it drops the
  connection-level timeouts. Revisit with Option 2 at scale.
