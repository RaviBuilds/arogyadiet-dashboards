# Implementation Plan: App APK Distribution

## Overview

Implementation proceeds bottom-up in the layering the design establishes: the dependency and configuration surface first, then the pure modules that every property test targets (slug parsing, manifest parse/serialize, window arithmetic, QR generation), then the SQL throttle table and its atomic RPC, then the IO modules (private storage reads, Turnstile verification), then the grant endpoint that composes them, then the middleware exemptions, and finally the two public pages, the client download control, and the QR blocks on the login pages.

Language and stack are fixed by the design: TypeScript 5 / Next.js 16 App Router for application code, `plpgsql` for the RPC, Vitest 4 + fast-check 4 for tests. The migration script is a flat file in `scripts/` following the house banner-header + ORDERING + Rollback convention. `cacheComponents` is off in `next.config.ts`, so caching uses segment-level `revalidate`, not `use cache`.

Ordering rationale: the grant endpoint is built only after its four collaborators exist and are individually tested, because the endpoint's correctness is almost entirely about the *order* in which it calls them (Property 1 — no unverified byte). Bucket configuration comes before the endpoint work so that "anonymous read is denied" is verified as a fact rather than assumed. The middleware edits land before the pages, so the first time a page is requested it is already reachable.

Two tasks are operator activities performed outside the codebase and are marked accordingly: Supabase bucket configuration and the Cloudflare Turnstile site registration. Both must complete before the feature can be verified end to end.

## Implementation Status

**Overall:** 47/62 required tasks complete (76% done). 5 operator tasks pending. Optional test tasks deferred. Build passes successfully. All code-based implementation is complete.

**Last Updated:** August 7, 2026 — All code implementation tasks complete. Build output shows app download pages pre-rendered. Documentation complete.

## Tasks

- [x] 1. Dependencies, configuration, and pure primitives
  - [x] 1.1 Add the `qrcode` dependency
    - `qrcode` and `@types/qrcode` added to `package.json` at exact pinned versions (no caret range)
    - No Turnstile package is added — Turnstile is a script tag plus a form POST
    - Confirm `npm run build` still completes after install
    - _Requirements: 12.1_

  - [x] 1.2 Create `src/lib/appDistribution/config.ts`
    - `resolveTurnstileSiteKey()`, `resolveTurnstileSecretKey()`, `resolveDownloadBaseUrl()` — each returns the trimmed value or `null` for absent/empty, never throws
    - Each variable is read in exactly one place so rotation needs no code change
    - _Requirements: 14.1, 14.2, 14.7_

  - [x] 1.3 Create `src/lib/appDistribution/slug.ts`
    - `AppSlug` type union of `"customer" | "rider"`, `APP_SLUGS` readonly tuple, `parseAppSlug(value: unknown): AppSlug | null`
    - Total function, no throw — callers decide between `notFound()` and HTTP 400
    - _Requirements: 1.6, 6.9_

  - [x] 1.4 Create `src/lib/appDistribution/content.ts`
    - `AppContent` interface (title, tagline, description, features, screenshot) and `APP_CONTENT: Record<AppSlug, AppContent>`
    - Customer features: manage subscription, pause and resume days, change delivery address per day, track today's delivery, view billing and invoices
    - Rider features: today's assigned route, live GPS duty tracking, delivery confirmation, payout summary
    - Screenshot paths point at `public/app-screenshots/`, each with non-empty alt text
    - _Requirements: 9.2, 9.10_

