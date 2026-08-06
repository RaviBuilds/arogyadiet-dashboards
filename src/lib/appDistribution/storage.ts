// src/lib/appDistribution/storage.ts
// Private bucket reads and signed URL creation for the App APK Distribution feature.
//
// This module provides server-only functions for:
//   - Reading release manifests from the private app-releases bucket
//   - Creating time-limited signed URLs for APK downloads
//
// CRITICAL: This module imports "server-only" to prevent accidental client-side
// inclusion, which would leak the service-role key (Requirements 14.3–14.5).

import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { AppSlug } from "./slug";
import type { ReleaseManifest } from "./manifest";
import { parseReleaseManifest } from "./manifest";

/**
 * The name of the private Supabase Storage bucket containing APK releases.
 * Configured as private to require signed URLs for all access (Requirement 3.1).
 */
export const RELEASE_BUCKET = "app-releases";

/**
 * The validity period for signed download URLs in seconds.
 * Set to 120 seconds (2 minutes) to limit the window for URL sharing (Requirement 6.5).
 */
export const SIGNED_URL_TTL_SECONDS = 120;

/**
 * Result type for readReleaseManifest.
 *
 * Three outcomes are distinguished:
 *   - Success: { ok: true, manifest }
 *   - Storage unavailable: { ok: false, reason: "UNAVAILABLE", detail }
 *   - Invalid manifest: { ok: false, reason: "INVALID", detail }
 *
 * Both error kinds map to HTTP 503 at the endpoint (Requirements 6.11, 6.12)
 * and to the degraded page state (Requirement 9.8), but are distinguished
 * for logging purposes.
 */
export type ManifestReadResult =
  | { ok: true; manifest: ReleaseManifest }
  | { ok: false; reason: "UNAVAILABLE"; detail: string }
  | { ok: false; reason: "INVALID"; detail: string };

/**
 * Result type for createSignedDownloadUrl.
 *
 * Two outcomes:
 *   - Success: { ok: true, url }
 *   - Failure: { ok: false, detail }
 */
export type SignedUrlResult =
  | { ok: true; url: string }
  | { ok: false; detail: string };

/**
 * Reads the release manifest for an app from the private storage bucket
 * (Requirements 3.6, 6.4).
 *
 * Downloads {slug}/latest.json via the service-role client, converts the
 * blob to text, and delegates to parseReleaseManifest for validation.
 *
 * Error handling:
 *   - Storage error (network, not found, permission) → UNAVAILABLE
 *   - Parse error (malformed JSON, invalid fields) → INVALID
 *
 * Both error kinds result in HTTP 503 at the grant endpoint, but the
 * distinction is preserved for server-side logging.
 *
 * @param slug - The app identifier ("customer" or "rider")
 * @returns Promise resolving to either the manifest or an error result
 */
export async function readReleaseManifest(
  slug: AppSlug,
): Promise<ManifestReadResult> {
  const client = createAdminClient();

  // Download the manifest file from the private bucket
  const { data, error } = await client.storage
    .from(RELEASE_BUCKET)
    .download(`${slug}/latest.json`);

  if (error) {
    // Storage error - bucket unreachable, object not found, or permission denied
    // Maps to UNAVAILABLE (Requirement 6.11)
    return {
      ok: false,
      reason: "UNAVAILABLE",
      detail: error.message,
    };
  }

  // Convert blob to text
  const text = await data.text();

  // Delegate to the parser for validation
  const parseResult = parseReleaseManifest(text);

  if (!parseResult.ok) {
    // Parse error - malformed JSON or invalid fields
    // Maps to INVALID (Requirement 6.12)
    const err = parseResult.error;
    return {
      ok: false,
      reason: "INVALID",
      detail:
        err.kind === "MALFORMED_JSON"
          ? `Malformed JSON: ${err.message}`
          : `Invalid field '${err.field}': ${err.message}`,
    };
  }

  // Success - return the validated manifest
  return { ok: true, manifest: parseResult.manifest };
}

/**
 * Creates a time-limited signed URL for downloading an APK file
 * (Requirements 6.4, 6.5, 8.3).
 *
 * The signed URL authorizes a single client to retrieve the APK object
 * for SIGNED_URL_TTL_SECONDS (120 seconds). The 'download' option sets
 * Content-Disposition: attachment with the versioned filename, so the
 * browser saves the file with its proper name rather than rendering or
 * guessing.
 *
 * The stored object's content type (application/vnd.android.package-archive)
 * is set at upload time and preserved in the signed URL response.
 *
 * @param slug - The app identifier ("customer" or "rider")
 * @param filename - The APK object name (e.g., "arogyadiet-customer-v1.0.0.apk")
 * @returns Promise resolving to either the signed URL or an error result
 */
export async function createSignedDownloadUrl(
  slug: AppSlug,
  filename: string,
): Promise<SignedUrlResult> {
  const client = createAdminClient();

  // Construct the object path: {slug}/{filename}
  const objectPath = `${slug}/${filename}`;

  // Create a signed URL with 120-second TTL and download disposition
  const { data, error } = await client.storage
    .from(RELEASE_BUCKET)
    .createSignedUrl(objectPath, SIGNED_URL_TTL_SECONDS, {
      download: filename, // Sets Content-Disposition: attachment; filename="..."
    });

  if (error) {
    return {
      ok: false,
      detail: error.message,
    };
  }

  if (!data?.signedUrl) {
    return {
      ok: false,
      detail: "No signed URL returned from storage",
    };
  }

  return { ok: true, url: data.signedUrl };
}
