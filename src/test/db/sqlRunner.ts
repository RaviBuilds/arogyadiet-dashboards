/**
 * Minimal SQL harness for database-backed integration tests.
 *
 * The repository has no DB test harness, so this establishes the smallest one
 * that can execute the real `scripts/*.sql` migration files verbatim: shell out
 * to `psql`. Nothing is mocked — the assertions run against a real Postgres.
 *
 * Deliberately does NOT read `.env.local`: that file points at the shared/live
 * Supabase project and migrations must never be applied there. A test database
 * is opted into explicitly through `TEST_DATABASE_URL` (or the original
 * `DIETITIAN_TEST_DATABASE_URL` alias), and a remote host additionally requires
 * `TEST_DB_ALLOW_REMOTE=1` (or `DIETITIAN_TEST_DB_ALLOW_REMOTE=1`).
 *
 * See `src/test/db/README.md` for how to run these suites.
 */
import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Feature-neutral names, since more than one spec now uses this harness. The
 * `DIETITIAN_*` names stay supported as aliases so already-documented local
 * setups keep working.
 */
export const DB_URL_ENV = "TEST_DATABASE_URL";
export const ALLOW_REMOTE_ENV = "TEST_DB_ALLOW_REMOTE";
export const DB_URL_ENV_ALIASES = [DB_URL_ENV, "DIETITIAN_TEST_DATABASE_URL"] as const;
export const ALLOW_REMOTE_ENV_ALIASES = [
  ALLOW_REMOTE_ENV,
  "DIETITIAN_TEST_DB_ALLOW_REMOTE",
] as const;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "host.docker.internal"]);

export type SqlOutcome =
  | { ok: true; stdout: string }
  | { ok: false; message: string };

export function databaseUrl(): string | undefined {
  for (const name of DB_URL_ENV_ALIASES) {
    const trimmed = process.env[name]?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

function remoteAllowed(): boolean {
  return ALLOW_REMOTE_ENV_ALIASES.some((name) => process.env[name] === "1");
}

function psqlAvailable(): boolean {
  try {
    execFileSync("psql", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * `null` when the harness can run; otherwise a human-readable reason the suite
 * is being skipped. Suites embed this in their name so the skip is
 * self-describing in the test output.
 */
export function harnessSkipReason(): string | null {
  const url = databaseUrl();
  if (!url) {
    return `${DB_URL_ENV} is not set (point it at a scratch/branch Postgres — never the live project)`;
  }
  const host = hostOf(url);
  if (host === null) {
    return `${DB_URL_ENV} is not a parseable postgres connection URL`;
  }
  if (!LOCAL_HOSTS.has(host) && !remoteAllowed()) {
    return `${DB_URL_ENV} points at the remote host "${host}"; set ${ALLOW_REMOTE_ENV}=1 to confirm it is a throwaway database`;
  }
  if (!psqlAvailable()) {
    return "the `psql` client is not on PATH";
  }
  return null;
}

async function runPsql(args: string[]): Promise<SqlOutcome> {
  const url = databaseUrl();
  if (!url) return { ok: false, message: `${DB_URL_ENV} is not set` };
  try {
    const { stdout } = await execFileAsync(
      "psql",
      [url, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-P", "pager=off", ...args],
      { maxBuffer: 32 * 1024 * 1024 }
    );
    return { ok: true, stdout };
  } catch (error) {
    const err = error as { stderr?: string; stdout?: string; message?: string };
    return {
      ok: false,
      message: (err.stderr || err.stdout || err.message || "unknown psql failure").trim(),
    };
  }
}

async function withTempSqlFile(
  sql: string,
  run: (file: string) => Promise<SqlOutcome>
): Promise<SqlOutcome> {
  const dir = mkdtempSync(path.join(tmpdir(), "arogya-sql-"));
  const file = path.join(dir, "statement.sql");
  writeFileSync(file, sql, "utf8");
  try {
    return await run(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Execute an existing `.sql` file (used to apply the migration scripts verbatim). */
export function execSqlFile(filePath: string): Promise<SqlOutcome> {
  return runPsql(["-f", filePath]);
}

/** Execute an ad-hoc SQL script. Written to a temp file to avoid shell quoting. */
export function execSql(sql: string): Promise<SqlOutcome> {
  return withTempSqlFile(sql, (file) => runPsql(["-f", file]));
}

/**
 * Run a SELECT and return its rows as parsed JSON. The query is wrapped in
 * `json_agg` so the result crosses the process boundary as a single value.
 */
export async function queryJson<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  const stripped = sql.trim().replace(/;\s*$/, "");
  const wrapped = `SELECT coalesce(json_agg(__q), '[]'::json)::text FROM (\n${stripped}\n) __q;`;
  const outcome = await withTempSqlFile(wrapped, (file) => runPsql(["-A", "-t", "-f", file]));
  if (!outcome.ok) {
    throw new Error(`query failed: ${outcome.message}`);
  }
  return JSON.parse(outcome.stdout.trim() || "[]") as T[];
}