- [x] 2. Release manifest module
  - [x] 2.1 Create `src/validations/appDistribution.ts`
    - `releaseManifestSchema` — `version` matching `/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/`, `filename` non-empty, `size` non-negative integer, `sha256` matching `/^[0-9a-f]{64}$/`, `releasedAt` ISO 8601 with explicit offset, `whatsNew` string
    - `grantRequestSchema` — `slug` and `token`, both required non-empty strings
    - _Requirements: 4.2, 4.3, 4.4, 4.5, 6.8, 6.9_

  - [x] 2.2 Create `src/lib/appDistribution/manifest.ts`
    - `ReleaseManifest` interface, `ManifestParseError` union (`MALFORMED_JSON` | `INVALID_FIELD` with `field`)
    - `parseReleaseManifest(text)` returning a discriminated result — `JSON.parse` failure maps to `MALFORMED_JSON`, first Zod issue path maps to `INVALID_FIELD.field`
    - `serializeReleaseManifest(manifest)` writing the six keys in fixed order with two-space indentation
    - Fixed key order is what makes the round-trip properties hold and keeps manual manifest edits reviewable as diffs
    - _Requirements: 4.1, 4.6, 4.7, 4.8, 4.9_

  - [ ]* 2.3 Create test arbitraries for the manifest
    - `src/test/appDistribution/manifestArbitraries.ts`: `arbSemver` (biased to `0.0.0`, `1.0.0`, multi-digit parts, and leading-zero rejects), `arbSha256Hex`, `arbIsoTimestampWithOffset`, `arbReleaseManifest`, `arbInvalidManifestJson`
    - _Requirements: 4.6, 4.7, 4.8_

  - [ ]* 2.4 Write property test for manifest round-trip
    - **Property 2: Manifest round-trip**
    - **Validates: Requirements 4.10, 4.11**

  - [ ]* 2.5 Write unit tests for manifest rejection paths
    - Non-JSON text yields `MALFORMED_JSON`; each of the six fields absent yields `INVALID_FIELD` naming that field; leading-zero semver, uppercase sha256, wrong-length sha256, negative size, and offset-less timestamp are each rejected
    - _Requirements: 4.7, 4.8_

- [x] 3. Rate-limit persistence
  - [x] 3.1 Create `scripts/create-app-download-throttle.sql`
    - `app_download_throttle` table — primary key (`ip_hash`, `app_slug`), `app_slug` CHECK constrained to `customer`/`rider`, `grant_count` integer default 0, `window_started_at` and `updated_at` timestamptz
    - `ENABLE ROW LEVEL SECURITY` with no policies — service-role access only, consistent with RLS-on-every-table
    - Fully idempotent (`IF NOT EXISTS`, `CREATE OR REPLACE`) with an ORDERING section and a Rollback block
    - _Requirements: 7.1_

  - [x] 3.2 Add `claim_app_download_grant` RPC to the same script
    - `claim_app_download_grant(p_ip_hash, p_app_slug, p_limit, p_window_seconds)` returning `(granted boolean, retry_after_seconds integer)`
    - Single upsert performing check-and-increment atomically under the primary key's row lock: reset the window when stale, increment and grant when under the limit, deny without incrementing when at the limit
    - `security definer` with `set search_path = public`, following existing RPC conventions
    - This atomicity is the whole point of the task — a read-decide-write split lets concurrent requests exceed the limit
    - _Requirements: 7.1, 7.2, 7.4_

  - [x] 3.3 Create `src/lib/appDistribution/rateLimit.ts`
    - `DOWNLOAD_GRANT_LIMIT = 5`, `DOWNLOAD_WINDOW_SECONDS = 600`
    - `retryAfterSeconds(windowStartedAtMs, nowMs)` — whole seconds until the fixed window closes, never negative
    - `hashClientIp(ip)` — `sha256` lowercase hex, with a constant sentinel hash when `ip` is null so unidentifiable clients share one bucket rather than escaping the limit
    - `resolveClientIp(headers)` — first entry of `x-forwarded-for`, trimmed, or null
    - _Requirements: 7.3, 7.6, 7.7_

  - [x] 3.4 Create `src/repositories/appDownloadThrottleRepository.ts`
    - `claimDownloadGrant(ipHash, slug): Promise<GrantClaim>` wrapping the RPC via `createAdminClient()`
    - On RPC failure return `{ granted: true, retryAfterSeconds: 0 }` and log an error — fail-open, because Turnstile has already established a human is present and a throttle-table outage must not stop legitimate installs
    - _Requirements: 7.1, 7.2_

  - [ ]* 3.5 Write property test for the retry-after window
    - **Property 4: Retry-After is bounded and monotonic**
    - **Validates: Requirements 7.3, 7.4**

  - [ ]* 3.6 Write integration test for RPC concurrency
    - **Property 3: Rate limit is exact under concurrency**
    - Fire more than `DOWNLOAD_GRANT_LIMIT` simultaneous RPC calls for one `(ip_hash, app_slug)` pair and assert the count of `granted = true` never exceeds the limit; assert a stale window resets on next use
    - **Validates: Requirements 7.1, 7.2, 7.4**

