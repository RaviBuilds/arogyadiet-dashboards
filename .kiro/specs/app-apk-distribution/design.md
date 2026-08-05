# Design Document

## Overview

This design delivers two public APK download pages inside the customer portal, backed by a private Supabase Storage bucket, gated by a Cloudflare Turnstile challenge and a per-IP rate limit, and advertised by server-rendered QR codes on the Customer and Rider login pages.

The shape of the solution is dictated by one invariant from the requirements (Req 6.17): **no route serves an APK_Object without a prior successful Turnstile_Token verification.** Everything else follows from that. A private bucket is required because a public object URL is a permanent bypass. A `POST` grant endpoint is required because a `GET` redirect is trivially replayable. A short-lived signed URL is required so that the URL a bot does obtain is worthless minutes later.

Three properties of the existing codebase shape the implementation:

- `createAdminClient()` (`src/lib/supabase/admin.ts`) already provides a service-role client. It is the only client that can read a private bucket or mint a signed URL, and it must stay server-side.
- `evaluateOtpPolicy` (`src/lib/otp/otpPolicy.ts`) plus `otpThrottleRepository` establish the house pattern for throttling: policy semantics separated from persistence, timestamps as epoch milliseconds, decisions returned as discriminated values with a `retryAfterSeconds`. The download rate limit follows the same shape, with one deliberate divergence documented under [Rate limiting](#rate-limiting).
- `cacheComponents` is **not** enabled in `next.config.ts`, so the previous caching model applies: segment-level `export const revalidate`, not `use cache` / `cacheLife`. Verified against `node_modules/next/dist/docs/01-app/01-getting-started/08-caching.md` and `02-guides/caching-without-cache-components.md`.

### Non-goals

Building, signing, and uploading APKs stay manual operator activities (Req 17). No admin UI for release management is in scope. No database tables other than the throttle table are introduced. No changes to any authenticated portal surface beyond adding a QR block to two login pages.

## Architecture

### Component map

```
┌─ src/app/customer/(public)/app/[slug]/page.tsx ─────────── RSC, revalidate=300
│    ├── AppDownloadHero            (RSC)  phone mockup + copy
│    ├── ReleaseDetails             (RSC)  version / size / date / whatsNew
│    ├── InstallGuide               (RSC)  static ordered steps
│    └── DownloadControl            (client) Turnstile widget + grant call
│
├─ src/app/api/app-download/grant/route.ts ──────────────── POST only, uncached
│    ├── verifyTurnstileToken()      → Cloudflare siteverify
│    ├── claimDownloadGrant()        → atomic rate-limit claim (RPC)
│    ├── readReleaseManifest()       → private bucket read + parse
│    └── createSignedDownloadUrl()   → 120s signed URL
│
├─ src/lib/appDistribution/ ─────────────────────────────── pure + IO modules
│    ├── slug.ts            parseAppSlug
│    ├── manifest.ts        parseReleaseManifest / serializeReleaseManifest
│    ├── storage.ts         readReleaseManifest / createSignedDownloadUrl
│    ├── turnstile.ts       verifyTurnstileToken
│    ├── rateLimit.ts       retryAfterSeconds (pure)
│    ├── config.ts          env resolution
│    └── content.ts         per-slug copy, features, screenshot paths
│
├─ src/repositories/appDownloadThrottleRepository.ts ────── RPC wrapper
├─ src/shared/components/app-download/AppDownloadQrBlock.tsx  (RSC)
├─ src/lib/appDistribution/qr.ts                              QR SVG generation
└─ src/middleware.ts ───────────────────────────────────── /app allowlist edits
```

### Download request flow

```
Browser                      Download_Page        Grant_Endpoint     Cloudflare      Supabase
  │                               │                     │                │              │
  │─ GET /app/customer ──────────>│                     │                │              │
  │                               │─ readReleaseManifest ──────────────────────────────>│
  │<─ HTML (version, size, date, disabled button) ──────│                │              │
  │                                                     │                │              │
  │─ load turnstile script ─────────────────────────────────────────────>│              │
  │<─ widget renders, challenge solved, token issued ───────────────────>│              │
  │  (button becomes enabled)                           │                │              │
  │                                                     │                │              │
  │─ POST /api/app-download/grant {slug, token} ───────>│                │              │
  │                                                     │─ siteverify ──>│              │
  │                                                     │<─ success ─────│              │
  │                                                     │─ claim grant (RPC) ──────────>│
  │                                                     │<─ granted, 3/5 used ──────────│
  │                                                     │─ read manifest ──────────────>│
  │                                                     │─ createSignedUrl(120s) ──────>│
  │<─ 200 {url, version, filename} ─────────────────────│                │              │
  │                                                     │                │              │
  │─ GET <signed url> ──────────────────────────────────────────────────────────────────>│
  │<─ APK bytes, Content-Disposition: attachment ───────────────────────────────────────│
```

The page render and the grant call are deliberately decoupled: the page is cacheable and contains no secret or signed URL (Req 9.9), while the grant call is per-visitor, uncached, and the only thing that touches the bucket's contents.

### Why the page renders without a challenge

Rendering the page requires the manifest, which is metadata, not the binary. Gating the HTML would force every visitor through a challenge before they can read what they are about to install, and would make the page uncacheable, for no protective gain. The challenge sits exactly where the cost is: the bytes.

## File layout

| Path | Kind | Purpose |
| --- | --- | --- |
| `src/app/customer/(public)/layout.tsx` | RSC | Minimal public shell — no sidebar, no session, no portal chrome |
| `src/app/customer/(public)/app/[slug]/page.tsx` | RSC | Download_Page for both slugs via one dynamic segment |
| `src/app/customer/(public)/app/[slug]/DownloadControl.tsx` | Client | Turnstile widget, grant call, download trigger |
| `src/app/api/app-download/grant/route.ts` | Route handler | Download_Grant_Endpoint |
| `src/lib/appDistribution/slug.ts` | Pure | `parseAppSlug` |
| `src/lib/appDistribution/manifest.ts` | Pure | Manifest_Parser / Manifest_Serializer |
| `src/lib/appDistribution/storage.ts` | IO | Private bucket reads, signed URL creation |
| `src/lib/appDistribution/turnstile.ts` | IO | Token_Verifier |
| `src/lib/appDistribution/rateLimit.ts` | Pure | Window arithmetic, `Retry-After` computation |
| `src/lib/appDistribution/qr.ts` | IO-free | QR SVG generation via `qrcode` |
| `src/lib/appDistribution/config.ts` | Pure | Env var resolution with explicit absent/empty results |
| `src/lib/appDistribution/content.ts` | Pure | Per-slug copy, feature list, screenshot path, page title |
| `src/repositories/appDownloadThrottleRepository.ts` | IO | `claim_app_download_grant` RPC wrapper |
| `src/shared/components/app-download/AppDownloadQrBlock.tsx` | RSC | QR_Block, used by both login pages |
| `src/validations/appDistribution.ts` | Pure | Zod schemas for manifest and grant request body |
| `scripts/create-app-download-throttle.sql` | SQL | Throttle table + RPC + RLS |

One dynamic `[slug]` segment serves both apps rather than two sibling folders. The slug is validated by `parseAppSlug` and anything else calls `notFound()`, satisfying Req 1.6 with a single code path. Requirement 1.3 names `/app/{App_Slug}/page.tsx` as the location; the dynamic segment is the same route surface expressed once, and the design treats that as compliant.

`(public)` is a new route group beside the existing `(auth)` and `(main)`. It gets its own layout so the download pages inherit no session-dependent chrome — important because Req 1.4 requires byte-identical output for anonymous and authenticated visitors.

## Components and interfaces

### Slug parsing

```ts
// src/lib/appDistribution/slug.ts
export type AppSlug = "customer" | "rider";
export function parseAppSlug(value: unknown): AppSlug | null;
```

Total function, no throw. Callers decide: the page calls `notFound()`, the grant endpoint returns 400 (Req 6.9).

### Release manifest

```ts
// src/lib/appDistribution/manifest.ts
export interface ReleaseManifest {
  version: string;    // Semver_String
  filename: string;
  size: number;       // bytes, non-negative integer
  sha256: string;     // 64 lowercase hex
  releasedAt: string; // ISO 8601 with explicit UTC offset
  whatsNew: string;
}

export type ManifestParseError =
  | { kind: "MALFORMED_JSON"; message: string }
  | { kind: "INVALID_FIELD"; field: string; message: string };

export function parseReleaseManifest(
  text: string,
): { ok: true; manifest: ReleaseManifest } | { ok: false; error: ManifestParseError };

export function serializeReleaseManifest(manifest: ReleaseManifest): string;
```

Validation is a Zod schema in `src/validations/appDistribution.ts`, matching the project convention of Zod for every external payload. `JSON.parse` failure maps to `MALFORMED_JSON` (Req 4.7); the first Zod issue's path maps to `INVALID_FIELD.field` (Req 4.8).

`serializeReleaseManifest` writes the six keys in a fixed order with two-space indentation and no extra whitespace. Fixed key order is what makes the round-trip properties in Req 4.10 and 4.11 hold as string equality on re-serialization, and it keeps manual manifest edits reviewable as diffs.

Semver is validated as `/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/` — the no-leading-zeros rule from the glossary is in the regex, not a separate check.

### Storage access

```ts
// src/lib/appDistribution/storage.ts
export const RELEASE_BUCKET = "app-releases";
export const SIGNED_URL_TTL_SECONDS = 120;

export type ManifestReadResult =
  | { ok: true; manifest: ReleaseManifest }
  | { ok: false; reason: "UNAVAILABLE" | "INVALID"; detail: string };

export async function readReleaseManifest(slug: AppSlug): Promise<ManifestReadResult>;

export async function createSignedDownloadUrl(
  slug: AppSlug,
  filename: string,
): Promise<{ ok: true; url: string } | { ok: false; detail: string }>;
```

`readReleaseManifest` downloads `{slug}/latest.json` through `createAdminClient().storage.from(RELEASE_BUCKET).download(...)`, converts the blob to text, and hands it to `parseReleaseManifest`. A storage error yields `UNAVAILABLE`; a parse error yields `INVALID`. Both map to HTTP 503 at the endpoint (Req 6.11, 6.12) and to the degraded page state (Req 9.8), which is why the reasons are distinguished for logging but collapse to the same visitor-facing outcome.

`createSignedDownloadUrl` calls `createSignedUrl(`${slug}/${filename}`, 120, { download: filename })`. The `download` option sets `Content-Disposition: attachment` with the versioned filename, so the browser saves `arogyadiet-customer-v1.0.0.apk` rather than rendering or guessing a name. The stored object's content type is Android_Media_Type (Req 3.9), set at upload time, not here.

Both functions are server-only. `src/lib/appDistribution/storage.ts` carries `import "server-only"` so an accidental client import fails at build rather than leaking the service-role key.

### Turnstile verification

```ts
// src/lib/appDistribution/turnstile.ts
export type TurnstileVerdict =
  | { kind: "VALID" }
  | { kind: "REJECTED"; codes: string[] }
  | { kind: "UNAVAILABLE"; detail: string }
  | { kind: "MISCONFIGURED" };

export async function verifyTurnstileToken(
  token: string,
  remoteIp: string | null,
): Promise<TurnstileVerdict>;
```

Posts `secret`, `response`, and `remoteip` as `application/x-www-form-urlencoded` to the Siteverify_Service. Four verdicts, four distinct outcomes:

| Verdict | HTTP | Requirement |
| --- | --- | --- |
| `VALID` | proceeds to rate-limit claim | 6.4 |
| `REJECTED` | 403 | 6.7 |
| `UNAVAILABLE` | 503 | 6.10 |
| `MISCONFIGURED` | 503 + server-side error log | 14.8 |

`MISCONFIGURED` is returned without a network call when `TURNSTILE_SECRET_KEY` is absent or empty, so a missing key produces one clear log line instead of a stream of opaque Cloudflare errors.

The `error-codes` array from Cloudflare is logged server-side and carried in `REJECTED.codes` for logging only. It never reaches the response body (Req 6.14) because it distinguishes "token already redeemed" from "invalid secret", which is information an attacker can use to probe configuration.

Cloudflare tokens are single-use and short-lived on Cloudflare's side, so replay protection is inherited rather than reimplemented: a replayed token comes back as `REJECTED` with `timeout-or-duplicate`.

A 5-second `AbortSignal.timeout` bounds the siteverify call so a Cloudflare stall cannot hold a serverless invocation open; a timeout surfaces as `UNAVAILABLE`.

### Rate limiting

Requirement 7 needs a counter that survives across serverless invocations, so it lives in Postgres.

**Divergence from the `otpPolicy` precedent, stated explicitly.** `evaluateOtpPolicy` is a pure reducer whose result the caller persists — read, decide, write. That is a read-modify-write race: two concurrent requests both read `grant_count = 4`, both decide "allowed", and six grants are issued against a limit of five. For OTP that race is harmless because the attacker gains one extra SMS. For download grants the race is precisely what an abuser exploits, by firing concurrent requests. So the check-and-increment is done atomically inside a single SQL statement, and the SQL function is the source of truth for the policy.

What stays pure and testable in TypeScript is the window arithmetic:

```ts
// src/lib/appDistribution/rateLimit.ts
export const DOWNLOAD_GRANT_LIMIT = 5;
export const DOWNLOAD_WINDOW_SECONDS = 600;

export function retryAfterSeconds(
  windowStartedAtMs: number,
  nowMs: number,
): number;

export function hashClientIp(ip: string | null): string;
```

`retryAfterSeconds` returns whole seconds until the fixed window closes, never negative, and is property-tested. `hashClientIp` returns `sha256(ip)` as lowercase hex, and a constant sentinel hash when `ip` is null so that unidentifiable clients share one bucket instead of escaping the limit (Req 7.7). Hashing keeps raw IP addresses out of the table; the counter only needs equality, never the address itself.

```ts
// src/repositories/appDownloadThrottleRepository.ts
export interface GrantClaim {
  granted: boolean;
  retryAfterSeconds: number;
}

export async function claimDownloadGrant(
  ipHash: string,
  slug: AppSlug,
): Promise<GrantClaim>;
```

Thin wrapper over the RPC. On RPC failure it returns `{ granted: true, retryAfterSeconds: 0 }` — fail-open. The reasoning: Turnstile has already established a human is present, and a throttle-table outage should not stop legitimate installs. The cost of failing open is bounded by the challenge that already passed; the cost of failing closed is a total distribution outage from a non-critical table. The failure is logged as an error so the outage is visible.

### Grant endpoint

```
POST /api/app-download/grant
Request:  { "slug": "customer" | "rider", "token": "<turnstile token>" }
Response: 200 { "url": string, "version": string, "filename": string }
          400 { "error": "INVALID_REQUEST" }
          403 { "error": "VERIFICATION_FAILED" }
          429 { "error": "RATE_LIMITED", "retryAfterSeconds": number }   + Retry-After
          503 { "error": "UNAVAILABLE" }
```

Ordering is fixed and matters:

1. Parse and validate the body with Zod. Missing token → 400 (Req 6.8). Bad slug → 400 (Req 6.9).
2. Resolve the client IP from `x-forwarded-for`, first entry, trimmed (Req 7.6).
3. Verify the Turnstile token. Non-`VALID` verdicts short-circuit (Req 6.2 — verification precedes any signed URL).
4. Claim a rate-limit grant. Not granted → 429 with `Retry-After` (Req 7.2, 7.3). Placed after verification per Req 7.5, so a bot spraying invalid tokens cannot consume a real user's quota from a shared NAT address.
5. Read and parse the manifest. Failure → 503 (Req 6.11, 6.12).
6. Create the signed URL. Failure → 503.
7. Return the URL, version, and filename.

Only `POST` is exported, so Next.js answers any other method with 405 (Req 6.1). `export const dynamic = "force-dynamic"` is set for clarity even though `POST` handlers are never cached. The route sits under `/api`, which the existing middleware early-returns on, so it needs no allowlist entry (Req 2.7).

Requirement 6.15 and 6.16 are satisfied structurally: the endpoint path contains no version, and the version it serves comes from the manifest at request time. Publishing a release is an upload plus a manifest edit, with no deploy.

### Download page

```tsx
// src/app/customer/(public)/app/[slug]/page.tsx
export const revalidate = 300;
export async function generateStaticParams(): Promise<{ slug: AppSlug }[]>;
export async function generateMetadata({ params }): Promise<Metadata>;
export default async function AppDownloadPage({ params }): Promise<JSX.Element>;
```

`params` is awaited — it is a Promise in this Next.js version. The page validates the slug, calls `notFound()` on failure, reads the manifest, and renders. `revalidate = 300` means the manifest is read at most once per five minutes per slug rather than on every visit, which matters because a scraper hitting the page repeatedly would otherwise hammer storage. A new release becomes visible within five minutes with no deploy.

Manifest failure does not fail the page. `ReleaseDetails` receives `manifest: ReleaseManifest | null` and renders a "release details temporarily unavailable" notice when null, while the hero, copy, install guide, and download control still render (Req 9.8).

Per-slug copy lives in `content.ts` as a typed record, keeping the page a layout shell:

```ts
export interface AppContent {
  title: string;
  tagline: string;
  description: string;
  features: { icon: LucideIcon; title: string; copy: string }[];
  screenshot: { src: string; alt: string };
}
export const APP_CONTENT: Record<AppSlug, AppContent>;
```

Screenshots are local files under `public/app-screenshots/`. This avoids touching `next.config.ts` — its `images.remotePatterns` currently allows only `/storage/v1/object/public/**` on the Supabase host, which the now-private bucket no longer serves.

The phone frame is CSS: a rounded bordered container with a notch pseudo-element wrapping a `next/image`. No new dependency, and `alt` text comes from `content.ts` (Req 9.10).

### Download control (client)

The only client component in this feature.

```tsx
"use client";
type DownloadState =
  | { kind: "LOADING_WIDGET" }
  | { kind: "AWAITING_CHALLENGE" }
  | { kind: "READY"; token: string }
  | { kind: "REQUESTING" }
  | { kind: "DOWNLOADING"; version: string }
  | { kind: "RATE_LIMITED"; retryAfterSeconds: number }
  | { kind: "CHALLENGE_FAILED" }
  | { kind: "WIDGET_UNAVAILABLE" }
  | { kind: "ERROR"; message: string };
```

An explicit state union rather than a cluster of booleans, because Req 5 enumerates eight distinct visitor-facing states and a boolean soup makes "disabled but for which reason" unrepresentable.

The Turnstile script is loaded with `next/script` at `strategy="afterInteractive"` and rendered explicitly via `turnstile.render()` in an effect, so the widget's lifecycle is owned by the component. Callbacks map to transitions: `callback` → `READY`, `error-callback` → `CHALLENGE_FAILED`, `expired-callback` → reset widget and return to `AWAITING_CHALLENGE` (Req 5.9). `onError` on the `Script` tag → `WIDGET_UNAVAILABLE` (Req 5.10).

The button is disabled in every state except `READY` (Req 5.4, 5.5). On activation it POSTs to the grant endpoint and, on success, triggers the download by assigning `window.location.href` to the signed URL. Assignment rather than a synthetic anchor click, because `Content-Disposition: attachment` on the response means navigation downloads the file without leaving the page — no `target="_blank"` popup, no revoked-object-URL bookkeeping.

The token is consumed by one request and then discarded, with the widget reset. Cloudflare rejects a reused token anyway; discarding it locally means the visitor sees a fresh challenge instead of a confusing 403.

Accessibility: the state message renders in an `aria-live="polite"` region (Req 5.14), the button carries `aria-describedby` pointing at it, and the Turnstile widget is keyboard-operable by default (Req 5.13) since it is a focusable iframe with no custom key handling layered on.

Non-Android and no-JS handling:

- The Android-only notice (Req 11) is decided client-side from `navigator.userAgent`, because user-agent sniffing on the server would vary the cached HTML per visitor and defeat `revalidate`. The notice replaces the download control and the widget.
- `<noscript>` in the page renders the JavaScript-required message (Req 5.11). It sits in the server-rendered page, not the client component, so it is present regardless of hydration.
- When `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is absent, the page omits `DownloadControl` entirely, renders the unavailable notice, and logs a server-side warning (Req 5.12). Checked on the server so no broken widget ever reaches the browser.

### QR code generation

```ts
// src/lib/appDistribution/qr.ts
export async function renderQrSvg(url: string): Promise<string>;
```

Wraps `qrcode`'s `toString(url, { type: "svg", errorCorrectionLevel: "M", margin: 1 })`. Pure computation, no network (Req 12.3).

```tsx
// src/shared/components/app-download/AppDownloadQrBlock.tsx
export async function AppDownloadQrBlock({
  slug,
  className,
}: { slug: AppSlug; className?: string }): Promise<JSX.Element | null>;
```

An async Server Component. It resolves `NEXT_PUBLIC_APP_DOWNLOAD_BASE_URL`, returns `null` with a warning log when absent (Req 12.7), builds the absolute Download_Page URL, renders the SVG inline via `dangerouslySetInnerHTML`, and prints the URL as selectable text beneath.

`dangerouslySetInnerHTML` is safe here in a way worth stating: the input to `renderQrSvg` is an internally constructed URL, never visitor input, and `qrcode` emits a fixed SVG grammar. No untrusted string reaches the markup.

Placement is a single element in each login page:

- `LoginBrandPanel.tsx` — inside the existing middle group, after the `FEATURES` list. The panel is already `hidden … lg:flex`, so the QR block inherits large-viewport-only visibility from its parent and needs no breakpoint class of its own. This satisfies Req 13.3–13.6 with zero JavaScript, since visibility is pure CSS. `LoginBrandPanel` is currently a sync function and becomes `async` to await `renderQrSvg`.
- `src/app/rider/(auth)/login/page.tsx` — a sibling panel carrying its own `hidden lg:flex`, since the rider login has no equivalent desktop panel to nest inside.

Requirement 12.5 is structural: the block only ever receives a slug and builds a page URL from it. It has no access to storage and cannot construct a signed URL.

### Middleware changes

Four edits to `src/middleware.ts`, each additive and scoped by an `/app` prefix test.

```ts
const PUBLIC_APP_PATH_PREFIX = "/app";

function isPublicAppPath(pathname: string, portalPath: string): boolean {
  const path =
    portalPath && pathname.startsWith(`${portalPath}/`)
      ? pathname.slice(portalPath.length)
      : pathname;
  return path === PUBLIC_APP_PATH_PREFIX || path.startsWith(`${PUBLIC_APP_PATH_PREFIX}/`);
}
```

Stripping `portalPath` first mirrors the existing `isCustomerCategoryRouteDenied` helper, so a direct hit on the rewritten `/customer/app/customer` behaves identically to `/app/customer`.

1. **Unauthenticated allowlist.** Add `!isPublicAppPath(url.pathname, portalPath)` to the condition guarding the `/login` redirect (Req 2.1, 2.2).
2. **Customer portal gate bypass.** Guard the `currentSubdomain === "customer"` branch with an early `isPublicAppPath` check that calls `timer.done()` and returns `response` before the role/onboarding evaluation. This is the edit that matters most: without it, a signed-in admin or rider scanning the QR is bounced to `/unauthorized` (Req 2.3, 2.4).
3. **Landing redirect.** Already scoped to exactly `/`, `/login`, and `/signup`, so `/app/*` is unaffected. Requirement 2.6 is satisfied by the current code; the design adds a regression test rather than a change.
4. **No rewrite change.** The existing portal rewrite still applies, so `/app/customer` on the customer subdomain resolves to `/customer/app/customer` and lands on the `(public)` route group (Req 2.5).

Everything outside the `/app` prefix is untouched (Req 2.8). Notably the Supabase session lookup still runs for `/app/*` requests — the middleware's structure makes skipping it invasive, and the page ignores the result. This costs one `auth.getUser()` on an anonymous page load. Accepted for this iteration; an early return for public app paths placed beside the existing `/api` and `/sandbox` returns would remove it, and is recorded as a follow-up rather than folded in here, because it moves the rewrite logic and widens the blast radius beyond this feature.

## Data Models

The only persisted state this feature introduces is the rate-limit counter. The Release_Manifest is the other data model, but it lives as a storage object rather than a table; its shape is defined under [Release manifest](#release-manifest).

```sql
-- scripts/create-app-download-throttle.sql
create table if not exists public.app_download_throttle (
  ip_hash            text        not null,
  app_slug           text        not null check (app_slug in ('customer','rider')),
  grant_count        integer     not null default 0,
  window_started_at  timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  primary key (ip_hash, app_slug)
);

alter table public.app_download_throttle enable row level security;
-- No policies: service-role only, consistent with RLS-on-every-table (docs/02-database.md).
```

The atomic claim:

```sql
create or replace function public.claim_app_download_grant(
  p_ip_hash text,
  p_app_slug text,
  p_limit integer,
  p_window_seconds integer
) returns table (granted boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public
as $$ /* single upsert: reset the window when stale, else increment when under
        the limit; return the decision and remaining window */ $$;
```

The whole decision is one statement under the primary key's row lock, so concurrent requests from the same IP serialize and the limit holds exactly. `security definer` with a pinned `search_path` follows the project's existing RPC conventions.

Rows are self-expiring in effect — a stale window resets on next use — so no cron cleanup is required for correctness. A periodic delete of rows untouched for a day is a housekeeping nicety, not a dependency, and is left out of scope.

## Correctness Properties

The invariants this design must hold, stated so they can be tested rather than assumed.

### Property 1: No unverified byte

For every code path that yields an APK_Object URL, a `VALID` Turnstile verdict precedes it in the same request. Enforced structurally: `createSignedDownloadUrl` is called from exactly one place, step 6 of the grant endpoint, and steps 3 and 4 short-circuit before it. Tested by asserting zero calls to the storage and manifest functions when the verdict is `REJECTED`, `UNAVAILABLE`, or `MISCONFIGURED`.

**Validates: Requirements 6.2, 6.17**

### Property 2: Manifest round-trip

For all valid `ReleaseManifest` values `m`, `parseReleaseManifest(serializeReleaseManifest(m))` yields `m`. For all text accepted by the parser, re-serializing and re-parsing yields the same value as the first parse. Fixed key ordering in the serializer is what makes this hold.

**Validates: Requirements 4.10, 4.11**

### Property 3: Rate limit is exact under concurrency

For any number of simultaneous requests from one `(ip_hash, app_slug)` pair within one window, the count of `granted = true` results never exceeds `DOWNLOAD_GRANT_LIMIT`. Guaranteed by performing check-and-increment in a single SQL statement under the primary key's row lock; a read-decide-write split would violate this.

**Validates: Requirements 7.1, 7.2**

### Property 4: Retry-After is bounded and monotonic

`retryAfterSeconds(windowStartedAtMs, nowMs)` always returns a value in `[0, DOWNLOAD_WINDOW_SECONDS]`, and for a fixed window start it never increases as `nowMs` advances.

**Validates: Requirements 7.3, 7.4**

### Property 5: QR round-trip

For every absolute URL `u` passed to `renderQrSvg`, decoding the produced SVG yields exactly `u`. This is what makes a scanned code land on the right page.

**Validates: Requirements 12.9**

### Property 6: Prefix matching admits no near miss

`isPublicAppPath` returns true for `/app`, `/app/...`, and their portal-rewritten forms, and false for every other path including `/apps` and `/applications`. A naive `startsWith("/app")` violates this and would silently make unrelated routes public.

**Validates: Requirements 2.8**

### Property 7: Anonymous and authenticated renders are identical

For a given slug and manifest state, the Download_Page markup does not vary with session state. Guaranteed by the `(public)` layout reading no session and the page taking no identity input.

**Validates: Requirements 1.4, 1.5**

### Property 8: No secret in any response

No response body or rendered markup from this feature contains `TURNSTILE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, a Cloudflare `error-codes` payload, or an unsigned storage object path.

**Validates: Requirements 6.14, 9.9, 14.4**

## Error handling

| Condition | Detected by | Visitor sees | Server records |
| --- | --- | --- | --- |
| Unknown slug | `parseAppSlug` | 404 page / 400 JSON | nothing |
| Manifest missing or unreadable | `readReleaseManifest` | Page: details unavailable. Grant: 503 | error with slug and storage detail |
| Manifest invalid JSON or field | `parseReleaseManifest` | same as above | error naming the offending field |
| Turnstile script blocked | `Script onError` | "verification unavailable, retry later" | nothing (client-side) |
| Challenge failed | `error-callback` | retry message, button stays disabled | nothing |
| Token expired before use | `expired-callback` | widget resets silently | nothing |
| Token rejected by Cloudflare | `verifyTurnstileToken` | 403 → "verification failed, please retry" | warning with error codes |
| Siteverify unreachable | `verifyTurnstileToken` | 503 → "temporarily unavailable" | error with detail |
| `TURNSTILE_SECRET_KEY` missing | `verifyTurnstileToken` | 503 → "temporarily unavailable" | error, configuration |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` missing | page render | "downloads temporarily unavailable" | warning, configuration |
| `NEXT_PUBLIC_APP_DOWNLOAD_BASE_URL` missing | `AppDownloadQrBlock` | QR block omitted | warning, configuration |
| Rate limit reached | `claimDownloadGrant` | 429 → "limit reached, retry in N minutes" | info |
| Throttle RPC fails | `claimDownloadGrant` | download proceeds | error (fail-open, visible) |
| Signed URL creation fails | `createSignedDownloadUrl` | 503 → "temporarily unavailable" | error with object path |

Every server-side branch degrades to a stated visitor-facing message. None leaks a key, an object path, or a Cloudflare payload (Req 6.14).

## Security considerations

**The private bucket is the load-bearing control.** If `app-releases` is public, every other control here is decoration. Bucket configuration is therefore a task with an explicit verification step: an anonymous `GET` against an unsigned object URL must return 400/404, not the binary.

**Service-role key containment.** `storage.ts` and `turnstile.ts` carry `import "server-only"`. `TURNSTILE_SECRET_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are read only inside those modules. Neither is prefixed `NEXT_PUBLIC_`, so neither can reach a client bundle (Req 14.3, 14.4).

**Signed URL exposure window.** A 120-second TTL means a leaked URL is worthless almost immediately, while still allowing a slow connection to start the transfer. Supabase signed URLs are not single-use, so a URL shared within its window works more than once; the TTL, not uniqueness, is the bound. Stated so nobody assumes single-use semantics.

**Turnstile hostname binding.** The Turnstile site configuration must list the customer subdomain host (Req 14.6). Without it, tokens minted on our page are rejected. With it, a token minted on an attacker's page against our site key is rejected too.

**Fail-open on the throttle, fail-closed on verification.** Deliberate asymmetry. Verification failure means we cannot establish a human is present, so nothing is issued. Throttle failure means we cannot count, but a human is already established, so the download proceeds. Both paths log.

**IP hashing.** Raw addresses are never stored. `x-forwarded-for` is attacker-controllable in principle, but on Vercel the platform sets it and the first entry is the real client, so the derived value is trustworthy in this deployment. On a shared NAT this limits a whole office to five downloads per ten minutes per app, which is acceptable for an install-once artifact.

**APK contents are readable by anyone who obtains the file.** The challenge limits bulk collection; it is not confidentiality. Requirement 15 stands independently: no secrets in either Capacitor build.

## Testing strategy

Vitest, `npm run test`, following the project's existing property-test conventions (`fast-check` is already a dev dependency).

**Property tests**

- `parseReleaseManifest` ∘ `serializeReleaseManifest` round-trips over arbitrary valid manifests (Req 4.10) and over arbitrary accepted JSON text (Req 4.11).
- `retryAfterSeconds` is always in `[0, DOWNLOAD_WINDOW_SECONDS]` and monotonically non-increasing as `nowMs` advances within a window.
- `renderQrSvg` output decodes back to the input URL for arbitrary valid absolute URLs (Req 12.9), using a QR decoder in the test only.
- `parseAppSlug` accepts exactly two strings and rejects everything else.

**Unit tests**

- `verifyTurnstileToken` verdict mapping for success, each documented Cloudflare error code, network failure, timeout, and missing secret.
- Grant endpoint ordering: assert that a `REJECTED` verdict results in zero calls to `claimDownloadGrant`, `readReleaseManifest`, and `createSignedDownloadUrl`. This is the executable form of Req 6.2 and 6.17.
- Grant endpoint status codes for all seven documented outcomes, plus `Retry-After` presence on 429.
- `isPublicAppPath` against `/app`, `/app/customer`, `/customer/app/rider`, `/apps`, `/application`, and `/` — the near-miss cases are the ones that matter, since a naive `startsWith("/app")` would wrongly match `/applications`.
- Manifest read failure yields a page that still renders hero and install guide.

**Component tests**

- `DownloadControl` transitions: button disabled in every non-`READY` state; expiry resets to `AWAITING_CHALLENGE`; 429 renders the limit message; script error renders the unavailable message.
- `aria-live` region receives each state change.
- `AppDownloadQrBlock` returns null when the base URL env var is empty.

**Manual verification** (cannot be automated here)

- Anonymous unsigned bucket URL is denied.
- Full install on a physical Android device, including the unknown-sources prompt and the Play Protect screen, to confirm the Install_Guide text matches what the device actually shows.
- QR scan from a phone camera against the deployed customer login page.

## Configuration

| Variable | Scope | Absent behavior |
| --- | --- | --- |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | client + server | Download control suppressed, notice shown, warning logged |
| `TURNSTILE_SECRET_KEY` | server only | Grant endpoint 503, error logged |
| `NEXT_PUBLIC_APP_DOWNLOAD_BASE_URL` | client + server | QR blocks omitted, warning logged |
| `SUPABASE_SERVICE_ROLE_KEY` | server only | already required by the app |

`config.ts` centralizes resolution so each variable is read in exactly one place and its absent case is a value, not a thrown error. Rotation is a Vercel environment change plus a redeploy, with no code edit (Req 14.7).

New dependency: `qrcode` plus `@types/qrcode`, pinned exactly. Turnstile needs no package — it is a script tag and a form POST.

## Requirements traceability

| Requirement | Where satisfied |
| --- | --- |
| 1 Public pages | `(public)/app/[slug]/page.tsx`, `(public)/layout.tsx` |
| 2 Middleware exemptions | `isPublicAppPath` + four middleware edits |
| 3 Private storage | Bucket configuration task, `storage.ts` |
| 4 Manifest format | `manifest.ts`, `validations/appDistribution.ts` |
| 5 Turnstile on page | `DownloadControl.tsx`, `<noscript>` in page |
| 6 Verification and grant | `api/app-download/grant/route.ts`, `turnstile.ts` |
| 7 Rate limiting | `claim_app_download_grant` RPC, `rateLimit.ts`, repository |
| 8 Version-distinct filenames | Manifest `filename` + release procedure |
| 9 Page content | `content.ts`, `ReleaseDetails`, `AppDownloadHero` |
| 10 Install guide | `InstallGuide` RSC |
| 11 Platform notice | `DownloadControl` user-agent branch |
| 12 QR generation | `qr.ts`, `AppDownloadQrBlock.tsx` |
| 13 QR placement | `LoginBrandPanel.tsx`, rider login `page.tsx` |
| 14 Configuration | `config.ts`, `server-only` imports |
| 15 Build security | Release verification step (manual) |
| 16 Repository hygiene | `.gitignore`, remove tracked `Arogya-rider.apk` |
| 17 Release operations | Documented procedure, no code path |

## Open questions

1. **Rate limit calibration.** Five grants per IP per ten minutes per app is a starting figure, not a measured one. A shared office NAT or a corporate proxy could hit it legitimately. Worth revisiting once real traffic exists; the constants are in one module for that reason.
2. **Turnstile widget mode.** Managed mode is assumed, which is usually invisible but can present an interactive checkbox. If the client wants a guaranteed zero-interaction experience, invisible mode is the alternative, at some loss of bot-detection signal.
3. **App screenshots.** `public/app-screenshots/` needs one image per app. Not yet produced, and the phone mockup cannot be finished without them.
