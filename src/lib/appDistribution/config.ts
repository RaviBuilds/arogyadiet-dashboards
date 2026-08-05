/**
 * Environment resolution for the APK distribution feature.
 *
 * Spec: app-apk-distribution — Task 1.2
 * Requirements: 14.1, 14.2, 14.7
 *
 * Every environment variable this feature depends on is read in EXACTLY one
 * place, here. Two consequences the design relies on:
 *
 *  - Rotation (Req 14.7) is a Vercel environment change plus a redeploy. No
 *    code edit, because no other module hardcodes a `process.env` lookup.
 *  - An absent variable is a VALUE (`null`), never a thrown error. Each caller
 *    then degrades in the way its own requirement specifies: the download page
 *    suppresses the control (Req 5.12), the grant endpoint answers 503
 *    (Req 14.8), the QR block omits itself (Req 12.7). A module-load-time throw
 *    would instead take out the whole route, which is exactly the blast radius
 *    those requirements are written to avoid.
 *
 * `TURNSTILE_SECRET_KEY` is deliberately NOT prefixed `NEXT_PUBLIC_`, so it
 * cannot be inlined into a client bundle (Req 14.4). The two `NEXT_PUBLIC_`
 * variables are safe to read on either side; this module therefore carries no
 * `server-only` marker. The modules that consume the secret
 * (`turnstile.ts`, `storage.ts`) carry it instead.
 */

/**
 * Reads an environment variable, collapsing "absent" and "present but blank"
 * into the same `null` result.
 *
 * A variable set to `""` in a Vercel dashboard is the most common
 * misconfiguration in practice, and treating it as "configured" would produce a
 * confusing downstream failure (an empty Turnstile site key renders a widget
 * that never resolves) instead of the clear notice each requirement asks for.
 */
function readEnv(name: string): string | null {
  const raw = process.env[name];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Log-once guard per variable name.
 *
 * The absent-configuration branches sit on a page render path (Req 5.12, 12.7),
 * so an unguarded `console.warn` would emit one line per request. Mirrors the
 * `missingConfigLogged` pattern in `src/lib/onesignal/server.ts`.
 */
const warnedFor = new Set<string>();

function warnMissingOnce(name: string, consequence: string): void {
  if (warnedFor.has(name)) return;
  warnedFor.add(name);
  console.warn(
    `[appDistribution] ${name} is not set — ${consequence}`,
  );
}

/**
 * Public Turnstile site key (Req 14.1).
 *
 * `null` means the Download_Page must suppress the download control and render
 * the temporarily-unavailable notice (Req 5.12).
 */
export function resolveTurnstileSiteKey(): string | null {
  const value = readEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY");
  if (value === null) {
    warnMissingOnce(
      "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
      "app download controls are disabled.",
    );
  }
  return value;
}

/**
 * Private Turnstile secret key (Req 14.2).
 *
 * `null` means the Download_Grant_Endpoint must answer 503 and record a
 * server-side error (Req 14.8). Server-side callers only — see the module
 * comment on why this is not a `NEXT_PUBLIC_` variable.
 */
export function resolveTurnstileSecretKey(): string | null {
  return readEnv("TURNSTILE_SECRET_KEY");
}

/**
 * Absolute origin used to build the Download_Page URLs that QR codes encode.
 *
 * `null` means every QR_Block omits itself (Req 12.7). A trailing slash is
 * stripped so callers can join paths without producing a double slash — a
 * cosmetic difference to a human, but a different string inside a QR code,
 * and therefore a different scanned URL.
 */
export function resolveDownloadBaseUrl(): string | null {
  const value = readEnv("NEXT_PUBLIC_APP_DOWNLOAD_BASE_URL");
  if (value === null) {
    warnMissingOnce(
      "NEXT_PUBLIC_APP_DOWNLOAD_BASE_URL",
      "app download QR codes are omitted.",
    );
    return null;
  }
  return value.replace(/\/+$/, "");
}
