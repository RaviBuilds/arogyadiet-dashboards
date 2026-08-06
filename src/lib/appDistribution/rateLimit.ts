import { createHash } from "crypto";

/**
 * Maximum number of download grants per client IP per app within the rate-limit window.
 * @requirement 7.1, 7.2
 */
export const DOWNLOAD_GRANT_LIMIT = 5;

/**
 * Duration of the fixed rate-limit window in seconds (600 seconds = 10 minutes).
 * @requirement 7.1, 7.4
 */
export const DOWNLOAD_WINDOW_SECONDS = 600;

/**
 * Sentinel hash used for unidentifiable clients (null IP).
 * This ensures unidentifiable clients share one bucket rather than escaping the limit.
 * @requirement 7.7
 */
const SENTINEL_IP_HASH = createHash("sha256")
  .update("<unidentified-client>")
  .digest("hex");

/**
 * Calculates the remaining seconds until the fixed rate-limit window closes.
 * Returns whole seconds (floored), never negative.
 *
 * @param windowStartedAtMs - The epoch milliseconds when the window started
 * @param nowMs - The current epoch milliseconds
 * @returns Whole seconds until the window closes, or 0 if already closed
 *
 * @requirement 7.3
 */
export function retryAfterSeconds(
  windowStartedAtMs: number,
  nowMs: number,
): number {
  const windowEndMs = windowStartedAtMs + DOWNLOAD_WINDOW_SECONDS * 1000;
  const remainingMs = windowEndMs - nowMs;

  // Never return negative - if window has closed, return 0
  if (remainingMs <= 0) {
    return 0;
  }

  // Return whole seconds (floor)
  return Math.floor(remainingMs / 1000);
}

/**
 * Hashes a client IP address using SHA-256.
 * Returns a constant sentinel hash when ip is null so that unidentifiable clients
 * share one bucket rather than escaping the limit.
 *
 * @param ip - The client IP address, or null if unidentifiable
 * @returns Lowercase hexadecimal SHA-256 hash of the IP, or sentinel hash for null
 *
 * @requirement 7.7
 */
export function hashClientIp(ip: string | null): string {
  if (ip === null || ip === undefined) {
    return SENTINEL_IP_HASH;
  }

  return createHash("sha256").update(ip).digest("hex");
}

/**
 * Resolves the client IP address from request headers.
 * Extracts the first entry (leftmost, set by trusted proxy) from x-forwarded-for,
 * trimmed of whitespace.
 *
 * @param headers - The request headers
 * @returns The client IP address, or null if not present/empty
 *
 * @requirement 7.6
 */
export function resolveClientIp(headers: Headers): string | null {
  const forwardedFor = headers.get("x-forwarded-for");

  if (!forwardedFor) {
    return null;
  }

  // x-forwarded-for format: client, proxy1, proxy2, ...
  // The first entry (leftmost) is set by the trusted proxy and represents the client IP
  const firstEntry = forwardedFor.split(",")[0];

  if (!firstEntry) {
    return null;
  }

  const trimmed = firstEntry.trim();

  if (trimmed === "") {
    return null;
  }

  return trimmed;
}
