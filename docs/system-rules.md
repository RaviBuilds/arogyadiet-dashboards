# Arogyadiet Platform - System Architecture & AI Rules

## 1. The Prime Directive (Do No Harm)
You are working on a Modular Monolith. The `customer` and `rider` (deliverypartner) portals are currently stable and in production. **Under no circumstances should you modify, break, or alter the functionality of the `customer` or `rider` modules when building new `admin` features.** If modifying shared files (like `middleware.ts`, `tailwind.config.ts`, or global UI components), you MUST ensure backward compatibility.

## 2. Portal & Role Isolation
The application uses subdomain routing handled by `middleware.ts`. Each portal has a strict 1:1 relationship with a database role (`users.roles.code`):
* `customer.localhost` -> `src/app/customer/` -> Role: `CUSTOMER`
* `deliverypartner.localhost` -> `src/app/rider/` -> Role: `RIDER`
* `admin.localhost` -> `src/app/admin/` -> Role: `ADMIN`
* `master.localhost` -> `src/app/master/` -> Role: `MASTER`

**Rule:** Modules must remain isolated. An `admin` page MUST NOT import components or actions from the `rider` or `customer` folders. Shared utilities must live in `src/components`, `src/lib`, or `src/shared`.

## 3. The "Pincode" Pivot (CRITICAL DATA STRUCTURE)
We have abandoned the rigid geographical "Zone" model. Do not write code or database queries that reference `zones` or `zone_id`.
* We now use **Pincode-Based Service Areas**.
* Riders are mapped to specific pincodes via the `rider_service_areas` table (`area_name`, `pincode`, `rider_id`).
* When assigning riders or filtering customers, use the `addresses.pincode` matched against `rider_service_areas.pincode`.

## 4. Supabase & Data Access Strategy
* **Server-First:** Always prefer Server Components and Server Actions (`use server`).
* **Row Level Security (RLS):** Remember that `public.users` and other operational tables are protected by RLS. When writing Admin Server Actions that require bypassing RLS to manage the whole business, use the Supabase Service Role Key (`@supabase/supabase-js` initialized with `process.env.SUPABASE_SERVICE_ROLE_KEY`), NOT the SSR anon client.
* **Never expose sensitive data:** Do not pass entire database row objects to Client Components if they contain sensitive fields. Select only what is needed.

## 5. UI/UX Premium Design Standards (Strict Enforcement)
The application must maintain a premium, clean, and highly polished "Enterprise SaaS" feel like created by 15 years experianced UI/UX expert. You are strictly forbidden from using generic, unstyled Tailwind defaults.

* **Portal Layouts:**
  * **Customer Portal:** Mobile-responsive, consumer-friendly, visually polished. Uses a global fixed background texture (`customer-bg.jpg`) at low opacity (`opacity-20`).
  * **Rider Portal:** Mobile-first, Progressive Web App (PWA) style, high-contrast, large tap targets.
  * **Admin Portal:** Desktop-first, data-dense, horizontal top-navigation (NO sidebar). Uses Shadcn UI Data Tables extensively.
* **Color Palette Restrictions:** * NEVER use default Tailwind blue (`bg-blue-500`, `text-blue-600`, etc.) for primary actions. 
  * Primary brand colors are **ArogyaDiet Red** (`bg-red-500`/`bg-red-600`) and **Wellness Emerald** (`bg-emerald-500`/`bg-emerald-600`).
  * Neutral actions should use Slate (`bg-slate-900` or `border-slate-200`).
* **Form Layouts:** Inputs must NEVER stretch full-width across large container cards. Constrain forms using `max-w-md` or `max-w-lg`, or place them inside a responsive CSS Grid.
* **Component Elevation:** Cards must feel light: `bg-white/95 backdrop-blur-sm border border-slate-200 shadow-sm rounded-2xl`.
* **Alerts & Badges:** Do not use harsh, highly saturated background colors for alerts. Use soft, tinted backgrounds (e.g., `bg-amber-50 text-amber-800 border-amber-200` for warnings).

## 6. Standardized Supabase Imports (CRITICAL)
Do not write new Supabase initialization code or import legacy helpers. The project already has a fully configured and standardized set of clients in `src/lib/supabase/`. You MUST use these exact imports:
* **Server Components & Standard Server Actions:** `import { createClient } from "@/lib/supabase/server";`
* **Client Components:** `import { createClient } from "@/lib/supabase/client";`
* **Admin/Bypass RLS (Server Only):** `import { createAdminClient } from "@/lib/supabase/admin";` (Use this for admin operations that require bypassing RLS, such as viewing/deleting cross-user `medical_documents` or reassigning routes).

## 7. Immutable Business Logic (CRITICAL)
* **The 5 PM Cutoff Rule:** Changes to upcoming meals or pauses can only affect `tomorrow` if made before 5:00 PM today. If it is after 5:00 PM, the earliest editable date is `day after tomorrow`. Do not allow UI bypasses of this rule.
* **The Pause Reconciliation Engine:** When updating pause preferences (`is_paused`), we DO NOT just flip the boolean. You must use the Reconciliation Engine (found in `src/actions/admin-actions/adminMealActions.ts` and `src/actions/manageMealActions.ts`) which loops through the calendar, skips paused days to find the new exactly 30th delivery day, and inserts/deletes `subscription_daily_preferences` rows to dynamically expand/shrink the calendar and shift the `effective_end_on` date. Never overwrite this logic.