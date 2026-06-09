# Customer Dashboard Performance Audit

**Target:** `src/app/customer/(main)/dashboard/page.tsx`  
**Audit date:** June 9, 2026  
**Scope:** Dashboard page + direct imports + parent layout shell (shared on every dashboard visit)

---

## Executive Summary

The dashboard **page is correctly implemented as an async Server Component** (no `"use client"` on the page). That is a strong foundation. The slow load is driven by:

1. **Triple auth/user resolution** across middleware, layout, and page (3× `getUser()`, 3× `users` queries).
2. **A sequential data waterfall** after an initial `Promise.all` (pause-credit count → optional repair → upcoming meals).
3. **Heavy client shell** loaded on every visit (sidebar, header, cart, notifications, OneSignal).
4. **LCP image gaps** — hero `Image` missing `sizes`; decorative logo uses unoptimized `<img>` via a client portal.
5. **`export const revalidate = 0`** — fully dynamic rendering with no static/cache benefit.

Lighthouse findings (LCP 1.7s, Speed Index 3.2s, unused JS, missing image dimensions) align with these issues.

---

## Current Bottlenecks

### Critical — Server Data Waterfall

| Step | Location | Query | Blocks |
|------|----------|-------|--------|
| 1 | `middleware.ts` | `auth.getUser()` + `users.roles` | Everything |
| 2 | `layout.tsx` | `auth.getUser()` + `users.full_name` | Page render |
| 3 | `page.tsx` | `auth.getUser()` + `users.id` | Dashboard data |
| 4 | `page.tsx` | `customer_profiles` | Subscription queries |
| 5 | `page.tsx` | `Promise.all` (addon_orders, subscriptions ×2) | Pause/meals |
| 6 | `page.tsx` | Pause credit count | Upcoming meals |
| 7 | `page.tsx` (rare) | `repairOverLimitPauseCredits()` + re-count | Upcoming meals |
| 8 | `page.tsx` | `subscription_daily_preferences` (7-day roster) | HTML output |

**Impact:** TTFB and LCP wait on cumulative round-trips. Steps 6–8 are sequential but could run in parallel once `activeSub` is known.

```65:79:src/app/customer/(main)/dashboard/page.tsx
export default async function CustomerDashboard() {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) redirect("/login");

  const { data: appUser, error: appUserError } = await supabase
    .from("users")
    .select("id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
```

```19:32:src/app/customer/(main)/layout.tsx
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) redirect("/login");

  const { data: profile } = await supabase
    .from("users")
    .select("id, full_name")
    .eq("auth_user_id", user.id)
    .maybeSingle();
```

```75:90:src/middleware.ts
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // FIX: Safely extract role code
  let roleCode = null;
  if (user) {
    const { data: userProfile } = await supabase
      .from("users")
      .select("roles(code)")
      .eq("auth_user_id", user.id)
      .single();
```

### High — Client JavaScript on Every Dashboard Load

The layout wraps all customer pages in a large client tree:

| Component | `"use client"` | Weight |
|-----------|----------------|--------|
| `CustomerSidebar` | Yes | 11 Lucide icons, Supabase browser client, router hooks |
| `CustomerHeader` | Yes | Sheet, mobile sidebar duplicate, cart, notifications |
| `CartSheet` | Yes | Zustand persist store, ScrollArea, Sheet |
| `NotificationBell` | Yes | Popover, ScrollArea, 30s polling, mount fetch to `/api/notifications` |
| `OneSignalProvider` | Yes | External OneSignal SDK (`afterInteractive`) |
| `DashboardFixedBackgroundLogo` | Yes | Portal + raw `<img>` (renders `null` until mount) |
| Root `Toaster` (`sonner`) | Client | Global toast UI on every route |

**Impact:** Unused JS in Lighthouse — cart, notifications, and OneSignal are not needed for first paint of subscription cards.

### High — LCP / Image Issues

**Hero banner (likely LCP element):**

```246:253:src/app/customer/(main)/dashboard/page.tsx
      <div className="relative w-full h-40 sm:h-48 md:h-56 rounded-xl overflow-hidden border border-slate-200 shadow-sm">
        <Image
          src="/banner.jpg"
          alt="Your Healthy Journey Starts Now"
          fill
          className="object-cover object-center"
          priority
        />
```

