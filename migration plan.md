# Lögbrunnur migration plan: Railway → netcup VPS + Coolify

## Goal

Move Lögbrunnur from Railway Hobby to a self-managed netcup VPS without rebuilding or re-ingesting the legal corpus.

Target setup:

- netcup VPS Lite 2-class server
- Ubuntu 24.04 LTS
- Coolify for application and database management
- PostgreSQL 16
- Lögbrunnur deployed as a Next.js application
- PostgreSQL kept private on the VPS
- HTTPS handled by Coolify's reverse proxy
- Weekly ingestion recreated as a scheduled task
- Off-site database backups enabled before Railway is decommissioned

The migration should preserve the existing PostgreSQL database, including judgments, acts, provisions, citation links, ingestion cursors, materialized search vectors, indexes, functions and triggers.

---

## Current state

Lögbrunnur currently runs on Railway and uses PostgreSQL as both the primary datastore and the default search backend.

Important current characteristics:

- approximately 42,904 judgments are stored
- the database is currently approximately 2.3 GB
- `Document.full_text` is stored in PostgreSQL
- `Document.search_vector` is materialized and indexed for full-text search
- citation relationships are stored in `case_provision_links` and `case_act_links`
- PostgreSQL full-text search is the default search provider
- Meilisearch is optional and is not required for the migration
- Railway currently runs a weekly ingestion job
- Railway currently runs `npm run db:deploy` before application deployment

The existing `docker-compose.yml` is useful for local development, but it should **not** be deployed unchanged to a public VPS because it publishes PostgreSQL on port 5432 and Meilisearch on port 7700.

Only the web application/reverse proxy should be publicly reachable.

---

# Migration strategy

The migration is divided into five stages:

1. Provision the VPS and Coolify
2. Create the new PostgreSQL database
3. Copy the Railway database into the VPS
4. Deploy and test Lögbrunnur against the new database
5. Cut over traffic and enable backups

Railway should remain online until the new deployment has been fully verified.

---

# Phase 1 — provision the netcup VPS

## 1. Create the server

Recommended baseline:

- x86 VPS
- 8 GB RAM
- at least 4 vCPU
- at least 80 GB SSD
- Ubuntu 24.04 LTS

The intended server is the netcup VPS Lite 2-class plan, which provides substantially more disk space than Railway Hobby and enough RAM to comfortably run the current Next.js application, PostgreSQL and ingestion workload on one machine.

Do not cancel Railway at this stage.

## 2. Connect to the server

From a local terminal:

```bash
ssh root@SERVER_IP
```

Immediately:

- update system packages
- configure SSH keys if not already done
- disable password login once key access has been confirmed
- keep only necessary ports exposed

Example:

```bash
apt update && apt upgrade -y
```

Do not manually expose PostgreSQL or Meilisearch to the internet.

---

# Phase 2 — install Coolify

Install Coolify on the new server:

```bash
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
```

Once installation finishes:

1. Open the Coolify interface in the browser.
2. Create the administrator account immediately.
3. Create a project named `Lögbrunnur`.

Coolify will be used to manage:

- the Next.js application
- PostgreSQL
- environment variables
- domains and TLS certificates
- scheduled ingestion jobs
- database backups

---

# Phase 3 — create PostgreSQL 16 in Coolify

Inside Coolify:

1. Open the `Lögbrunnur` project.
2. Add a PostgreSQL resource.
3. Use PostgreSQL 16.
4. Create a dedicated database and user, for example:

```text
database: logbrunnur
user:     logbrunnur
password: generated strong password
```

The database should only be reachable from the private Coolify/Docker network.

Do **not** expose port 5432 publicly.

The application will eventually receive a `DATABASE_URL` similar to:

```text
postgresql://logbrunnur:PASSWORD@INTERNAL_HOST:5432/logbrunnur
```

Store the actual value only in Coolify secrets/environment variables.

---

# Phase 4 — prepare the Railway database migration

## 1. Freeze ingestion during the final migration window

Before creating the final production dump, temporarily disable or pause Railway's scheduled ingestion service.

This prevents the Railway database from changing after the dump is taken and avoids having two databases with different case counts.

The web application can remain online during most of the migration.

## 2. Obtain the Railway public PostgreSQL URL

In Railway, open the PostgreSQL service and enable/copy the external connection URL.

Treat this URL as a password/secret.

Do not commit it to GitHub, paste it into documentation or leave it in shell history unnecessarily.

