# System Architecture

## Modular Monolith Explanation
ArogyaDiet is a monolithic repository that virtually segregates features into modules (`src/modules/*`) and portals (`src/app/*`). 
This keeps deployment simple (a single Vercel app) while enabling specialized code boundaries. The middleware dynamically routes traffic to different Next.js route groups depending on the subdomain requested.

## Portal Separation & Rendering Strategy
- **`src/app/admin`**: Server-rendered, desktop-first. Uses `AdminNavbar`. Focused on heavy data grids, bulk operations, and real-time operational views.
- **`src/app/customer`**: Responsive, hybrid rendering. Uses `CustomerSidebar` and `CustomerHeader`. Emphasizes smooth transitions for modifying daily preferences.
- **`src/app/rider`**: Mobile-first, fast load. Uses `RiderBottomNav`. Depends on geo-location APIs and optimized for on-the-go connectivity.

## Server/Client Boundaries
- **Server-First Philosophy:** By default, all pages and components are React Server Components (RSC).
- **Client Components (`"use client"`):** Restricted strictly to interactive leaves (e.g., forms, maps, interactive toggles). State is not passed deep through the tree; rather, it is handled at the highest necessary client boundary.
- **Data Fetching:** Occurs inside the server components directly reading from Supabase via `src/lib/supabase/server.ts`. Client components receive data as props.

## Middleware Flow
1. Intercepts request.
2. Extracts subdomain (e.g., `customer`, `deliverypartner`, `admin`).
3. Fetches user session via Supabase.
4. Validates user Role against the requested subdomain.
5. `NextResponse.rewrite` routes the visual URL to the internal Next.js `app/[portal]` directory without changing the browser's address bar.
6. Handles redirects to `/login` or `/unauthorized`.

## Authentication & Authorization Flow
- **Authentication:** Handled by Supabase Auth (Email/Password & OTP).
- **Session Management:** Cookies are managed by `@supabase/ssr`.
- **Authorization:** 
  1. Middleware blocks cross-portal access (Role verification).
  2. Database enforces Row Level Security (RLS) on tables using `auth.uid()`.
  3. Server Actions implement manual permission checks (e.g., `assertOwnsSubscription` in `manageMealActions.ts`).