- `priority` is correct for LCP.
- **Missing `sizes`** — with `fill`, the browser may request an oversized variant.
- Container height is set (good for layout), but the `<img>` has no intrinsic dimensions until load (Lighthouse “missing dimensions”).
- Source is `public/banner.jpg` (JPEG). Next.js Image will serve WebP/AVIF, but only if the request goes through `/_next/image`.

**Background logo (decorative, still hurts metrics):**

```10:27:src/shared/components/customer/DashboardFixedBackgroundLogo.tsx
export function DashboardFixedBackgroundLogo() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    ...
      <img
        src="/logo.png"
        alt=""
        style={{ maxWidth: LOGO_MAX_WIDTH, opacity: LOGO_OPACITY }}
        className="w-[90vw] select-none object-contain"
      />
```

- Raw `<img>`, not `next/image`.
- No `width`/`height`.
- Client-only after hydration → delays decorative paint, adds client bundle.

**Sidebar logo:** also raw `<img src="/logo.png">` in `CustomerSidebar`.

### Medium — Caching & Streaming

```35:35:src/app/customer/(main)/dashboard/page.tsx
export const revalidate = 0;
```

- Forces dynamic rendering on every request; no ISR/cache benefit.
- No `loading.tsx` under `customer/(main)/dashboard/` — no streaming skeleton; user waits for all queries before any content.

### Medium — Over-fetching

```111:115:src/app/customer/(main)/dashboard/page.tsx
    supabase
      .from("subscriptions")
      .select(`*, subscription_plans ( name, duration_days )`)
      .eq("customer_profile_id", profile.id)
      .order("created_at", { ascending: false }),
```

- `select('*')` pulls all subscription columns when only a subset is rendered.

### Medium — Speed Index / Perceived Performance

```245:245:src/app/customer/(main)/dashboard/page.tsx
      <div className="relative z-10 max-w-5xl mx-auto space-y-10 animate-in fade-in slide-in-from-bottom-4">
```

- Entry animation on the main content wrapper delays visible paint (contributes to Speed Index 3.2s).
- `tw-animate-css` is imported globally in `globals.css`.

### Low — Dependency Notes

| Import | Where | Verdict |
|--------|-------|---------|
| `lucide-react` (10 icons) | Page (Server) | OK — SVG rendered server-side |
| `date-fns` | Page (Server) | OK — server-only; consider granular imports if bundle analysis flags it |
| `lucide-react` | Sidebar/Header (Client) | Contributes to client bundle; many icons |
| `recharts`, `@react-google-maps/api` | Not imported by dashboard | Not a dashboard issue; may appear in shared chunks if incorrectly imported elsewhere |
| `repairOverLimitPauseCredits` | Server action import | Rare path; heavy module (`manageMealActions.ts` ~650 lines) — verify it doesn’t leak into client bundle |

---

## Client/Server Component Architecture

### Component Tree

```
RootLayout (Server)
└── Toaster from sonner (Client — global)

CustomerLayout (Server)
├── OneSignalProvider (Client)
├── CustomerSidebar (Client) — desktop nav
└── div
    ├── CustomerHeader (Client)
    │   ├── Sheet + CustomerSidebar (Client — mobile nav duplicate)
    │   ├── CartSheet (Client)
    │   ├── NotificationBell (Client)
    │   └── Avatar (Client)
    └── main
        └── CustomerDashboard page (Server) ✓
            ├── DashboardFixedBackgroundLogo (Client island)
            ├── next/image hero (Server-rendered)
            └── Card, Badge, Alert, Button, Link (Server)
```

### Assessment

| Finding | Severity | Detail |
|---------|----------|--------|
| Page is Server Component | ✅ Good | Main dashboard HTML is server-rendered |
| `"use client"` not on page/layout dashboard content | ✅ Good | Interactive logic is not forced to the page root |
| Client boundary too high in **layout shell** | 🔴 High | Sidebar + header + notifications + cart load on every dashboard visit |
| `DashboardFixedBackgroundLogo` as client import | 🟡 Medium | Purely decorative; forces client JS + hydration for zero interactivity |
| UI primitives (Card, Alert, Badge, Button) | ✅ Good | Server Components — no unnecessary client boundaries |
| Duplicate `CustomerSidebar` | 🟡 Medium | Desktop instance + mobile Sheet instance both ship nav client code |

