// src/lib/dietitian/franchiseCustomerScope.ts
//
// Application-layer read scoping for the FRANCHISE customers directory.
//
// WHY THIS EXISTS (SECURITY):
// `src/app/franchise/(main)/customers/page.tsx` reads `customer_profiles`
// through the SERVICE-ROLE client, which BYPASSES RLS. The policy
// `dietitian_select_customer_profiles` — and therefore
// `public.dietitian_can_read_customer` — never engages on that path. The only
// narrowing the page applied was the tenant filter `.eq("franchise_id", …)`, so
// a Franchise Dietitian was served EVERY customer of their franchise rather
// than only the ones assigned to them.
//
// `scripts/allow-multiple-franchise-dietitians.sql` narrowed the database
// predicate to `cp.franchise_id = d.franchise_id AND cp.dietitian_id =
// d.user_id`, precisely so a franchise can run a TEAM of Dietitians without each
// one reading their colleagues' customers. That migration has no effect on any
// surface that bypasses RLS, which is what this module restores.
//
// The admin portal has the same shape of problem and solves it inline
// (`src/app/admin/(main)/customers/page.tsx`). This helper is deliberately NOT
// wired into the admin page: that page is Core_Business and must not change
// behaviour. Extracting it here gives the franchise rule a pure, directly
// testable form without touching admin.
//
// PURE BY DESIGN: no `server-only`, no Supabase, no `next/headers`. It takes the
// already-resolved Dietitian context as an argument so it can be unit-tested
// against every combination of caller and row.

import { dietitianCanRead, dietitianScopeFromUser } from "./scope";

/**
 * The fields this module reads off a directory row.
 *
 * `dietitianId` is camelCase because that is the shape the franchise page has
 * already mapped its rows into by this point (`CustomerData`), unlike the
 * snake_case `ScopableCustomer` the raw predicate consumes.
 */
export interface FranchiseScopableRow {
  clinic_id: string | null;
  dietitianId?: string | null;
}

/**
 * The slice of a resolved Dietitian context this module needs. Declared
 * structurally rather than importing `DietitianContext` from
 * `@/lib/auth/adminAccess`, which is `server-only` — importing it would make
 * this module server-only too, for no benefit.
 */
export interface DietitianScopeContext {
  userId: string;
  franchiseId: string | null;
  clinicId: string | null;
}

/**
 * Narrow a franchise customer directory to what the calling user may read.
 *
 * Three cases, in order:
 *
 *   1. NOT a Dietitian (owner / operations user) — returns the rows unchanged.
 *      Their scope is the whole tenant, which the caller's `franchise_id` filter
 *      has already applied.
 *   2. A Dietitian whose context could NOT be resolved — returns `[]`. FAILS
 *      CLOSED: a user flagged as a Dietitian but whose Dietitian row cannot be
 *      read is given nothing, never the whole tenant. This mirrors the admin
 *      page and is the case a naive `if (ctx) filter` would get wrong.
 *   3. A Dietitian with a resolved context — returns only rows satisfying
 *      {@link dietitianCanRead}, i.e. matching BOTH the tenant and the
 *      Dietitian_Link.
 *
 * @param franchiseId The tenant the caller's rows were already filtered by. It
 *   is passed explicitly rather than read off each row because the rows the
 *   franchise page maps do not carry `franchise_id`; every row in the list is
 *   from this franchise by construction. Supplying it keeps the tenant conjunct
 *   of the predicate meaningful instead of comparing `undefined`.
 */
export function scopeFranchiseCustomersForDietitian<T extends FranchiseScopableRow>(
  customers: readonly T[],
  franchiseId: string,
  isDietitian: boolean,
  dietitianCtx: DietitianScopeContext | null,
): T[] {
  if (!isDietitian) return [...customers];

  // Fail closed — see case 2 above.
  if (!dietitianCtx) return [];

  const scope = dietitianScopeFromUser({
    id: dietitianCtx.userId,
    franchise_id: dietitianCtx.franchiseId,
    dietitian_clinic_id: dietitianCtx.clinicId,
  });

  return customers.filter((customer) =>
    dietitianCanRead(scope, {
      clinic_id: customer.clinic_id,
      franchise_id: franchiseId,
      dietitian_id: customer.dietitianId ?? null,
    }),
  );
}