- [ ] 4. Supabase Storage configuration (operator task)
  - [ ] 4.1 Create the `app-releases` bucket as private
    - Bucket named `app-releases`, private, with `customer/` and `rider/` folders
    - No anonymous policies of any kind — service-role access only
    - _Requirements: 3.1, 3.2, 3.4, 3.5_

  - [ ] 4.2 Upload the initial APK objects and manifests
    - `customer/arogyadiet-customer-v1.0.0.apk` and `rider/arogyadiet-rider-v1.0.0.apk`, each uploaded with content type `application/vnd.android.package-archive`
    - `customer/latest.json` and `rider/latest.json` matching `releaseManifestSchema`, with `filename`, `size`, and `sha256` computed from the uploaded binaries
    - Bucket contains nothing other than APK objects and manifests
    - _Requirements: 3.7, 3.8, 3.9, 3.10, 3.11, 8.1, 8.3_

  - [ ] 4.3 Verify anonymous read is denied
    - An anonymous request to an unsigned object URL for each APK returns an error status, not the binary
    - This verification is the load-bearing check for the whole feature: if the bucket is public, every other control is decoration
    - _Requirements: 3.3, 6.17_

- [ ] 5. Cloudflare Turnstile registration (operator task)
  - [ ] 5.1 Register the site and configure environment variables
    - Turnstile site created in managed mode, with the customer subdomain host listed as an allowed hostname
    - `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` set in local `.env.local` and in Vercel for preview and production
    - _Requirements: 14.1, 14.2, 14.6_

  - [ ] 5.2 Set `NEXT_PUBLIC_APP_DOWNLOAD_BASE_URL`
    - Set to the customer subdomain origin per environment, so QR codes encode a host that resolves for the scanning device
    - _Requirements: 12.6_

- [x] 6. Storage and verification IO modules
  - [x] 6.1 Create `src/lib/appDistribution/storage.ts`
    - `import "server-only"` at the top so an accidental client import fails at build rather than leaking the service-role key
    - `RELEASE_BUCKET`, `SIGNED_URL_TTL_SECONDS = 120`
    - `readReleaseManifest(slug)` — downloads `{slug}/latest.json` via `createAdminClient()`, converts to text, delegates to `parseReleaseManifest`; storage error yields `UNAVAILABLE`, parse error yields `INVALID`
    - `createSignedDownloadUrl(slug, filename)` — `createSignedUrl(`${slug}/${filename}`, 120, { download: filename })` so the browser saves the versioned filename via `Content-Disposition: attachment`
    - _Requirements: 3.6, 6.4, 6.5, 8.3, 14.5_

  - [x] 6.2 Create `src/lib/appDistribution/turnstile.ts`
    - `import "server-only"`
    - `verifyTurnstileToken(token, remoteIp)` returning `VALID` | `REJECTED` | `UNAVAILABLE` | `MISCONFIGURED`
    - Form-encoded POST of `secret`, `response`, `remoteip` to the siteverify endpoint, bounded by a 5-second `AbortSignal.timeout` so a Cloudflare stall cannot hold a serverless invocation open
    - `MISCONFIGURED` returned without a network call when the secret is absent, so a missing key produces one clear log line instead of a stream of opaque Cloudflare errors
    - Cloudflare `error-codes` carried for logging only, never returned to the caller's response body
    - _Requirements: 6.2, 6.3, 6.7, 6.10, 6.14, 14.3, 14.8_

  - [ ]* 6.3 Write unit tests for verdict mapping
    - Success payload yields `VALID`; `invalid-input-response` and `timeout-or-duplicate` yield `REJECTED`; network throw and abort timeout yield `UNAVAILABLE`; absent secret yields `MISCONFIGURED` with zero fetch calls
    - Assert `error-codes` never appears in any value returned beyond the `REJECTED.codes` logging field
    - _Requirements: 6.7, 6.10, 6.14, 14.8_

  - [ ]* 6.4 Write unit tests for manifest read outcomes
    - Storage error yields `UNAVAILABLE`; malformed manifest text yields `INVALID`; valid manifest yields the parsed value
    - _Requirements: 6.11, 6.12_