### `"use client"` Push-Down Opportunities

1. **Keep layout server; dynamically import** `CartSheet`, `NotificationBell`, `OneSignalProvider` with `ssr: false` or `loading: () => null`.
2. **Replace `DashboardFixedBackgroundLogo`** with a CSS background or server-rendered decorative element; if portal is required, lazy-load with `next/dynamic({ ssr: false })`.
3. **Extract mobile menu toggle** into a small client wrapper; keep welcome text server-rendered (requires layout refactor).
4. **Sidebar active-state** (`usePathname`) requires client — acceptable, but nav could be server-rendered with a thin client “active link highlight” overlay.

---

## Image Optimization Hitlist

| Asset | File | Issue | Priority | Fix |
|-------|------|-------|----------|-----|
| Hero banner | `/banner.jpg` | Missing `sizes` on `fill` Image | **P0 — LCP** | Add `sizes="(max-width: 768px) 100vw, 1024px"` (adjust for `max-w-5xl`) |
| Hero banner | `/banner.jpg` | JPEG source | P1 | Pre-compress; consider WebP/AVIF in `public/` as fallback |
| Hero banner | Container | No explicit `width`/`height` on Image | P1 | Keep container aspect ratio; or use fixed `width`/`height` instead of `fill` |
| Background logo | `/logo.png` | Raw `<img>`, no dimensions | P2 | Use `next/image` with explicit dimensions, or CSS `background-image` |
| Background logo | Client portal | Renders after hydration | P2 | Remove client boundary; render server-side or lazy-load |
| Sidebar logo | `/logo.png` | Raw `<img>`, no dimensions | P2 | `next/image` with `width={...} height={...}` |
| All static images | `next.config.ts` | No `formats`/`deviceSizes` tuning | P3 | Optional: configure `images.formats: ['image/avif', 'image/webp']` |

**Hero fix example (conceptual):**

```tsx
<Image
  src="/banner.jpg"
  alt="Your Healthy Journey Starts Now"
  fill
  priority
  sizes="(max-width: 640px) 100vw, (max-width: 1024px) 90vw, 1024px"
  className="object-cover object-center"
/>
```

---

## Data Fetching Waterfall — Detailed Map

```
Middleware:     getUser ──► users(roles)
                    │
Layout:         getUser ──► users(full_name)     ◄── DUPLICATE
                    │
Page:           getUser ──► users(id)          ◄── DUPLICATE
                    │
                customer_profiles
                    │
                Promise.all ──┬── addon_orders
                              ├── subscriptions (*)
                              └── subscriptions (PENDING)
                    │
                [if activeSub]
                    │
                pause_credits COUNT ──► [repair?] ──► re-COUNT   ◄── SEQUENTIAL
                    │
                upcomingMeals (7-day)                          ◄── SEQUENTIAL
                    │
                Render HTML
```

### Parallelization Opportunities

**After `activeSub` is resolved**, run in parallel:

```tsx
const [{ count }, { data: upcomingMeals }] = await Promise.all([
  supabase.from("subscription_daily_preferences")
    .select("*", { count: "exact", head: true })
    .eq("subscription_id", activeSub.id)
    .eq("is_paused", true),
  supabase.from("subscription_daily_preferences")
    .select(`preference_date, is_paused, meal_categories ( code ), addresses ( tag, street_1, city )`)
    .eq("subscription_id", activeSub.id)
    .gte("preference_date", todayStr)
    .lte("preference_date", nextWeekStr)
    .order("preference_date", { ascending: true }),
]);
```

**Deduplicate auth/profile** with `React.cache()`:

```tsx
// lib/customer/get-session.ts
import { cache } from "react";
export const getCustomerSession = cache(async () => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // single users + customer_profiles fetch
  return { supabase, user, appUser, profile };
});
```

