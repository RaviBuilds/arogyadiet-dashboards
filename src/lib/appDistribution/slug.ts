/**
 * App_Slug parsing for the APK distribution feature.
 *
 * Spec: app-apk-distribution — Task 1.3
 * Requirements: 1.6, 6.9
 *
 * `parseAppSlug` is total: it returns `null` for anything that is not one of the
 * two permitted slugs and never throws. That is deliberate, because the two
 * callers need DIFFERENT outcomes from the same rejection — the Download_Page
 * calls `notFound()` for a 404 (Req 1.6), while the Download_Grant_Endpoint
 * answers 400 (Req 6.9). A throwing parser would force both to wrap it in a
 * try/catch and would make the endpoint's 400 indistinguishable from an
 * unexpected 500.
 *
 * Pure module: no I/O, no Supabase, no environment access.
 */

/** The two applications this feature distributes. */
export type AppSlug = "customer" | "rider";

/**
 * Every permitted App_Slug, in the order pages should be generated.
 *
 * Exported as a readonly tuple so `generateStaticParams` can map over it and so
 * tests can assert exhaustiveness against `AppSlug` rather than restating the
 * literals.
 */
export const APP_SLUGS = ["customer", "rider"] as const satisfies readonly AppSlug[];

/**
 * Narrows an unknown value to an `AppSlug`.
 *
 * Accepts ONLY the exact lowercase strings `"customer"` and `"rider"`. No
 * trimming, no case folding, no alias handling: the slug arrives either from a
 * URL segment we generate ourselves or from a request body, and silently
 * accepting `"Customer"` or `" rider "` would mean two URLs resolving to one
 * page — a needless duplicate surface, and a second cache key for identical
 * content.
 *
 * @param value Candidate slug from a route param or a request body.
 * @returns The narrowed slug, or `null` when `value` is not a permitted slug.
 */
export function parseAppSlug(value: unknown): AppSlug | null {
  if (typeof value !== "string") return null;
  return (APP_SLUGS as readonly string[]).includes(value)
    ? (value as AppSlug)
    : null;
}
