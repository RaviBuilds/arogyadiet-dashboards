"use server";

// src/actions/admin-actions/partialPaymentActions.ts
//
// Read-only server action behind the admin Customers → "Partial Payment" tab.
//
// ── WHY THERE IS NO SQL VIEW FOR THIS ────────────────────────────────────────
//
// The obvious shape would be a third balance view UNION-ing the two domains.
// Deliberately not done, for two reasons:
//
//   1. It would put the Total_Paid formula in a FOURTH place (two existing
//      views, two RPCs, two TS derivations, and then this). The formula is the
//      one thing in this feature that must never drift, so this action reuses
//      the audited `deriveSubscriptionBalance` / `deriveStayBalance` functions
//      instead of restating their arithmetic in SQL.
//   2. It needs no migration, so the tab works against the database exactly as
//      it stands today.
//
// ── QUERY DIRECTION (this is load-bearing) ───────────────────────────────────
//
// Every query below is driven from the LEDGER / BALANCE side, never from the
// customer side. The outstanding working set is tiny and grows slowly (tens of
// rows); the customer directory is ~550 rows and growing. Fetching "balances for
// these 550 customers" would also blow past PostgREST's URL length limit once
// the `.in()` list of UUIDs got long enough — a bug that would appear silently,
// only in production, only once the customer base grew.
//
// So: find the handful of entities that owe money, fetch only their ledgers and
// their owners, and never drive a query from the customer directory.
//
// ── SCOPING: THE TWO DOMAINS DIFFER ──────────────────────────────────────────
//
//   MEAL          confined to the signed-in admin's assigned clinic, here in the
//                 action (step 6) AND again by the caller's join against its
//                 already-scoped directory, which is what also applies franchise
//                 and dietitian scoping.
//   ACCOMMODATION visible to every admin. Not clinic-confined, because it is one
//                 shared property and — decisively — because every accommodation
//                 customer has `clinic_id = NULL`, so any clinic-confined read
//                 matches none of them.
//
// Membership rule and the legacy-stay trap it defends against: see the header of
// `src/types/partialPayment.ts`. Visibility rationale in full: see
// `PartialPaymentVisibilityNote` in the same file.

import { createAdminClient } from "@/lib/supabase/admin";
import { guardCustomersWorkspace } from "@/lib/auth/adminAccess";
import { deriveSubscriptionBalance } from "@/services/SubscriptionPaymentService";
import { deriveStayBalance, toPaise } from "@/services/AccommodationService";
import { byDateAsc, summarise } from "@/lib/payments/partialPaymentBreakup";
import type { StayPaymentTransaction } from "@/types/accommodation";
import type {
  PartialPaymentBalance,
  PartialPaymentBreakupEntry,
} from "@/types/partialPayment";
import type { CustomerData } from "@/shared/components/admin/customers/CustomerDashboard";

/** Chronological, oldest first — the order a collection history reads in. */
// `byDateAsc` and `summarise` moved to `@/lib/payments/partialPaymentBreakup` so
// the FRANCHISE board reuses the identical summary semantics instead of restating
// them. Imported above.

/** Stay checkout: the real timestamp once checked out, else start + nights. */
function deriveStayDueDate(
  checkedOutAt: string | null,
  startDate: string | null,
  totalNights: number | null,
): string | null {
  if (checkedOutAt) return checkedOutAt;
  if (!startDate || totalNights == null) return null;
  const date = new Date(startDate);
  if (Number.isNaN(date.getTime())) return null;
  date.setDate(date.getDate() + totalNights);
  return date.toISOString();
}

/**
 * Every entity that has a ledger AND still owes money, across MEAL
 * subscriptions and ACCOMMODATION stays.
 *
 * Returns balances keyed by `entityId` / `customerProfileId`. The caller joins
 * them onto its own already-scoped customer rows; anything that fails to join is
 * out of the caller's scope and must be dropped.
 */
export async function getPartialPaymentBalancesAction(): Promise<
  { success: true; data: PartialPaymentBalance[] } | { error: string }