Use in layout + page to collapse 3× auth into 1× per request.

**Streaming with Suspense:**

- Wrap “Upcoming Deliveries” grid in `<Suspense fallback={<MealsSkeleton />}>` with its own async child component.
- Ship hero + subscription summary first; defer 7-day roster.

---

## Action Plan (Step-by-Step)

### Phase 1 — Quick Wins (1–2 days, highest ROI)

1. **Add `sizes` to hero `Image`** — direct LCP improvement.
2. **Parallelize pause-credit count + upcoming meals** queries after `activeSub` is known.
3. **Introduce `React.cache()` session helper** — dedupe `getUser` / `users` across middleware-adjacent layout + page (layout/page at minimum).
4. **Remove or defer `animate-in` on main dashboard wrapper** — improves Speed Index.
5. **Lazy-load `DashboardFixedBackgroundLogo`** via `next/dynamic({ ssr: false })` or replace with CSS.

### Phase 2 — Client Bundle Reduction (2–3 days)

6. **Dynamic import in `CustomerHeader`:**
   - `CartSheet` → `dynamic(() => import('...'), { ssr: false })`
   - `NotificationBell` → same pattern
7. **Defer `OneSignalProvider`** — load after `requestIdleCallback` or on first user interaction.
8. **Convert sidebar/background logos** to `next/image` with explicit dimensions.
9. **Audit `manageMealActions` import** — ensure server action doesn’t inflate client bundle (move `repairOverLimitPauseCredits` to a dedicated small module if needed).

### Phase 3 — Architecture & Caching (3–5 days)

10. **Add `loading.tsx`** for dashboard route with skeleton matching hero + cards layout.
11. **Split dashboard into Suspense boundaries:**
    - `DashboardHero` (static)
    - `SubscriptionSummary` (fast queries)
    - `UpcomingDeliveries` (slow query, streamed)
12. **Replace `select('*')`** with explicit column list on subscriptions query.
13. **Revisit `revalidate = 0`** — consider `revalidate = 60` or tag-based revalidation on subscription changes.
14. **Consolidate middleware + layout user fetches** — pass role/profile via headers or shared cache to avoid 3× `users` queries.

### Phase 4 — Validation

15. Re-run Lighthouse (mobile, throttled 4G).
16. Target metrics:
    - LCP < 1.2s
    - Speed Index < 2.0s
    - TBT reduction from deferred client imports
    - “Properly size images” and “image dimensions” audits passing
17. Use `@next/bundle-analyzer` on the customer dashboard route to confirm client chunk size drop.

---

## Files Reviewed

| File | Role |
|------|------|
| `src/app/customer/(main)/dashboard/page.tsx` | Target — Server Component, data fetching, hero image |
| `src/app/customer/(main)/layout.tsx` | Parent layout — duplicate auth, client shell |
| `src/shared/components/customer/DashboardFixedBackgroundLogo.tsx` | Client decorative logo |
| `src/shared/components/layout/customer-header.tsx` | Client header + cart + notifications |
| `src/shared/components/layout/customer-sidebar.tsx` | Client sidebar |
| `src/shared/components/notifications/OneSignalProvider.tsx` | Push notification SDK |
| `src/shared/components/customer/cart-sheet.tsx` | Cart drawer |
| `src/shared/components/shared/NotificationBell.tsx` | Notification polling UI |
| `src/shared/components/ui/{card,button,badge,alert}.tsx` | Server UI primitives |
| `src/middleware.ts` | Auth gate + third `getUser()` |
| `src/app/layout.tsx` | Global Sonner toaster |
| `next.config.ts` | Image remote patterns only |

---

## Expected Impact Summary

| Change | Expected improvement |
|--------|---------------------|
| Hero `sizes` + compression | LCP −200–400ms |
| Dedupe auth queries | TTFB −100–300ms |
| Parallel pause + meals queries | TTFB −50–150ms |
| Defer cart/notifications/OneSignal | Unused JS −30–50%, TBT ↓ |
| Remove entry animation | Speed Index −300–600ms |
| Suspense + loading skeleton | Perceived load ↑, LCP may improve via prioritization |