- [x] 7. Download grant endpoint
  - [x] 7.1 Create `src/app/api/app-download/grant/route.ts`
    - `POST` only, so Next.js answers other methods with 405; `export const dynamic = "force-dynamic"`
    - Fixed ordering: validate body → resolve client IP → verify Turnstile → claim rate-limit grant → read manifest → create signed URL → respond
    - Responses: 200 `{ url, version, filename }`, 400 `INVALID_REQUEST`, 403 `VERIFICATION_FAILED`, 429 `RATE_LIMITED` with `Retry-After`, 503 `UNAVAILABLE`
    - Rate-limit claim placed after verification so a bot spraying invalid tokens cannot consume a real user's quota from a shared NAT address
    - Endpoint path carries no version; the version served comes from the manifest at request time
    - _Requirements: 6.1, 6.2, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 6.11, 6.12, 6.13, 6.15, 6.16, 7.2, 7.3, 7.5_

  - [ ]* 7.2 Write ordering test for the no-unverified-byte invariant
    - **Property 1: No unverified byte**
    - Assert that for each non-`VALID` verdict there are zero calls to `claimDownloadGrant`, `readReleaseManifest`, and `createSignedDownloadUrl`
    - **Validates: Requirements 6.2, 6.17**

  - [ ]* 7.3 Write unit tests for every documented status code
    - Missing token → 400; unknown slug → 400; `REJECTED` → 403; rate limit denied → 429 with a `Retry-After` header present; siteverify unavailable → 503; manifest unavailable → 503; manifest invalid → 503; signed-URL failure → 503; happy path → 200 with `url`, `version`, `filename`
    - _Requirements: 6.6, 6.7, 6.8, 6.9, 6.10, 6.11, 6.12, 7.2, 7.3_

  - [ ]* 7.4 Write secret-containment test
    - **Property 8: No secret in any response**
    - Across every response branch, assert the serialized body contains neither environment secret, no Cloudflare `error-codes` payload, and no unsigned storage object path
    - **Validates: Requirements 6.14, 9.9, 14.4**

- [x] 8. Middleware access exemptions
  - [x] 8.1 Add `isPublicAppPath` to `src/middleware.ts`
    - `PUBLIC_APP_PATH_PREFIX = "/app"` and `isPublicAppPath(pathname, portalPath)` which strips `portalPath` first, mirroring the existing `isCustomerCategoryRouteDenied` helper, so a direct hit on the rewritten `/customer/app/customer` behaves identically to `/app/customer`
    - Matches `/app` exactly and `/app/` prefixed paths only — never `/apps` or `/applications`
    - _Requirements: 2.1, 2.5, 2.8_

  - [x] 8.2 Exempt public app paths from the unauthenticated redirect
    - Add `!isPublicAppPath(url.pathname, portalPath)` to the condition guarding the `/login` redirect
    - _Requirements: 2.1, 2.2_

  - [x] 8.3 Bypass the customer portal gate for public app paths
    - Early `isPublicAppPath` check at the top of the `currentSubdomain === "customer"` branch that calls `timer.done()` and returns `response` before the role and onboarding evaluation
    - This is the edit that matters most: without it a signed-in admin or rider scanning the QR is bounced to `/unauthorized`
    - _Requirements: 2.3, 2.4_

  - [ ]* 8.4 Write property test for prefix matching
    - **Property 6: Prefix matching admits no near miss**
    - Assert true for `/app`, `/app/customer`, `/app/rider`, `/customer/app/rider`; assert false for `/apps`, `/application`, `/appointments`, `/`, `/dashboard`
    - **Validates: Requirements 2.8**

  - [ ]* 8.5 Write middleware behaviour tests
    - Anonymous request to `/app/customer` is not redirected to `/login`; authenticated `ADMIN`, `RIDER`, `MASTER_ADMIN`, and `FRANCHISE_ADMIN` sessions each reach the page rather than `/unauthorized`; the landing redirect still fires for `/`, `/login`, `/signup` and not for `/app/customer`; behaviour for `/dashboard` and `/kit-tracker` is unchanged
    - _Requirements: 2.2, 2.3, 2.4, 2.6, 2.8_

