# Database-backed integration tests

Some suites assert against a real Postgres instead of a mock. They are
**opt-in**: without configuration they skip with a message naming the missing
prerequisite, so `npm test` stays green on a machine with no database.

| Suite | Subject |
| --- | --- |
| `src/test/dietitian/migration.integration.test.ts` | `create-dietitian-management.sql` + its RLS script |
| `src/test/dietitian/rls-scope.integration.test.ts`, `concurrency-and-auth.integration.test.ts` | dietitian RLS and RPC behaviour |
| `src/test/accommodation/migration.integration.test.ts` | `create-stay-payment-lifecycle.sql` — idempotence and the four constraints it installs |
| `src/test/accommodation/rpc.integration.test.ts` | `record_stay_payment_transaction` / `finalize_stay_checkout` RPCs — concurrency, refund/shared-payment/status rejections, and balance-formula parity with `deriveStayBalance` |

Each of those files also carries a "script guarantees" half that reads the
`scripts/*.sql` text directly. That half always runs, database or not.

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
| `TEST_DATABASE_URL` | Postgres connection string. Required. `DIETITIAN_TEST_DATABASE_URL` is accepted as an alias. |
| `TEST_DB_ALLOW_REMOTE` | Set to `1` to allow a non-localhost host. Guard against accidentally naming the production host. `DIETITIAN_TEST_DB_ALLOW_REMOTE` is accepted as an alias. |

`psql` must be on `PATH` — the harness shells out to it so the `scripts/*.sql`
files run byte-for-byte as they would in production.

## Running

PowerShell:

```powershell
$env:TEST_DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/arogya_test"
npx vitest run src/test/dietitian/migration.integration.test.ts
npx vitest run src/test/accommodation/migration.integration.test.ts
```

bash:

```bash
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/arogya_test \
  npx vitest run src/test/accommodation/migration.integration.test.ts
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

The accommodation payment lifecycle migration is additive over `stay_entries`
and `payments`, so its scratch database needs `users`, `customer_profiles`,
`payments` and `stay_entries` — i.e. the baseline dump plus
`scripts/create-accommodation-tables.sql`:

```bash
psql "$TEST_DATABASE_URL" -f baseline.sql
psql "$TEST_DATABASE_URL" -f scripts/create-accommodation-tables.sql
```

That suite fingerprints the catalog (`information_schema.columns`,
`pg_constraint`, `pg_indexes`, triggers, functions, the view) before and after
each of two passes, and digests `payments` / `stay_entries` rows with the
newly-added columns projected away, so an accidental data rewrite shows up as a
digest mismatch. Every constraint probe runs inside `BEGIN … ROLLBACK`.
