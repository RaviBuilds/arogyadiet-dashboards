// src/lib/appDistribution/manifest.ts
// Manifest parser and serializer for the App APK Distribution feature.
//
// This module provides the Manifest_Parser and Manifest_Serializer referenced
// in Requirements 4.6–4.11. It handles:
//   - Parsing JSON text into a validated ReleaseManifest
//   - Serializing a ReleaseManifest back to JSON with fixed key order
//
// Fixed key ordering is critical: it enables the round-trip properties in
// Requirements 4.10 and 4.11 (string equality on re-serialization), and it
// keeps manual manifest edits reviewable as diffs.

import { releaseManifestSchema } from "@/validations/appDistribution";

/**
 * Release manifest interface (Requirements 4.1–4.5).
 *
 * Represents the validated structure stored at {slug}/latest.json in the
 * app-releases bucket. Each field corresponds to a release attribute:
 *
 *   - version: Semver string (MAJOR.MINOR.PATCH, no leading zeros)
 *   - filename: APK object name matching the version
 *   - size: Non-negative integer count of bytes
 *   - sha256: 64-character lowercase hexadecimal hash
 *   - releasedAt: ISO 8601 timestamp with explicit UTC offset
 *   - whatsNew: Free-form release notes (may be empty)
 */
export interface ReleaseManifest {
  version: string;
  filename: string;
  size: number;
  sha256: string;
  releasedAt: string;
  whatsNew: string;
}

/**
 * Discriminated union for manifest parse errors (Requirements 4.7, 4.8).
 *
 * Two error kinds are distinguished:
 *
 *   - MALFORMED_JSON: The input text could not be parsed as JSON.
 *     The message contains the JSON.parse error details.
 *
 *   - INVALID_FIELD: The JSON parsed successfully but failed schema validation.
 *     The field property identifies the first invalid or missing field.
 */
export type ManifestParseError =
  | { kind: "MALFORMED_JSON"; message: string }
  | { kind: "INVALID_FIELD"; field: string; message: string };

/**
 * Parses Release_Manifest JSON text into a validated ReleaseManifest value
 * (Requirements 4.6–4.8).
 *
 * The function is total and never throws. It returns a discriminated result:
 *
 *   - { ok: true, manifest } on successful parse and validation
 *   - { ok: false, error } on failure, with error.kind indicating the cause
 *
 * Error mapping:
 *   - JSON.parse failure → { kind: "MALFORMED_JSON", message }
 *   - Zod validation failure → { kind: "INVALID_FIELD", field, message }
 *     where field is extracted from the first Zod issue's path
 *
 * @param text - The raw JSON text to parse
 * @returns Discriminated result with either manifest or error
 */
export function parseReleaseManifest(
  text: string,
): { ok: true; manifest: ReleaseManifest } | { ok: false; error: ManifestParseError } {
  // Step 1: Attempt JSON.parse (Requirement 4.7)
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Invalid JSON";
    return {
      ok: false,
      error: { kind: "MALFORMED_JSON", message },
    };
  }

  // Step 2: Validate with Zod schema (Requirement 4.8)
  const result = releaseManifestSchema.safeParse(parsed);

  if (!result.success) {
    // Extract the first issue's path as the field name
    const firstIssue = result.error.issues[0];
    const field = firstIssue.path.join(".") || "unknown";
    return {
      ok: false,
      error: {
        kind: "INVALID_FIELD",
        field,
        message: firstIssue.message,
      },
    };
  }

  // Step 3: Return the validated manifest
  return { ok: true, manifest: result.data as ReleaseManifest };
}

/**
 * Serializes a ReleaseManifest value to JSON text with fixed key order
 * (Requirements 4.9–4.11).
 *
 * The six keys are written in a fixed order with two-space indentation:
 *   version, filename, size, sha256, releasedAt, whatsNew
 *
 * Fixed key ordering enables:
 *   - Round-trip property: parse(serialize(parse(text))) === parse(text)
 *   - Reviewable diffs when manifests are edited manually
 *
 * @param manifest - The validated manifest to serialize
 * @returns JSON string with keys in fixed order, 2-space indentation
 */
export function serializeReleaseManifest(manifest: ReleaseManifest): string {
  // Construct object with keys in fixed order
  const ordered: Record<string, unknown> = {
    version: manifest.version,
    filename: manifest.filename,
    size: manifest.size,
    sha256: manifest.sha256,
    releasedAt: manifest.releasedAt,
    whatsNew: manifest.whatsNew,
  };

  // Serialize with 2-space indentation, no extra whitespace
  return JSON.stringify(ordered, null, 2);
}
