// src/repositories/appDownloadThrottleRepository.ts
// Thin wrapper over the claim_app_download_grant RPC for atomic rate-limit claims.
//
// On RPC failure, this repository fails open (returns granted: true). The reasoning:
// Turnstile has already established a human is present, and a throttle-table outage
// should not stop legitimate installs. The cost of failing open is bounded by the
// challenge that already passed; the cost of failing closed is a total distribution
// outage from a non-critical table.
//
// Requirements: 7.1, 7.2

import { createAdminClient } from "@/lib/supabase/admin";
import type { AppSlug } from "@/lib/appDistribution/slug";
import {
  DOWNLOAD_GRANT_LIMIT,
  DOWNLOAD_WINDOW_SECONDS,
} from "@/lib/appDistribution/rateLimit";

/**
 * Result of a download grant claim.
 */
export interface GrantClaim {
  /** Whether the grant was allowed */
  granted: boolean;
  /** Seconds until the rate-limit window resets (0 when granted) */
  retryAfterSeconds: number;
}

/**
 * Claims a download grant for a client IP and app slug.
 *
 * This function wraps the `claim_app_download_grant` RPC which performs an
 * atomic check-and-increment under the primary key's row lock. This ensures
 * that concurrent requests from the same IP serialize and the limit holds exactly.
 *
 * On RPC failure, returns `{ granted: true, retryAfterSeconds: 0 }` (fail-open).
 * The failure is logged as an error so the outage is visible.
 *
 * @param ipHash - SHA256 hash of the client IP address
 * @param slug - App identifier ('customer' or 'rider')
 * @returns Grant claim result with granted status and retry-after seconds
 *
 * @requirement 7.1, 7.2
 */
export async function claimDownloadGrant(
  ipHash: string,
  slug: AppSlug,
): Promise<GrantClaim> {
  const supabase = createAdminClient();

  const { data, error } = await supabase.rpc("claim_app_download_grant", {
    p_ip_hash: ipHash,
    p_app_slug: slug,
    p_limit: DOWNLOAD_GRANT_LIMIT,
    p_window_seconds: DOWNLOAD_WINDOW_SECONDS,
  });

  if (error) {
    // Fail-open: Turnstile has already verified a human is present.
    // A throttle-table outage must not stop legitimate installs.
    console.error(
      "[appDownloadThrottleRepository] RPC call failed, failing open:",
      {
        error: error.message,
        code: error.code,
        ipHash,
        slug,
      },
    );

    return {
      granted: true,
      retryAfterSeconds: 0,
    };
  }

  // RPC returns an array with one row containing { granted, retry_after_seconds }
  const result = Array.isArray(data) ? data[0] : data;

  return {
    granted: result?.granted ?? true,
    retryAfterSeconds: result?.retry_after_seconds ?? 0,
  };
}