> {
  // Redirects a non-admin / non-customers-group user, and yields the
  // Clinic_Scope_Assignment to confine the result to below.
  const { clinicId } = await guardCustomersWorkspace();

  try {
    const admin = createAdminClient();

    // ── 1. Candidates: entities the balance views think owe money ────────────
    // Cheap and already indexed. The stay side is over-inclusive here (LEFT
    // JOIN, so legacy ledger-less stays show up); step 3 removes them.
    const [stayCandidates, subCandidates] = await Promise.all([
      admin
        .from("stay_payment_balances")
        .select("stay_entry_id, customer_profile_id")
        .gt("remaining_balance", 0),
      admin
        .from("subscription_payment_balances")
        .select("subscription_id, customer_profile_id")
        .gt("remaining_balance", 0),
    ]);

    if (stayCandidates.error) return { error: stayCandidates.error.message };
    if (subCandidates.error) return { error: subCandidates.error.message };

    const stayIds = (stayCandidates.data ?? []).map((r) => r.stay_entry_id);
    const subscriptionIds = (subCandidates.data ?? []).map(
      (r) => r.subscription_id,
    );

    if (stayIds.length === 0 && subscriptionIds.length === 0) {
      return { success: true, data: [] };
    }

    // ── 2. Parents + ledgers, for the candidates only ───────────────────────
    const [stayEntries, stayLedger, subscriptions, subLedger] =
      await Promise.all([
        stayIds.length > 0
          ? admin
              .from("stay_entries")
              .select(
                "id, customer_profile_id, status, stay_type, start_date, total_nights, payment_amount, checked_out_at, payment_host_profile_id",
              )
              .in("id", stayIds)
              // A Shared_Payment guest is billed through their host and keeps no
              // ledger of their own, so they can never be part-paid themselves.
              .is("payment_host_profile_id", null)
          : Promise.resolve({ data: [], error: null }),
        stayIds.length > 0
          ? admin
              .from("stay_payment_transactions")
              .select(
                "id, stay_entry_id, transaction_type, amount, transaction_date, comment, remark",
              )
              .in("stay_entry_id", stayIds)
          : Promise.resolve({ data: [], error: null }),
        subscriptionIds.length > 0
          ? admin
              .from("subscriptions")
              .select(
                "id, customer_profile_id, status, customer_category, starts_on, effective_end_on, ends_on, total_payable, subscription_plans ( name )",
              )
              .in("id", subscriptionIds)
              // MEAL only. Partial payment is not offered on KIT at all, and an
              // equality test (rather than "not accommodation") means a future
              // category cannot leak onto this board by default.
              .eq("customer_category", "MEAL")
          : Promise.resolve({ data: [], error: null }),
        subscriptionIds.length > 0
          ? admin
              .from("subscription_payment_transactions")
              .select(
                "id, subscription_id, transaction_type, amount, transaction_date, payment_method, comment, remark",
              )
              .in("subscription_id", subscriptionIds)
          : Promise.resolve({ data: [], error: null }),
      ]);

    if (stayEntries.error) return { error: stayEntries.error.message };
    if (stayLedger.error) return { error: stayLedger.error.message };
    if (subscriptions.error) return { error: subscriptions.error.message };
    if (subLedger.error) return { error: subLedger.error.message };

    // ── 3. Group ledgers by parent ──────────────────────────────────────────
    const stayBreakups = new Map<string, PartialPaymentBreakupEntry[]>();
    for (const row of stayLedger.data ?? []) {
      const list = stayBreakups.get(row.stay_entry_id) ?? [];
      list.push({
        id: row.id,
        transactionType: row.transaction_type,
        amount: Number(row.amount),
        transactionDate: row.transaction_date,
        // No `payment_method` column on the stay ledger, unlike the
        // subscription one. Reported honestly as absent rather than guessed.
        paymentMethod: null,
        comment: row.comment ?? null,
        remark: row.remark ?? null,
      });
      stayBreakups.set(row.stay_entry_id, list);
    }

    const subBreakups = new Map<string, PartialPaymentBreakupEntry[]>();
    for (const row of subLedger.data ?? []) {
      const list = subBreakups.get(row.subscription_id) ?? [];
      list.push({
        id: row.id,
        transactionType: row.transaction_type,
        amount: Number(row.amount),
        transactionDate: row.transaction_date,
        paymentMethod: row.payment_method ?? null,
        comment: row.comment ?? null,
        remark: row.remark ?? null,
      });
      subBreakups.set(row.subscription_id, list);
    }

    // Built without `customerSnapshot` first, then hydrated in step 5 once the
    // full set of customer ids to look up is known.
    type PendingRow = Omit<PartialPaymentBalance, "customerSnapshot">;
    const rows: PendingRow[] = [];

    // ── 4a. Accommodation ───────────────────────────────────────────────────
    for (const stay of stayEntries.data ?? []) {
      const breakup = stayBreakups.get(stay.id);

      // MEMBERSHIP RULE 1. This single guard is what keeps the 33 legacy
      // ledger-less stays (~₹11.2 lakh of fictional dues) off the board. Do not
      // relax it to `?? []`.
      if (!breakup || breakup.length === 0) continue;

      breakup.sort(byDateAsc);

      const balance = deriveStayBalance(
        stay.payment_amount == null ? null : Number(stay.payment_amount),
        breakup as unknown as StayPaymentTransaction[],
      );

      // MEMBERSHIP RULE 2. Strictly positive, in paise: a settled stay leaves
      // the board the instant its last instalment lands, and a refund-due
      // (over-collected) stay never appears on a collections list at all.
      if (toPaise(balance.remainingBalance) <= 0) continue;

      rows.push({
        source: "STAY",
        entityId: stay.id,
        customerProfileId: stay.customer_profile_id,
        entityStatus: stay.status,
        entityLabel: stay.stay_type ?? null,
        periodStart: stay.start_date ?? null,
        dueDate: deriveStayDueDate(
          stay.checked_out_at ?? null,
          stay.start_date ?? null,
          stay.total_nights ?? null,
        ),
        totalNights: stay.total_nights ?? null,
        totalAmount: balance.totalStayAmount,
        totalPaid: balance.totalPaid,
        remainingBalance: balance.remainingBalance,
        breakup,
        ...summarise(breakup),
      });
    }

    // ── 4b. Meal ────────────────────────────────────────────────────────────
    for (const sub of subscriptions.data ?? []) {
      const breakup = subBreakups.get(sub.id);
      if (!breakup || breakup.length === 0) continue;

      breakup.sort(byDateAsc);

      const balance = deriveSubscriptionBalance(
        sub.id,
        sub.total_payable,
        breakup,
      );

      if (toPaise(balance.remainingBalance) <= 0) continue;

      const plan = Array.isArray(sub.subscription_plans)
        ? sub.subscription_plans[0]
        : sub.subscription_plans;

      rows.push({
        source: "MEAL",
        entityId: sub.id,
        customerProfileId: sub.customer_profile_id,
        entityStatus: sub.status,
        entityLabel: plan?.name ?? "Custom Plan",
        periodStart: sub.starts_on ?? null,
        // Same precedence the customers page uses for a plan's end date, so this
        // board and the Meal Customers tab never disagree about when a plan ends.
        dueDate: sub.effective_end_on ?? sub.ends_on ?? null,
        totalNights: null,
        totalAmount: balance.totalPayable,
        totalPaid: balance.totalPaid,
        remainingBalance: balance.remainingBalance,
        breakup,
        ...summarise(breakup),
      });
    }

    if (rows.length === 0) return { success: true, data: [] };

    // ── 5. Customer identity ────────────────────────────────────────────────
    // Fetched here rather than joined on the client because ACCOMMODATION
    // customers are not in a clinic-scoped admin's directory at all — every one
    // of them has `clinic_id = NULL`, so the page's `.eq("clinic_id", ...)`
    // excludes them. Without this read, a Clinic_Scoped_Admin would see an empty
    // board. See `PartialPaymentVisibilityNote` in @/types/partialPayment.
    //
    // The `.in()` list is bounded by the outstanding working set (tens of rows),
    // never by the customer directory.
    const profileIds = Array.from(
      new Set(rows.map((row) => row.customerProfileId)),
    );

    const { data: profiles, error: profileError } = await admin
      .from("customer_profiles")
      .select(
        `
        id,
        is_active,
        dietary_preference,
        gender,
        date_of_birth,
        allergies,
        has_medical_history,
        clinic_id,
        dietitian_id,
        clinics ( name ),
        users!customer_profiles_user_id_fkey ( full_name, email, mobile ),
        dietitian:users!customer_profiles_dietitian_id_fkey ( full_name ),
        addresses ( pincode, is_primary, lat, lng )
      `,
      )
      .in("id", profileIds);

    if (profileError) return { error: profileError.message };

    const snapshots = new Map<string, CustomerData>();
    for (const profile of profiles ?? []) {
      const user = Array.isArray(profile.users) ? profile.users[0] : profile.users;
      const dietitian = Array.isArray(profile.dietitian)
        ? profile.dietitian[0]
        : profile.dietitian;
      const clinic = Array.isArray(profile.clinics)
        ? profile.clinics[0]
        : profile.clinics;
      const addresses = (profile.addresses ?? []) as {
        pincode: string | null;
        is_primary: boolean | null;
        lat: number | null;
        lng: number | null;
      }[];
      const primaryAddress =
        addresses.find((address) => address.is_primary) ?? addresses[0];

      let age: number | null = null;
      if (profile.date_of_birth) {
        const birth = new Date(profile.date_of_birth);
        if (!Number.isNaN(birth.getTime())) {
          const now = new Date();
          age = now.getFullYear() - birth.getFullYear();
          const monthDelta = now.getMonth() - birth.getMonth();
          if (
            monthDelta < 0 ||
            (monthDelta === 0 && now.getDate() < birth.getDate())
          ) {
            age -= 1;
          }
        }
      }

      snapshots.set(profile.id, {
        id: profile.id,
        fullName: user?.full_name || "N/A",
        email: user?.email || "N/A",
        mobile: user?.mobile || "N/A",
        dietary_preference: profile.dietary_preference || "N/A",
        primary_pincode: primaryAddress?.pincode || "N/A",
        // Lifecycle status is carried per-entity on the row itself (a customer
        // can hold one settled and one outstanding entity), so these two
        // directory fields are filled from the row in the loop below rather than
        // guessed here.
        status: "",
        activePlanName: null,
        customerCategory: null,
        gender: profile.gender || "N/A",
        dateOfBirth: profile.date_of_birth || "",
        age,
        allergies: profile.allergies ?? null,
        hasMedicalHistory: Boolean(profile.has_medical_history),
        isActive: Boolean(profile.is_active),
        clinic_id: profile.clinic_id ?? null,
        clinicName: clinic?.name ?? null,
        dietitianId: profile.dietitian_id ?? null,
        dietitianName: dietitian?.full_name ?? null,
        hasCoords: Boolean(primaryAddress?.lat && primaryAddress?.lng),
      });
    }

    // ── 6. Clinic confinement — MEAL ONLY (SECURITY) ─────────────────────────
    // A Clinic_Scoped_Admin may read their own clinic's MEAL dues and no other
    // clinic's. ACCOMMODATION is deliberately exempt: it is one shared property
    // rather than a per-clinic operation, and every accommodation customer is
    // clinic-less anyway, so confining it would hide the entire domain from
    // every clinic-scoped admin.
    //
    // Enforced server-side, not in the component, so the rule holds even for a
    // hand-crafted call to this action.
    const hydrated: PartialPaymentBalance[] = [];
    for (const row of rows) {
      const customerSnapshot = snapshots.get(row.customerProfileId);
      // No resolvable customer means no row — fail closed rather than render a
      // balance with no owner.
      if (!customerSnapshot) continue;

      if (
        clinicId &&
        row.source === "MEAL" &&
        customerSnapshot.clinic_id !== clinicId
      ) {
        continue;
      }

      hydrated.push({
        ...row,
        customerSnapshot: {
          ...customerSnapshot,
          // Surface THIS entity's lifecycle and label, so a customer holding two
          // entities reports each one's own state.
          status: row.entityStatus,
          activePlanName: row.entityLabel,
          customerCategory: row.source === "STAY" ? "ACCOMMODATION" : "MEAL",
        },
      });
    }

    return { success: true, data: hydrated };
  } catch (err) {
    return {
      error:
        err instanceof Error
          ? err.message
          : "Failed to load partial payment balances",
    };
  }
}