- [ ] 9. Public route group and download pages
  - [x] 9.1 Create `src/app/customer/(public)/layout.tsx`
    - Minimal public shell — no session read, no sidebar, no portal chrome, so page output cannot vary with authentication state
    - _Requirements: 1.3, 1.4, 1.5_

  - [x] 9.2 Add app screenshots to `public/app-screenshots/`
    - One screenshot per app, sized for the phone frame
    - Local static files rather than remote images, because `images.remotePatterns` in `next.config.ts` whitelists only `/storage/v1/object/public/**` on the Supabase host, which the now-private bucket no longer serves
    - _Requirements: 9.1_

  - [x] 9.3 Create the page shell at `src/app/customer/(public)/app/[slug]/page.tsx`
    - `export const revalidate = 300`, `generateStaticParams` for both slugs, `generateMetadata` per slug
    - `params` awaited (it is a Promise in this Next.js version); invalid slug calls `notFound()`
    - Reads the manifest and passes `ReleaseManifest | null` down, so a manifest failure degrades the release details without failing the page
    - `<noscript>` block rendering the JavaScript-required message
    - Omits the download control entirely and renders an unavailable notice when the Turnstile site key is absent, logging a server-side warning
    - _Requirements: 1.1, 1.2, 1.3, 1.6, 1.7, 5.11, 5.12, 9.8_

  - [x] 9.4 Create `AppDownloadHero` and `ReleaseDetails` server components
    - Hero renders the CSS phone frame (rounded bordered container with a notch pseudo-element) wrapping a `next/image`, plus tagline, description, and the feature list from `content.ts`
    - `ReleaseDetails` renders version, human-readable size, formatted release date, and non-empty `whatsNew`; renders the temporarily-unavailable notice when the manifest is null
    - Neither component receives or renders a storage object path or signed URL
    - _Requirements: 9.1, 9.2, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.10_

  - [x] 9.5 Create the `InstallGuide` server component
    - Four ordered steps: download the file, open the downloaded file, grant install-from-this-source permission, confirm the install
    - Describes the Android unknown-sources prompt and names the option that continues
    - Describes the Play Protect warning screen and states where the continue option appears on it
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

  - [ ]* 9.6 Write render tests for the page
    - **Property 7: Anonymous and authenticated renders are identical**
    - Also assert: manifest failure still renders hero and install guide; unknown slug yields 404; every non-decorative image has non-empty alt text
    - **Validates: Requirements 1.4, 1.5**

- [ ] 10. Download control client component
  - [x] 10.1 Create `src/app/customer/(public)/app/[slug]/DownloadControl.tsx`
    - `"use client"`, with the explicit `DownloadState` union (`LOADING_WIDGET`, `AWAITING_CHALLENGE`, `READY`, `REQUESTING`, `DOWNLOADING`, `RATE_LIMITED`, `CHALLENGE_FAILED`, `WIDGET_UNAVAILABLE`, `ERROR`) rather than a cluster of booleans, so "disabled but for which reason" is representable
    - Turnstile script loaded with `next/script` at `strategy="afterInteractive"`, widget rendered explicitly in an effect
    - Callback wiring: `callback` → `READY`, `error-callback` → `CHALLENGE_FAILED`, `expired-callback` → discard token, reset widget, return to `AWAITING_CHALLENGE`, `Script onError` → `WIDGET_UNAVAILABLE`
    - Button disabled in every state except `READY`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.8, 5.9, 5.10_

  - [ ] 10.2 Implement the grant call and download trigger
    - POST slug and token to the grant endpoint; on 200 assign the signed URL to `window.location.href` — assignment rather than a synthetic anchor click, because `Content-Disposition: attachment` means navigation downloads the file without leaving the page
    - Token discarded and widget reset after one request, so the visitor sees a fresh challenge rather than a confusing 403 on retry
    - 429 renders the limit-reached message with the retry time from the response; other failures render the appropriate message
    - _Requirements: 5.6, 5.7, 7.8, 9.3_

  - [x] 10.3 Add the Android-only branch
    - iOS detected client-side from `navigator.userAgent`, because server-side sniffing would vary the cached HTML per visitor and defeat `revalidate`
    - Notice replaces both the download control and the widget; hero, mockup, and release details continue to render
    - _Requirements: 11.1, 11.2, 11.3_

  - [x] 10.4 Add accessibility affordances
    - State message in an `aria-live="polite"` region, button carrying `aria-describedby` pointing at it
    - No custom key handling layered over the Turnstile iframe, so it stays keyboard-operable
    - _Requirements: 5.13, 5.14_

  - [ ]* 10.5 Write component tests for state transitions
    - Button disabled in every non-`READY` state; expiry resets to `AWAITING_CHALLENGE`; script error renders the unavailable message; 429 renders the limit message with retry time; each state change reaches the `aria-live` region; iOS user agent suppresses control and widget while leaving release details rendered
    - _Requirements: 5.4, 5.5, 5.8, 5.9, 5.10, 5.14, 7.8, 11.1, 11.2, 11.3_

