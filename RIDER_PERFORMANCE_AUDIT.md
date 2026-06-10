# Rider Dashboard — Performance Audit

**Target:** `src/app/rider/(main)/dashboard/page.tsx`  
**Scope:** Full request chain — Middleware → Layout → Page  
**Goal:** Blazing-fast loads on low-end mobile devices over 3G/4G  

---

## Executive Summary

The rider dashboard is a Server Component (good), but suffers from **sequential data waterfalls**, **redundant auth calls across the request chain**, a **missing LCP image optimization**, and **heavy client components loaded eagerly in the layout**. Fixing these can shave 300–800ms off TTFB on 4G and significantly reduce JS bundle size on the client.

---

## Current Bottlenecks

### 1. Server Data Waterfall (Critical — ~400ms wasted)

The page makes **5 sequential `await` calls** where at least 2 can be parallelized:

```
① await supabase.auth.getUser()            — ~50ms
② await supabase.from("users")...          — ~40ms (depends on ①)
③ await supabase.from("rider_profiles")... — ~40ms (depends on ②)
④ await adminClient.from("rider_monthly_summaries")... — ~60ms (depends on ③)
⑤ await supabase.from("delivery_orders")... — ~80ms (depends on ③)
```

**Issue:** Steps ④ and ⑤ both depend only on `riderProfile.id` — they are independent of each other but executed sequentially. On a 4G roundtrip (~100ms per call), this wastes one full roundtrip unnecessarily.

**Severity:** High

---

### 2. Duplicate `getUser()` Calls (Moderate — ~100ms wasted)

The auth validation is performed **3 times** in a single request:

| Location | Call |
|----------|------|
| `middleware.ts` (L66) | `await supabase.auth.getUser()` + role query |
| `layout.tsx` (L16) | `await supabase.auth.getUser()` |
| `page.tsx` (L63) | `await supabase.auth.getUser()` |

While Supabase SSR may cache the JWT locally, each call still involves cookie parsing and token validation overhead. The middleware **also** queries the `users` table for role verification — the same table the page queries again.

**Severity:** Moderate (partially mitigated by Supabase SSR caching, but still adds CPU time)

---

### 3. Heavy Client Components Loaded Eagerly (High — ~45KB+ JS)

The **layout** imports these client components statically:

| Component | Bundle Impact | Loaded On |
|-----------|--------------|-----------|
| `OneSignalProvider` | Loads OneSignal SDK (~30KB gzipped external script) | Every page load |
| `NotificationBell` | Popover + ScrollArea + date-fns `formatDistanceToNow` (~8KB) | Every page load |
| `RiderBottomNav` | Small (~2KB), acceptable | Every page load |

The **page** imports:

| Component | Bundle Impact |
|-----------|--------------|
| `RiderStatusToggle` | Switch + lucide icons (~3KB) — acceptable |

**Key Issue:** `OneSignalProvider` and `NotificationBell` are non-critical-path components that don't need to block hydration. The OneSignal SDK script already uses `afterInteractive` strategy, but the provider component itself is still in the critical render tree.

**Severity:** High for 3G (large JS payload delays interactivity)

---

### 4. Missing Next.js `<Image />` Optimization (Moderate — LCP impact)

In `layout.tsx`, the logo is rendered with a raw `<img>` tag:

```tsx
<img src="/logo.png" alt="ArogyaDiet" className="h-13 w-auto object-contain" />
```

This bypasses Next.js image optimization:
- No automatic WebP/AVIF conversion
- No responsive `srcset` generation
- No lazy/eager loading hints for LCP
- No automatic size optimization for the viewport

Since the logo is in the sticky header (always visible), it's likely the **LCP element** for the rider portal.

**Severity:** Moderate (affects Core Web Vitals LCP score)

---

### 5. `revalidate = 0` Without Streaming (Minor)

```tsx
export const revalidate = 0;
```

This forces every page hit to be a full dynamic render with no caching. Combined with the sequential waterfall, users see a blank screen until all 5 queries complete. There's no use of `<Suspense>` boundaries to stream partial UI early.

**Severity:** Minor (correct for real-time data, but streaming would help perceived performance)

---

### 6. `date-fns` Import Granularity (Low)

```tsx
import { format } from "date-fns";         // page.tsx
import { subMonths } from "date-fns";      // riderPaidMonthsWindow.ts
import { formatDistanceToNow } from "date-fns"; // NotificationBell.tsx
```

Modern bundlers tree-shake `date-fns` well, but three different entry points across server and client mean the client bundle may include `formatDistanceToNow` + its locale data unnecessarily.

**Severity:** Low

---

### 7. Lucide Icons — Individual Imports (Low)

The page imports 7 icons from `lucide-react`:

```tsx
import { CheckCircle2, Clock, IndianRupee, Loader2, MapPin, ArrowRight, PowerOff } from "lucide-react";
```

These are tree-shaken correctly with named imports, so no issue here. ✅

---

## Step-by-Step Action Plan

### Step 1: Parallelize Independent Queries (High Impact, Low Effort)

**File:** `src/app/rider/(main)/dashboard/page.tsx`

After obtaining `riderProfile.id`, wrap the two independent queries in `Promise.all`:

```tsx
// BEFORE (sequential — wastes one roundtrip)
const { data: paidSummaries } = await adminClient.from("rider_monthly_summaries")...
const { data: todayOrders } = isOnDuty ? await supabase.from("delivery_orders")... : { data: [] };

// AFTER (parallel)
const [{ data: paidSummaries }, { data: todayOrders }] = await Promise.all([
  adminClient
    .from("rider_monthly_summaries")
    .select("year, month, net_payable")
    .eq("rider_id", riderProfile.id)
    .eq("status", "PAID"),
  isOnDuty
    ? supabase
        .from("delivery_orders")
        .select(`id, status, payout_amount, meal_category:meal_categories ( name )`)
        .eq("assigned_rider_id", riderProfile.id)
        .eq("delivery_date", operationalDate)
    : Promise.resolve({ data: [] }),
]);
```

**Expected savings:** ~60–100ms on 4G

---

### Step 2: Eliminate Redundant Auth in Page (Moderate Impact, Low Effort)

**Option A (Recommended):** Pass user/profile data from layout to page via React Server Component composition. The layout already fetches `user` and `profile.id` — pass them down rather than re-fetching.

**Option B:** Accept the duplication if Supabase SSR deduplicates internally (verify with timing logs).

**Implementation sketch (Option A):**
Move the layout's auth data into a shared async cache using Next.js `cache()`:

```tsx
// src/lib/supabase/cached-auth.ts
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export const getCachedAuth = cache(async () => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { user: null, profile: null };
  
  const { data: profile } = await supabase
    .from("users")
    .select("id, full_name")
    .eq("auth_user_id", user.id)
    .single();
    
  return { user, profile };
});
```

Both layout and page call `getCachedAuth()` — React deduplicates it within the same request.

**Expected savings:** ~90ms (eliminates 1–2 duplicate roundtrips)

---

### Step 3: Lazy-Load Non-Critical Client Components (High Impact, Low Effort)

**File:** `src/app/rider/(main)/layout.tsx`

```tsx
import dynamic from "next/dynamic";

const OneSignalProvider = dynamic(
  () => import("@/shared/components/notifications/OneSignalProvider").then(m => ({ default: m.OneSignalProvider })),
  { ssr: false }
);

const NotificationBell = dynamic(
  () => import("@/shared/components/shared/NotificationBell").then(m => ({ default: m.NotificationBell })),
  { ssr: false, loading: () => <div className="w-8 h-8" /> }
);
```

**Why:** OneSignal doesn't need SSR at all. NotificationBell fetches data client-side anyway — deferring its JS means faster hydration for the core content.

**Expected savings:** ~35–45KB less JS in the critical path

---

### Step 4: Replace `<img>` with Next.js `<Image />` (Moderate Impact, Low Effort)

**File:** `src/app/rider/(main)/layout.tsx`

```tsx
import Image from "next/image";

<Image
  src="/logo.png"
  alt="ArogyaDiet"
  width={120}
  height={40}
  priority        // Marks as LCP — preloaded
  className="h-10 w-auto object-contain"
/>
```

**Benefits:**
- Automatic WebP/AVIF serving (40–60% smaller)
- `priority` adds `<link rel="preload">` for LCP
- Proper `width`/`height` prevents layout shift (CLS = 0)

---

### Step 5: Add Suspense Streaming for Perceived Performance (Moderate Impact, Moderate Effort)

Split the page into an instant shell + streamed data section:

```tsx
import { Suspense } from "react";

export default async function RiderDashboard() {
  // Instant render: greeting + status toggle
  return (
    <div className="p-4 space-y-6">
      <Suspense fallback={<DashboardSkeleton />}>
        <RiderDashboardContent />
      </Suspense>
    </div>
  );
}
```

Move the data-fetching into `<RiderDashboardContent />` (also a Server Component). The shell + skeleton renders immediately while queries resolve.

**Expected improvement:** ~200–400ms better perceived load time (First Contentful Paint)

---

### Step 6: Consider Request-Level Auth Caching in Middleware (Low Priority)

The middleware already validates user + role. If Next.js headers/cookies could pass the validated `userId` and `roleCode` downstream, both layout and page could skip re-validation. However, this requires care around security (headers can be spoofed in some setups).

**Recommendation:** Use React `cache()` (Step 2) instead — it's safer and framework-native.

---

## Impact Summary

| Fix | TTFB Savings | JS Bundle Savings | Effort |
|-----|-------------|-------------------|--------|
| Parallelize queries | ~60–100ms | — | 5 min |
| Deduplicate auth (cache) | ~90ms | — | 15 min |
| Lazy-load OneSignal + Bell | — | ~40KB | 5 min |
| Next.js Image for logo | ~20ms LCP | — | 2 min |
| Suspense streaming | ~200–400ms perceived | — | 30 min |

**Total estimated improvement:** 
- **TTFB:** 150–290ms faster  
- **LCP:** 200–500ms faster (with streaming + image opt)  
- **TTI:** 40KB less JS to parse on 3G  

---

## Files Analyzed

- `src/middleware.ts` — Auth + subdomain routing
- `src/app/rider/(main)/layout.tsx` — Shell layout with header/nav
- `src/app/rider/(main)/dashboard/page.tsx` — Dashboard page (primary target)
- `src/shared/components/notifications/OneSignalProvider.tsx` — Push notification SDK
- `src/shared/components/shared/NotificationBell.tsx` — Notification popover
- `src/shared/components/rider/rider-status-toggle.tsx` — Duty toggle
- `src/shared/components/layout/rider-bottom-nav.tsx` — Bottom navigation
- `src/lib/supabase/admin.ts` — Admin client factory
- `src/lib/dates/ist.ts` — IST date utilities
- `src/lib/delivery/riderPaidMonthsWindow.ts` — Payout window calculator
- `src/lib/delivery/orderStatuses.ts` — Order status utilities
