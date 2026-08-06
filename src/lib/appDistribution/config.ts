// src/lib/appDistribution/config.ts
// Centralized environment variable resolution for the app distribution feature.
// Each variable is read in exactly one place so rotation needs no code change.
// Absent or empty values return null rather than throwing, so the caller can
// degrade gracefully and log a clear warning.

export function resolveTurnstileSiteKey(): string | null {
  const value = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

export function resolveTurnstileSecretKey(): string | null {
  const value = process.env.TURNSTILE_SECRET_KEY;
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

export function resolveDownloadBaseUrl(): string | null {
  const value = process.env.NEXT_PUBLIC_APP_DOWNLOAD_BASE_URL;
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}