## 3. Create a portable PostgreSQL dump

On the new VPS:

```bash
mkdir -p /root/logbrunnur-migration
cd /root/logbrunnur-migration
```

Read the Railway URL into an environment variable without echoing it:

```bash
read -rsp "Paste Railway DATABASE_PUBLIC_URL: " RAILWAY_URL
echo
```

Create a PostgreSQL custom-format dump using PostgreSQL 16 tooling:

```bash
docker run --rm \
  -e DATABASE_PUBLIC_URL="$RAILWAY_URL" \
  -v "$PWD:/backup" \
  postgres:16 \
  sh -c 'pg_dump "$DATABASE_PUBLIC_URL" \
    --format=custom \
    --no-owner \
    --no-acl \
    --file=/backup/logbrunnur.dump'
```

Then remove the secret from the shell environment:

```bash
unset RAILWAY_URL
```

Verify that the dump exists:

```bash
ls -lh /root/logbrunnur-migration/logbrunnur.dump
```

Optionally validate the archive structure:

```bash
docker run --rm \
  -v /root/logbrunnur-migration:/backup \
  postgres:16 \
  pg_restore --list /backup/logbrunnur.dump | head
```

Do not delete or alter the Railway database after taking the dump.

---

# Phase 5 — restore the dump into the new PostgreSQL instance

Use Coolify's PostgreSQL restore/import functionality if available for the database resource.

The dump is located at:

```text
/root/logbrunnur-migration/logbrunnur.dump
```

The restore must preserve:

- tables
- rows
- indexes
- extensions where supported
- functions
- triggers
- materialized `search_vector` values
- ingestion cursors
- citation relationships

If a manual restore is required, use `pg_restore` against the new database rather than re-running ingestion.

After restore, verify the database before connecting the application.

## Verification queries

### Judgment count

```sql
SELECT COUNT(*) FROM "Document";
```

Expected baseline at the time this plan was written:

```text
approximately 42,904
```

The exact number should match Railway at the moment the final dump was taken.

### Database size

```sql
SELECT pg_size_pretty(pg_database_size(current_database()));
```

The restored database does not need to be byte-for-byte identical because PostgreSQL may lay out pages differently after restore, but it should be in the same general range.

### Core table counts

Run these on both Railway and the new database and compare them:

```sql
SELECT COUNT(*) FROM "Document";
SELECT COUNT(*) FROM acts;
SELECT COUNT(*) FROM provisions;
SELECT COUNT(*) FROM provision_paragraphs;
SELECT COUNT(*) FROM case_provision_links;
SELECT COUNT(*) FROM case_act_links;
SELECT COUNT(*) FROM chapters;
SELECT COUNT(*) FROM "Source";
SELECT COUNT(*) FROM ingest_cursors;
```

If any large table count differs, stop and investigate before cutover.

### Search vector sanity check

```sql
SELECT
  COUNT(*) AS documents,
  COUNT(search_vector) AS documents_with_search_vector
FROM "Document";
```

The two counts should normally match, excluding any intentional exceptional rows.

### Extension check

```sql
SELECT extname
FROM pg_extension
WHERE extname IN ('pg_trgm', 'unaccent');
```

The search setup depends on PostgreSQL extensions used by `prisma/sql/setup-search.sql`.

---

# Phase 6 — deploy the Lögbrunnur application in Coolify

## 1. Add the repository

Create a new application in Coolify from:

```text
https://github.com/pesimaggi/judgements
```

Use:

```text
branch: main
```

The project currently targets Node 20+ and is a Next.js application.

## 2. Build configuration

The existing Railway deployment uses Nixpacks, so Nixpacks is a natural first choice in Coolify as well.

Expected application configuration:

```text
build command: npm run build
start command: npm start
internal port: 3000
```

The application itself should not require a major architectural change for the migration.

## 3. Environment variables

Copy relevant application variables from Railway into Coolify.

Do **not** copy Railway's old `DATABASE_URL`.

Set the new internal PostgreSQL URL instead.

Minimum expected production variables include:

```text
DATABASE_URL=postgresql://...
NODE_ENV=production
SEARCH_PROVIDER=postgres
```

Also migrate any customized ingestion settings, such as:

```text
INGEST_DELAY_MS
INGEST_USER_AGENT
INGEST_STOP_AFTER_KNOWN
INGEST_RETRY_BASE_MS
INGEST_MAX_PAGES
```

