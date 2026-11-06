# 12 — Advanced Front-End Patterns

Basic React is skipped. Each pattern: where it lives, how it works, why it was chosen. Counts come from searches over `src/` (excluding tests) on 2026-11-02.

## 1. Server/client boundary
- **Pages and layouts are Server Components**; they fetch with Supabase and pass plain props to `"use client"` leaves. Example: `src/app/customer/(main)/subscription/manage/planner/page.tsx` → `MealPlannerClient`; `src/app/franchise/(main)/inventory/page.tsx` maps DB rows to the shared `InventoryDashboard` props shape (`toInventoryCatalogProduct`).
- **Wrapper pattern**: `AdminCustomersWrapper.tsx`, `AdminOperationsWrapper.tsx`, `AdminRidersWrapper.tsx`, `FranchiseDashboardClient.tsx` — the RSC page loads data, the client wrapper owns filters/tabs.
- **Props must be serialisable** by React's RSC protocol: plain objects, arrays, strings, numbers, `Date`, `Map`/`Set`, promises are fine; functions (other than Server Actions) and class instances are not. That is why pages map Supabase rows into plain DTOs before passing them down.
- Why: data stays on the server (service-role queries never reach the browser), smaller client bundles.

## 2. Data mutation pattern: Server Actions + transitions
- `useTransition` appears in 127 files; typical shape: `startTransition(async () => { const r = await someAction(fd); r.success ? toast.success() : toast.error(); router.refresh(); })` (`ReceiveTransferControls.tsx`).
- `useActionState` (7 files) for form-bound actions with progressive enhancement: `login-form.tsx` → `LoginAction(prevState, formData)`.
- No `useOptimistic`; UI waits for the server, then `router.refresh()`.
- Why: no client cache to invalidate; the server is the source of truth.

## 3. Streaming, Suspense and loading UX
- `src/app/customer/layout.tsx` is **synchronous** and renders `GlobalLoader` first, then `<Suspense fallback={null}>{children}</Suspense>`; the inner `(main)/layout.tsx` awaits the session. Result: native splash → branded loader → page, with no blank frame. `template.tsx` hosts an `AppReadyBeacon` that hides the loader when real content resolves.
- `RouteProgressBar` inside `Suspense` gives instant navigation feedback.
- `loading.tsx` in 6 route folders (rider dashboard/payout/profile/route, master customers/subscriptions) for streamed skeletons; `error.tsx` in 2 (franchise inventory, master warehouse) as error boundaries.
- `<Suspense>` used in 12 files.
- Request dedupe with React `cache()`: `getCustomerSession` (`src/lib/customer/get-session.ts`), `getCachedRiderAuth` (`src/lib/supabase/cached-auth.ts`) — layout and page call the same function, one DB round-trip.
- Caching: no `"use cache"` / `unstable_cache`; pages set `export const revalidate = 0` (always dynamic). Performance work instead focused on fewer queries (identity headers from middleware, see `04`) and timing logs (`src/lib/perf/server-timing.ts`, `NEXT_PUBLIC_PERF_TIMING`).

## 4. Dynamic imports (`next/dynamic`, 10 files)
- `DeferredClientProviders.tsx`: loads OneSignal and the support FAB with `ssr: false` after hydration — keeps them off the first-paint bundle.
- `rider-layout-client.tsx`: OneSignal and `NativeShellProvider` only in the browser (Capacitor APIs do not exist on the server).
- Rich text editor (`ProductDescriptionEditor.tsx`, `react-quill-new`), modals with maps (`address-form-modal.tsx`, create-customer modals), lazy background logo.
- Why: heavy or browser-only libraries.

## 5. Shared components across portals
- `src/shared/components/admin/**` is reused by franchise and master pages (Customer 360, inventory dashboard, operations views). Portal differences come in through props (`isDietitian`, read-only flags, which action functions to call).
- Rule from `.kiro/steering/structure.md`: never import between `src/app/<portal>` folders; share through `src/shared`.
- Gotcha: a shared client component that imports server actions makes those actions callable from every portal that renders it (see `06`).

