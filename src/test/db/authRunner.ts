/**
 * Minimal Supabase Auth harness for auth-backed integration tests.
 *
 * Mirrors `sqlRunner.ts`'s posture exactly, for the same reason: this
 * repository's `.env.local` points at the shared/live Supabase project, and an
 * auth test that creates/bans/signs-in users must never be able to touch it by
 * accident. A test project is opted into explicitly through
 * `DIETITIAN_TEST_SUPABASE_URL` (+ service-role and anon keys), and a
 * non-`*.supabase.co`-local-emulator host additionally requires
 * `DIETITIAN_TEST_SUPABASE_ALLOW_REMOTE=1`.
 *
 * `.env.local` is deliberately NOT read here.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const AUTH_URL_ENV = "DIETITIAN_TEST_SUPABASE_URL";
export const AUTH_SERVICE_KEY_ENV = "DIETITIAN_TEST_SUPABASE_SERVICE_ROLE_KEY";
export const AUTH_ANON_KEY_ENV = "DIETITIAN_TEST_SUPABASE_ANON_KEY";
export const AUTH_ALLOW_REMOTE_ENV = "DIETITIAN_TEST_SUPABASE_ALLOW_REMOTE";

/** Local Supabase CLI / emulator hosts that never require the remote opt-in. */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "kong", "host.docker.internal"]);

function envValue(name: string): string | undefined {
  const trimmed = process.env[name]?.trim();
  return trimmed ? trimmed : undefined;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * `null` when the harness can run; otherwise a human-readable reason the
 * suite is being skipped. Suites embed this in their name so the skip is
 * self-describing in the test output — same convention as
 * `sqlRunner.harnessSkipReason`.
 */
export function authHarnessSkipReason(): string | null {
  const url = envValue(AUTH_URL_ENV);
  const serviceKey = envValue(AUTH_SERVICE_KEY_ENV);
  const anonKey = envValue(AUTH_ANON_KEY_ENV);

  const missing: string[] = [];
  if (!url) missing.push(AUTH_URL_ENV);
  if (!serviceKey) missing.push(AUTH_SERVICE_KEY_ENV);
  if (!anonKey) missing.push(AUTH_ANON_KEY_ENV);
  if (missing.length > 0) {
    return `${missing.join(", ")} not set (point at a scratch/local Supabase project — never the live one)`;
  }

  const host = hostOf(url!);
  if (host === null) {
    return `${AUTH_URL_ENV} is not a parseable URL`;
  }
  if (!LOCAL_HOSTS.has(host) && envValue(AUTH_ALLOW_REMOTE_ENV) !== "1") {
    return `${AUTH_URL_ENV} points at the remote host "${host}"; set ${AUTH_ALLOW_REMOTE_ENV}=1 to confirm it is a throwaway project`;
  }
  return null;
}

/** Admin (service-role) client against the opted-in test Supabase project. */
export function createTestAdminClient(): SupabaseClient {
  return createClient(envValue(AUTH_URL_ENV)!, envValue(AUTH_SERVICE_KEY_ENV)!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Anon-key client against the opted-in test Supabase project — used to attempt sign-in. */
export function createTestAnonClient(): SupabaseClient {
  return createClient(envValue(AUTH_URL_ENV)!, envValue(AUTH_ANON_KEY_ENV)!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
