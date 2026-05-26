# Project Overview: ArogyaDiet

## Business Purpose
ArogyaDiet is a comprehensive, subscription-based meal delivery SaaS platform. It serves as a unified system to manage meal subscriptions, kitchen operations, daily rider route assignments, and customer deliveries. The system is designed to handle complex logic such as pausing subscriptions, changing delivery locations on a per-day basis, and calculating rider payouts based on distance.

## High-Level Architecture
The project is built as a **Modular Monolith** using the Next.js App Router. It is divided into distinct **portals** that operate concurrently within the same repository but are isolated via subdomain-based routing.

### Core Portals
1. **Customer Portal** (`customer.domain.com` or `*.vercel.app`): For users to manage their subscriptions, track orders, change daily addresses, and pause deliveries.
2. **Rider Portal** (`deliverypartner.domain.com`): A mobile-first interface for delivery partners to view daily routes, update order statuses, and track payouts.
3. **Admin Portal** (`admin.domain.com`): A desktop-first operational dashboard for admins to manage customers, dispatch riders, manage kitchen settings, and oversee system health.
4. **Master Portal** (`master.domain.com`): Super-admin access for high-level system configuration.

## Technical Stack
- **Framework:** Next.js 15 (App Router, Server Components, Server Actions)
- **Language:** TypeScript
- **Database & Backend:** Supabase (PostgreSQL, Row Level Security, Auth)
- **Styling:** Tailwind CSS, PostCSS
- **UI Components:** Shadcn UI
- **Deployment:** Vercel

## Application Flow
1. **User entry:** The Next.js `middleware.ts` intercepts the request, checks the subdomain (e.g., `admin.`), and rewrites the internal Next.js path to the corresponding portal folder (`src/app/admin`).
2. **Authentication:** Uses Supabase SSR. `middleware.ts` acts as a strict gatekeeper. If an Admin tries to access the Rider portal, or a standard user accesses the Admin portal, they are redirected to `/unauthorized`.
3. **Data Fetching:** Handled natively via Next.js Server Components utilizing `@supabase/ssr` `createServerClient`.
4. **Mutations:** Performed via Next.js Server Actions (`src/actions/*`), many of which leverage `createAdminClient` (`@supabase/supabase-js`) to bypass RLS for complex admin operations, while standard actions use the authenticated user's RLS context.