## 6. Forms + zod
- `react-hook-form` with `zodResolver` in 34 files (onboarding wizard `QuickOnboardingForm.tsx`, hierarchy dialogs, product forms, stay dialogs). The **same zod schema** often re-runs on the server (`onboardingActions.ts` builds `createQuickOnboardingSchema(serviceablePincodes)` and `safeParse`s again).
- zod v4 (`zod@^4.3.6`): e.g. `z.enum(ADMIN_ACCESS_LEVELS)` from a `const` tuple keeps types and runtime values in one place.
- Server returns `fieldErrors` keyed like the form fields so the client can call `setError`.

## 7. Client state: zustand
| Store | File | Purpose |
|---|---|---|
| `useCartStore` | `src/store/useCartStore.ts` | Customer shop cart with `persist` (localStorage); refuses out-of-stock; `removeOutOfStockItems` used by `use-sync-cart-stock.ts` |
| `useInventoryStore` | `src/shared/stores/useInventoryStore.ts` | Warehouse staging cart for bulk receive/dispatch (`OperationsCart`) |
| `useFranchiseInventoryStore` | `src/shared/stores/useFranchiseInventoryStore.ts` | Franchise operations cart |
Why zustand: tiny global state without providers; carts must survive navigation (and reloads for the shop).

TanStack Query is installed (`@tanstack/react-query`) but **no `useQuery` or `QueryClientProvider` is used** in `src/` — the steering doc's "React Query for client-side fetching" is not current. TanStack **Table** is used for admin data tables.

## 8. Maps
- `@react-google-maps/api` `useJsApiLoader` in `AddressCaptureMap.tsx` (address picking with pincode/locality extraction, `src/lib/address/extractLocalityFields.ts`), `AdminLiveTrackingMap.tsx`, `RoutingSandbox.tsx`, customer `LiveTrackingMap.tsx` (with Supabase Realtime).
- Route polylines from `computeOptimizedRouteDetails` (encoded polyline from Routes API).
- Tests mock `useJsApiLoader` (`AdminLiveTracking.regression.test.tsx`).

## 9. PDF rendering
- `@react-pdf/renderer` templates written as React components: `src/services/KitReportTemplate.tsx`, `HealthReportTemplate.tsx`, `DietitianReportTemplate.tsx`, `ShopReceiptTemplate.tsx`.
- Route handlers (`/api/kit-report/[id]`, `/api/meal-health-report/[id]`, `/api/stay-health-report/[id]`, `/api/shop-receipt/[id]`, `/api/admin/customer-report/[type]/[id]`) authenticate, call a service (`KitReportService.generateReport`) that renders to a Buffer, and return it with PDF headers (converted to `Uint8Array` for `BodyInit`).
- Invoices in the browser use `src/shared/components/shared/invoice/*` with print CSS (`print:` Tailwind variants in layouts); `html2canvas` is used in one place for image capture.
- Why server-side PDF: consistent output, data never leaves the server unauthenticated, works inside the Android WebView.

## 10. Excel import/export
- Export: `GET /api/admin/inventory/purchase-orders/export` builds an `xlsx` workbook; CSV via `src/lib/csv/exportCsv.ts`.
- Import: bulk customer/KIT migration (`src/lib/bulk-migration/*`, `BulkMigrationClient.tsx`, `KitBulkImportClient.tsx`) parses Excel with `xlsx` (22 files reference `XLSX.`), validates rows (`validate.ts`, `validateKitRows.ts`, zod `kitBulkImportSchema.ts`), and sends to `bulkImportActions.ts` / `kitBulkImportActions.ts`. Templates generated by `scripts/generate-kit-import-template.mjs`.

## 11. Native-aware UI
`Capacitor.isNativePlatform()` guards, `App.addListener("appStateChange")` to reconcile payments and re-check permissions, safe-area CSS (`pt-safe`), `.rider-app-shell` to remove browser affordances (`src/app/globals.css`).

## 12. Interview questions
1. *How do you keep secrets off the client?* Service-role queries only in RSC/actions; clients get props; `server-only` import in `adminAccess.ts` breaks the build if imported client-side.
2. *How did you remove the white flash on app start?* Synchronous shell layout with a loader + Suspense around the session-dependent layout.
3. *Why zustand and not Context?* Persisted cart and staging carts shared across distant components without provider re-renders.
4. *How are PDFs generated?* React components rendered by `@react-pdf/renderer` in route handlers after auth.
