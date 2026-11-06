# Front-End and Next.js Questions

**1. Server vs client components — how do you decide?**
Server by default (pages, layouts, data loading with Supabase). Client only for interactivity: forms, maps, toggles, carts. Example: `planner/page.tsx` (RSC) → `meal-planner-client.tsx`.
Follow-up: what can cross the boundary? Serialisable data and Server Action references.

**2. How do you pass server data to client components safely?**
Map rows to DTOs in the RSC (`toInventoryCatalogProduct` in franchise inventory page); never pass service-role clients or secrets; `server-only` import in `adminAccess.ts` breaks the build if imported into a client.

**3. How do mutations refresh the UI?**
Server Action → `revalidatePath(...)` → client `router.refresh()` inside `startTransition`. No client cache needed.

**4. `useActionState` vs `useTransition`?**
`useActionState(LoginAction, null)` binds an action to a `<form>` and gives state + pending (works without JS). `useTransition` for imperative calls from buttons with a pending flag (`ReceiveTransferControls.tsx`).

**5. How did you handle loading and avoid white flashes on the customer app?**
Synchronous outer layout `src/app/customer/layout.tsx` renders `GlobalLoader` and wraps children in `Suspense`; inner layout awaits session; `template.tsx` beacon hides the loader when content is ready.

**6. Where is caching used?**
Mostly not: pages use `revalidate = 0`. React `cache()` dedupes per-request auth lookups (`getCustomerSession`, `getCachedRiderAuth`). No `"use cache"`/`unstable_cache`.
Follow-up: what would you cache? Plan catalog, meal categories, BI aggregates with tags and `revalidateTag` on writes.

**7. How do you lazy-load heavy client code?**
`next/dynamic` with `ssr: false` for OneSignal, support FAB, rich text editor, map modals, Capacitor-only shells (`DeferredClientProviders.tsx`, `rider-layout-client.tsx`).

**8. How do forms and validation work?**
react-hook-form + `zodResolver` (34 files); same zod schema re-validated in the action; server returns `fieldErrors` keyed by field name.

**9. Why zustand?**
Persisted shop cart (`useCartStore` with `persist`) and inventory staging carts; no provider tree, minimal re-renders.

**10. How does middleware pass data to pages?**
Request headers on the rewrite: `x-auth-user-id`, `x-customer-profile-id`, `x-customer-category`, `x-portal-pathname`; cookie `x-franchise-id`. Pages read via `headers()`/`cookies()`.
Follow-up: is trusting headers safe? They are set on the internal rewritten request by middleware; Supabase client still uses the real cookie JWT for RLS.

**11. How do maps work?**
`@react-google-maps/api` `useJsApiLoader`; address picker extracts pincode/locality; admin live map; customer map uses Supabase Realtime `postgres_changes` for rider location.

**12. How are PDFs generated?**
`@react-pdf/renderer` templates (`KitReportTemplate.tsx`, etc.) rendered on the server in route handlers after auth; returned as `Uint8Array` with PDF headers.

**13. How does the web bundle import Capacitor plugins without breaking on Vercel?**
`next.config.ts` aliases them to stubs for webpack and Turbopack; runtime `Capacitor.isNativePlatform()` checks; stub forwards to `registerPlugin` in the APK.

**14. Middleware in Next 16?**
The file is `src/middleware.ts`; Next 16 renamed the convention to `proxy.ts` (deprecated, still works). Proxy defaults to Node runtime; this middleware imports only edge-safe pure modules (`adminAccessCore.ts`).

**15. How do you handle the Android back button and safe areas?**
`native-back-button.ts` via `NativeShellProvider`; CSS `pt-safe`, `.rider-app-shell` in `globals.css`.

**16. How do you share UI between admin and franchise?**
`src/shared/components/admin/**` components with props controlling actions and read-only state; franchise pages pass franchise-specific actions.

**17. Error boundaries?**
`error.tsx` in franchise inventory and master warehouse; actions return result objects so most errors are toasts (`sonner`).

**18. Route groups?**
`(auth)`, `(main)`, `(public)` organise layouts without affecting URLs: e.g. public APK page lives in `customer/(public)` with its own layout and is exempted in middleware.

**19. How do you measure performance?**
`createServerTimer` (`src/lib/perf/server-timing.ts`) with `NEXT_PUBLIC_PERF_TIMING`, `HydrationTimer`; audits in `DASHBOARD_PERFORMANCE_AUDIT.md`, `RIDER_PERFORMANCE_AUDIT.md`; customer-portal data optimisation spec.

**20. What front-end bug taught you something?**
A shared `"use server"` file exported a constant array and broke every Server Action on the master hierarchy page at runtime while `next build` passed; fixed by moving constants to `adminAccessCore.ts` and adding `src/test/architecture/use-server-exports.test.ts`.