Do not commit production secrets to the repository.

---

# Phase 7 — deployment safety change

## Current concern

The repository currently defines:

```text
npm run db:deploy
```

as:

```bash
prisma db push --accept-data-loss && tsx prisma/setup-search.ts
```

Railway currently runs `npm run db:deploy` as a pre-deploy command.

For an increasingly valuable production legal database, automatically accepting destructive schema changes on every deploy is risky.

## Migration rule

Do **not** run `npm run db:deploy` automatically against the newly restored production database during the migration.

The restored dump already contains the existing database schema, indexes, vectors, functions and triggers.

A safer long-term schema strategy should be implemented separately, preferably using reviewed Prisma migrations rather than `db push --accept-data-loss`.

Until that is done, schema changes should be deliberate, backed up and reviewed before they are applied to production.

---

# Phase 8 — recreate the weekly ingestion job

Railway currently runs the ingestion workload weekly.

Recreate it in Coolify as a scheduled task.

Schedule:

```cron
0 6 * * 1
```

Command:

```bash
INGEST_MODE=recent INGEST_MAX_PAGES=40 npm run ingest -- --adapter=icelandic-courts && npm run ingest -- --adapter=lagasafn && npm run ingest -- --adapter=citations
```

Do **not** prepend `npm run db:deploy` to the scheduled ingestion job.

Database schema deployment and legal-source ingestion should be separate operations.

After the first scheduled run on netcup, verify:

- the job starts successfully
- new documents can be written
- unchanged documents are skipped
- citation scanning completes
- `IngestionRun` receives a new record
- the admin ingestion page shows the run correctly

---

# Phase 9 — domain and HTTPS

Before changing production DNS, Coolify can expose the application on a temporary/test hostname if desired.

Once the application and database have been verified, point the production DNS record to the netcup VPS.

Typical DNS setup:

```text
A     app.example.is     SERVER_IP
```

Use the actual Lögbrunnur production domain/subdomain.

Configure that domain in Coolify and allow its reverse proxy to provision HTTPS.

Only the following should normally be publicly reachable:

```text
80/tcp
443/tcp
```

SSH should also remain reachable on the chosen administrative port.

PostgreSQL and Meilisearch should remain internal-only.

---

# Phase 10 — application acceptance tests

Before turning off Railway, perform a full smoke test against the netcup deployment.

## Application tests

- [ ] front page loads
- [ ] court source selection works
- [ ] keyword search works
- [ ] exact case-number search works
- [ ] relevance sorting works
- [ ] newest/oldest sorting works
- [ ] snippets are generated
- [ ] case summaries load
- [ ] full judgment page opens
- [ ] search-within-document works
- [ ] related cases work
- [ ] `/log` loads
- [ ] act search works
- [ ] individual act pages load
- [ ] provision search works
- [ ] provision → citing judgments works
- [ ] subject tags work
- [ ] admin ingestion page loads

## Database tests

- [ ] `Document` count matches Railway
- [ ] acts count matches Railway
- [ ] provisions count matches Railway
- [ ] provision paragraph count matches Railway
- [ ] case provision link count matches Railway
- [ ] case act link count matches Railway
- [ ] search vectors are populated
- [ ] `pg_trgm` exists
- [ ] `unaccent` exists

## Operational tests

- [ ] application survives a restart
- [ ] PostgreSQL survives a restart
- [ ] Docker/Coolify volumes persist
- [ ] HTTPS is valid
- [ ] logs are visible in Coolify
- [ ] scheduled ingestion can run manually
- [ ] backup can be created
- [ ] backup can be downloaded/read from off-site storage

---

# Phase 11 — cutover procedure

The final production cutover should be short and controlled.

## Before cutover

1. Pause Railway scheduled ingestion.
2. Take a final Railway database dump.
3. Restore that final dump into netcup PostgreSQL if the earlier migration was only a rehearsal.
4. Verify core table counts.
5. Deploy the application against the final restored database.
6. Run smoke tests.

## Cut over

1. Update the production DNS A record to the netcup VPS.
2. Confirm HTTPS is active.
3. Test production through the real domain.
4. Keep Railway running temporarily as a rollback target, but prevent new writes/ingestion there.

Do not immediately delete the Railway project.

---

# Rollback plan

If the new server has a serious problem during cutover:

1. Stop writes/ingestion on netcup.
2. Point DNS back to Railway.
3. Re-enable the Railway application if necessary.
4. Re-enable Railway ingestion only after deciding Railway is again the authoritative production database.

Avoid allowing both environments to ingest independently at the same time.

Once both databases have accepted different writes, rollback becomes a data reconciliation problem rather than a simple DNS change.

---

# Phase 12 — backups

Backups are mandatory before Railway is decommissioned.

The application code can always be recreated from GitHub; the legal corpus and citation graph cannot be recreated nearly as cheaply.

At minimum configure:

- daily PostgreSQL backup
- encrypted/off-site copy to S3-compatible object storage
- retention policy with more than one restore point

Suggested pattern:

```text
live PostgreSQL
      |
      v
nightly pg_dump
      |
      v
off-site S3-compatible storage
```

A backup is only useful if it can be restored.

Perform at least one test restore after the backup system has been configured.

Recommended retention to start with:

```text
7 daily backups
4 weekly backups
3 monthly backups
```

This can be adjusted later as database size and storage cost change.

---

# Phase 13 — post-migration cleanup

Only after the new production environment has run successfully for a reasonable period:

- confirm scheduled ingestion has completed successfully at least once
- confirm database backups are being produced off-site
- verify the application is stable under normal use
- record the final netcup/Coolify architecture in project documentation
- remove or archive Railway-specific deployment configuration if it is no longer required
- cancel Railway resources only when there is no remaining rollback dependency

Do not delete the final Railway dump.

Store one archival copy outside the VPS.

---

# Recommended follow-up improvements

These are not required to complete the migration, but they should be considered after the move.

## 1. Replace destructive production schema deployment

Current:

```bash
prisma db push --accept-data-loss
```

Preferred direction:

```text
reviewed Prisma migrations
        ↓
backup
        ↓
explicit production migration
        ↓
post-migration verification
```

## 2. Add server monitoring

Monitor at least:

- disk usage
- RAM usage
- CPU usage
- PostgreSQL availability
- application health
- backup failures
- ingestion failures

Disk alerts are especially important because PostgreSQL can fail badly when the filesystem becomes completely full.

## 3. Add disk-space thresholds

Suggested alerts:

```text
70% disk used → warning
85% disk used → urgent
90%+          → stop large ingestion/backfill jobs and investigate
```

## 4. Keep PostgreSQL private

Do not expose PostgreSQL directly to the public internet merely for convenience.

For manual database administration, prefer one of:

- Coolify's database terminal
- SSH tunnelling
- temporary tightly controlled access

## 5. Evaluate object storage later

There is no immediate requirement to move judgment text out of PostgreSQL.

Current measurements show that the materialized search representation itself is a major part of database storage, so moving only `full_text` to object storage would not eliminate most PostgreSQL usage.

Object storage may still become useful later for:

- original PDFs
- source HTML
- historical snapshots
- exported datasets
- AI/RAG artifacts
- backup archives

---

# Target production architecture

```text
                         Internet
                            |
                         HTTPS
                            |
                            v
                  +-------------------+
                  | Coolify proxy     |
                  +---------+---------+
                            |
                            v
                  +-------------------+
                  | Lögbrunnur        |
                  | Next.js / Node    |
                  +---------+---------+
                            |
                     private network
                            |
                            v
                  +-------------------+
                  | PostgreSQL 16     |
                  | judgments         |
                  | laws              |
                  | citations         |
                  | search vectors    |
                  +---------+---------+
                            |
                    scheduled backup
                            |
                            v
                   off-site object
                       storage

        All hosted initially on one netcup VPS.
```

Optional future services such as Meilisearch or an AI/RAG service can be added later without changing the core migration described here.

---

# Definition of done

The Railway → netcup migration is complete when all of the following are true:

- [ ] netcup VPS is provisioned and secured
- [ ] Coolify is installed and accessible
- [ ] PostgreSQL 16 is running privately
- [ ] final Railway database dump is restored
- [ ] core row counts match Railway
- [ ] application is deployed and connected to the new database
- [ ] search works correctly
- [ ] production domain points to netcup
- [ ] HTTPS works
- [ ] weekly ingestion runs on netcup
- [ ] off-site database backups are active
- [ ] one backup restore has been tested
- [ ] Railway ingestion is disabled
- [ ] Railway remains available only until the rollback window is over
- [ ] final Railway dump is retained off-site
- [ ] Railway resources are cancelled only after stable operation is confirmed