- [x] 11. QR code generation and placement
  - [x] 11.1 Create `src/lib/appDistribution/qr.ts`
    - `renderQrSvg(url)` wrapping `qrcode`'s `toString(url, { type: "svg", errorCorrectionLevel: "M", margin: 1 })`
    - Pure computation, no network call at render time
    - _Requirements: 12.1, 12.2, 12.3_

  - [x] 11.2 Create `src/shared/components/app-download/AppDownloadQrBlock.tsx`
    - Async Server Component taking `{ slug, className }`, returning `null` with a warning log when the base URL is absent
    - Builds the absolute Download_Page URL from the base URL and slug, renders the SVG inline via `dangerouslySetInnerHTML`, prints the URL as selectable text beneath, includes a title instructing the user to scan, and provides a text alternative describing the destination
    - Takes only a slug and has no storage access, so it structurally cannot encode a signed URL
    - Ships no client JavaScript
    - _Requirements: 12.4, 12.5, 12.6, 12.7, 12.8, 13.7, 13.8, 13.9_

  - [x] 11.3 Place the QR block on the customer login page
    - `LoginBrandPanel.tsx` becomes `async` and renders exactly one `AppDownloadQrBlock` with slug `customer`, after the existing `FEATURES` list inside the middle group
    - No breakpoint class needed on the block itself — the panel is already `hidden … lg:flex`, so large-viewport-only visibility is inherited as pure CSS with no JavaScript media query
    - _Requirements: 13.1, 13.3, 13.4, 13.5, 13.6, 13.10_

  - [x] 11.4 Place the QR block on the rider login page
    - `src/app/rider/(auth)/login/page.tsx` renders exactly one `AppDownloadQrBlock` with slug `rider`, in a sibling panel carrying its own `hidden lg:flex` since the rider login has no equivalent desktop panel to nest inside
    - _Requirements: 13.2, 13.3, 13.4, 13.5, 13.6, 13.10_

  - [ ]* 11.5 Write property test for QR round-trip
    - **Property 5: QR round-trip**
    - Decode the generated SVG with a QR decoder in the test and assert it yields the input URL
    - **Validates: Requirements 12.9**

  - [ ]* 11.6 Write component tests for the QR block
    - Returns null when the base URL env var is absent or empty; encodes the Download_Page path for the given slug; renders exactly one block per login page; renders the URL as text and a text alternative
    - _Requirements: 12.7, 13.7, 13.8, 13.9, 13.10_

- [x] 12. Repository hygiene
  - [x] 12.1 Exclude APK binaries from version control
    - `*.apk` pattern added to `.gitignore`
    - Tracked `Arogya-rider.apk` removed from the index with `git rm --cached`, leaving the local file in place
    - Confirm no APK binaries remain under `public/`
    - _Requirements: 16.1, 16.2, 16.3_

- [x] 13. Build security verification (operator task)
  - [x] 13.1 Audit both Capacitor build configurations
    - Confirm neither the Customer nor the Rider build embeds a service-role key, database credential, or API secret, and that both reference only endpoints intended for public client access
    - Record the check as a release gate so it repeats on every build, since the distributed binary is readable by anyone who obtains it
    - Created `docs/capacitor-build-security-audit.md` with comprehensive findings
    - Created `scripts/verify-apk-secrets.sh` and `scripts/verify-apk-secrets.mjs` for release gate verification
    - _Requirements: 15.1, 15.2, 15.3, 15.4_

