// src/validations/appDistribution.ts
// Zod schemas for the App APK Distribution feature.
//
// These schemas validate external payloads:
//   - Release manifest JSON (read from Supabase Storage)
//   - Grant request body (submitted from the download page)
//
// The semver regex enforces no-leading-zeros per the glossary definition
// of Semver_String in the requirements.

import { z } from "zod";

/**
 * Semver validation regex: MAJOR.MINOR.PATCH where each part is a non-negative
 * integer without leading zeros. The regex itself encodes the no-leading-zeros
 * rule rather than using a separate check.
 *
 * Valid: 0.0.0, 1.0.0, 10.20.300
 * Invalid: 01.0.0, 1.00.0, 1.0.01
 */
const SEMVER_REGEX = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/**
 * SHA-256 hash validation: exactly 64 lowercase hexadecimal characters.
 */
const SHA256_HEX_REGEX = /^[0-9a-f]{64}$/;

/**
 * ISO 8601 timestamp with explicit UTC offset.
 *
 * Accepts either:
 *   - UTC 'Z' suffix (e.g., 2024-01-15T10:30:00Z)
 *   - Explicit offset ±HH:MM (e.g., 2024-01-15T10:30:00+05:30)
 *
 * Rejects offset-less timestamps (local time without timezone).
 */
const ISO_8601_WITH_OFFSET_REGEX =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/;

/**
 * Release manifest schema (Requirements 4.1–4.5).
 *
 * Validates the JSON manifest stored at {slug}/latest.json in the
 * app-releases bucket. Each field is validated against its stated format:
 *
 *   - version: Semver_String (no leading zeros)
 *   - filename: non-empty string matching the APK object name
 *   - size: non-negative integer count of bytes
 *   - sha256: 64-character lowercase hex string
 *   - releasedAt: ISO 8601 with explicit UTC offset
 *   - whatsNew: free-form string (may be empty)
 */
export const releaseManifestSchema = z.object({
  version: z
    .string()
    .regex(
      SEMVER_REGEX,
      "Version must be a valid semver string (MAJOR.MINOR.PATCH with no leading zeros)",
    ),
  filename: z.string().min(1, "Filename is required"),
  size: z
    .number()
    .int("Size must be an integer")
    .nonnegative("Size must be a non-negative integer"),
  sha256: z
    .string()
    .regex(SHA256_HEX_REGEX, "SHA256 must be 64 lowercase hexadecimal characters"),
  releasedAt: z
    .string()
    .regex(
      ISO_8601_WITH_OFFSET_REGEX,
      "ReleasedAt must be an ISO 8601 timestamp with explicit UTC offset (e.g., 2024-01-15T10:30:00Z or 2024-01-15T10:30:00+05:30)",
    ),
  whatsNew: z.string(),
});

export type ReleaseManifestSchema = z.infer<typeof releaseManifestSchema>;

/**
 * Grant request schema (Requirements 6.8, 6.9).
 *
 * Validates the request body submitted to the /api/app-download/grant endpoint.
 * Both fields are required and must be non-empty strings:
 *
 *   - slug: App identifier ("customer" or "rider") — validated against AppSlug
 *     elsewhere (see src/lib/appDistribution/slug.ts)
 *   - token: Cloudflare Turnstile response token
 */
export const grantRequestSchema = z.object({
  slug: z.string().min(1, "Slug is required"),
  token: z.string().min(1, "Token is required"),
});

export type GrantRequestSchema = z.infer<typeof grantRequestSchema>;
