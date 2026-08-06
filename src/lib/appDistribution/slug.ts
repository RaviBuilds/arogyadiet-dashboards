// src/lib/appDistribution/slug.ts
// AppSlug type and parsing. Total function, no throw — callers decide between
// notFound() on a page and HTTP 400 on an endpoint.

export type AppSlug = "customer" | "rider";

export const APP_SLUGS = ["customer", "rider"] as const satisfies readonly AppSlug[];

export function parseAppSlug(value: unknown): AppSlug | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed === "customer" || trimmed === "rider") {
    return trimmed;
  }
  return null;
}