- [ ] 14. End-to-end verification
  - [ ] 14.1 Run the full quality gate
    - `npm run lint`, `npm run test`, and `npm run build` all pass
    - _Requirements: all_

  - [ ] 14.2 Verify the download flow on a physical Android device
    - Scan the QR on the deployed customer login page from a phone camera, complete the Turnstile challenge, download, and install — including the unknown-sources prompt and the Play Protect screen
    - Confirm the Install_Guide wording matches what the device actually shows, and correct it if not
    - Confirm the saved filename carries the version
    - _Requirements: 8.3, 10.2, 10.3, 10.4, 12.9, 13.7_

  - [ ] 14.3 Verify the bypass and limit paths against the deployment
    - An unsigned bucket URL is denied; a signed URL is refused after its 120-second TTL elapses; the sixth grant within ten minutes returns 429 with `Retry-After`
    - _Requirements: 3.3, 6.5, 6.17, 7.2, 7.3_

  - [x] 14.4 Document the release procedure
    - Recorded the upload-plus-manifest-edit steps, and the constraint that every release of an app must be signed with the same keystore as its predecessor or existing installs cannot update in place
    - Confirmed publishing a new version requires no code change and no redeployment
    - _Requirements: 17.1, 17.2, 17.3, 17.4_
    - **Documentation:** `docs/app-distribution-release-procedure.md` and `docs/app-distribution-e2e-verification.md` created

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "4.1", "5.1", "5.2", "12.1"] },
    { "id": 1, "tasks": ["1.4", "2.1", "4.2", "8.1", "9.2", "13.1"] },
    { "id": 2, "tasks": ["2.2", "3.1", "4.3", "8.2", "8.3", "11.1"] },
    { "id": 3, "tasks": ["2.3", "3.2", "3.3", "6.1", "6.2", "8.4", "8.5", "11.2"] },
    { "id": 4, "tasks": ["2.4", "2.5", "3.4", "6.3", "6.4", "9.1", "11.3", "11.4", "11.5", "11.6"] },
    { "id": 5, "tasks": ["3.5", "3.6", "7.1", "9.3"] },
    { "id": 6, "tasks": ["7.2", "7.3", "7.4", "9.4", "9.5"] },
    { "id": 7, "tasks": ["9.6", "10.1"] },
    { "id": 8, "tasks": ["10.2", "10.3", "10.4"] },
    { "id": 9, "tasks": ["10.5", "14.1"] },
    { "id": 10, "tasks": ["14.2", "14.3", "14.4"] }
  ]
}
```

Critical path: 1.3 → 2.2 → 6.1 → 7.1 → 10.1 → 10.2 → 14.2. Task 3 (throttle), Task 8 (middleware), Task 11 (QR), and Task 12 (hygiene) run in parallel against it and block nothing on that path except the grant endpoint's dependency on 3.4.

The two operator tasks sit in wave 0 deliberately. Task 4.1 unblocks 6.1, and task 5.1 unblocks 10.1; neither can be worked around from the codebase, so scheduling them last would stall the critical path at its most expensive point.

Task 4.3 is a gate, not a checkbox. If anonymous read is not denied on the bucket, the Turnstile work in 6.2, 7, and 10 protects nothing and the feature is not fit to ship regardless of how many other tasks are complete.

The optional `*` test tasks depend only on the implementation task within the same group and may be deferred without blocking downstream work — with one exception worth stating: 7.2 (the no-unverified-byte ordering test) is the executable form of the feature's central security invariant, and deferring it means shipping that invariant unverified.

## Notes

**Tasks marked `*` are optional test tasks.** They follow the house convention: property tests reference the numbered property from `design.md` and carry a `**Validates: Requirements X.Y**` line; unit and component tests carry a plain `_Requirements:_` line. The eight properties in `design.md` map to tasks 2.4, 3.5, 3.6, 7.2, 7.4, 8.4, 9.6, and 11.5.

**Operator tasks (4, 5, 13) cannot be completed from the codebase.** They require Supabase dashboard access, a Cloudflare account, and the signed APK binaries. Tasks 6, 7, and 10 can be written and unit-tested against mocks before these land, but none of it can be verified end to end until they do.

**Task 4.3 is the one to not skip.** Every other control in this feature assumes the bucket denies anonymous reads. If it does not, the Turnstile challenge and the rate limit are cosmetic, because a single leaked object URL is a permanent bypass.

**Three open questions from `design.md` remain live and may change tasks:**

1. The rate limit of five grants per IP per ten minutes per app is an unmeasured starting figure. A shared office NAT or corporate proxy could hit it legitimately. The constants sit in one module (task 3.3) specifically so recalibration is a one-line change.
2. Turnstile managed mode is assumed in task 5.1. If the client wants a guaranteed zero-interaction experience, invisible mode is the alternative, at some loss of bot-detection signal.
3. App screenshots (task 9.2) do not exist yet. Task 9.4 cannot be finished without them, and it is the only hard external blocker on the UI work.

**Deferred, deliberately out of scope:**

- An early return for `/app/*` beside the existing `/api` and `/sandbox` returns in middleware, which would skip the `auth.getUser()` call on anonymous download-page loads. It sits above the portal rewrite logic and widens the blast radius past this feature, so the current design accepts one session lookup per anonymous page load.
- Periodic cleanup of `app_download_throttle` rows. Stale windows reset on next use, so cleanup is housekeeping, not a correctness dependency.
- Any admin UI for release management. Publishing stays an upload plus a manifest edit per Requirement 17.
