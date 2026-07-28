# Database-backed integration tests

Some suites (currently the dietitian-management migration suite) assert against a
real Postgres instead of a mock. They are **opt-in**: without configuration they
skip with a message naming the missing prerequisite, so `npm test` stays green on
a machine with no database.

## Never point these at the live project

The migration suite executes DDL and creates/rolls back fixture rows. `.env.local`
is deliberately **not** loaded by the harness so the shared Supabase project can
never be hit by accident. Use a scratch database:

- a local Postgres (`docker run -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:15`), or
- a Supabase branch / throwaway project, or
- `supabase start` (local stack).

## Configuration

| Variable | Purpose |
| --- | --- |
| `DIETITIAN_TEST_DATABASE_URL` | Postgres connection string. Required. |
| `DIETITIAN_TEST_DB_ALLOW_REMOTE` | Set to `1` to allow a non-localhost host. Guard against accidentally naming the production host. |

`psql` must be on `PATH` — the harness shells out to it so the `scripts/*.sql`
files run byte-for-byte as they would in production.

## Running

PowerShell:

```powershell
$env:DIETITIAN_TEST_DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/arogya_test"
npx vitest run src/test/dietitian/migration.integration.test.ts
```

bash:

```bash
DIETITIAN_TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/arogya_test \
  npx vitest run src/test/dietitian/migration.integration.test.ts
```

## Prerequisite schema

The dietitian migration is additive: it extends `users` and `customer_profiles`
and reads `admin_health_logs`, `customer_health_logs`, `kit_daily_logs`,
`clinics`, `franchises` and `subscriptions`. The scratch database therefore needs
the pre-feature baseline schema before the suite can apply the migration. Restore
it from a schema-only dump of the shared project:

```bash
pg_dump --schema-only --no-owner --no-privileges "$SOURCE_DB_URL" > baseline.sql
psql "$DIETITIAN_TEST_DATABASE_URL" -f baseline.sql
```

The suite verifies the baseline objects it needs up front and skips with a clear
message listing anything missing, rather than failing.
