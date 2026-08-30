"use server";

// src/actions/franchise-actions/franchisePartialPaymentActions.ts
//
// The Franchise_Portal's Partial Payment board.
//
// WHY THIS IS NOT A WRAPPER OVER THE ADMIN ACTION.
// `admin-actions/partialPaymentActions.getPartialPaymentBalancesAction` cannot be
// reused for two independent reasons:
//
//   1. It opens with `guardCustomersWorkspace()`, the ADMIN page guard, which
//      REDIRECTS (not returns) anything that is not ADMIN / MASTER_ADMIN. A
//      franchise caller would be bounced, not given an error result.
//   2. More seriously, it queries `subscription_payment_balances` and
//      `stay_payment_balances` with NO tenant filter whatsoever — its only
//      confinement is `clinic_id` for the MEAL half. Widening its gate to admit
//      franchise callers would therefore have handed every franchise the
//      outstanding balances of every other tenant and of Core_Business.
//
// So the franchise board is its own action with its own scoping. It is also much
// narrower than the admin one:
//
//   * MEAL ONLY. Franchise sells Meal and KIT; Accommodation is not a franchise
//     product, so the entire STAY half is absent rather than filtered. Partial
//     payment is not offered on KIT at all (see the admin action's
//     `.eq("customer_category", "MEAL")`), which leaves exactly MEAL.
//   * No clinic confinement — a franchise owns one clinic, so there is nothing to
//     confine.
//
// The arithmetic is NOT restated: `deriveSubscriptionBalance` and the ledger
// summary helpers are the same audited functions the admin board uses, so the two
// boards cannot report different figures for the same subscription.

import { createAdminClient } from "@/lib/supabase/admin";
import { checkFranchiseCustomersRead } from "@/lib/auth/adminAccess";
import { deriveSubscriptionBalance } from "@/services/SubscriptionPaymentService";
import { toPaise } from "@/services/AccommodationService";
import { byDateAsc, summarise } from "@/lib/payments/partialPaymentBreakup";
import type {
  PartialPaymentBalance,
  PartialPaymentBreakupEntry,
} from "@/types/partialPayment";
import type { CustomerData } from "@/shared/components/admin/customers/CustomerDashboard";

/**
 * Every MEAL subscription of the caller's Franchise that still owes money.
 *
 * SCOPING, in order:
 *   1. PERMISSION — `checkFranchiseCustomersRead()`. Read-capable, so a view-only
 *      franchise user and a Franchise Dietitian may both see the board.
 *   2. TENANCY — the candidate subscriptions are narrowed to
 *      `customer_profiles.franchise_id = <caller's franchise>` BEFORE any balance
 *      is derived, so another tenant's dues are never even loaded.
 *   3. THE DIETITIAN_LINK — a Franchise Dietitian additionally sees only
 *      customers assigned to them, matching `dietitian_can_read_customer` and
 *      `scopeFranchiseCustomersForDietitian`. Tenancy alone is insufficient now
 *      that a franchise may run a team of Dietitians.
 *
 * Returns the same `PartialPaymentBalance[]` shape the shared
 * `PartialPaymentSection` consumes, so that component is reused unchanged apart
 * from accepting an injected loader.
 */
export async function franchiseGetPartialPaymentBalances(): Promise<
  { success: true; data: PartialPaymentBalance[] } | { error: string }
> {
  const gate = await checkFranchiseCustomersRead();
  if (!gate.ok) return { error: gate.error };

  const { franchiseId, userId } = gate.ctx;
  const { isDietitian } = gate;

  try {
    const admin = createAdminClient();

    // ── 1. Candidates: subscriptions the balance view thinks owe money ───────
    const { data: candidates, error: candidateError } = await admin
      .from("subscription_payment_balances")
      .select("subscription_id")
      .gt("remaining_balance", 0);

    if (candidateError) return { error: candidateError.message };

    const candidateIds = (candidates ?? []).map((row) => row.subscription_id);
    if (candidateIds.length === 0) return { success: true, data: [] };

    // ── 2. Narrow to THIS franchise's MEAL subscriptions (TENANCY) ───────────
    // The tenant filter is applied here, on the parent rows, so no other
    // tenant's ledger is ever read. `!inner` makes the franchise match a
    // requirement rather than a nullable embed.
    //
    // `customer_category = "MEAL"` is an equality test, not "not accommodation",
    // so a future category cannot leak onto this board by default — the same
    // reasoning the admin action documents.
    let subscriptionQuery = admin
      .from("subscriptions")
      .select(
        `
        id, customer_profile_id, status, customer_category, starts_on,
        effective_end_on, ends_on, total_payable,
        subscription_plans ( name ),
        customer_profiles!inner ( franchise_id, dietitian_id )
      `,
      )
      .in("id", candidateIds)
      .eq("customer_category", "MEAL")
      .eq("customer_profiles.franchise_id", franchiseId);

    // A Franchise Dietitian sees only their own assigned customers.
    if (isDietitian) {
      subscriptionQuery = subscriptionQuery.eq(
        "customer_profiles.dietitian_id",
        userId,
      );
    }

    const { data: subscriptions, error: subscriptionError } =
      await subscriptionQuery;

    if (subscriptionError) return { error: subscriptionError.message };

    const scopedIds = (subscriptions ?? []).map((sub) => sub.id as string);
    if (scopedIds.length === 0) return { success: true, data: [] };

    // ── 3. Ledgers, for the scoped subscriptions only ────────────────────────
    const { data: ledger, error: ledgerError } = await admin
      .from("subscription_payment_transactions")
      .select(
        "id, subscription_id, transaction_type, amount, transaction_date, payment_method, comment, remark",
      )
      .in("subscription_id", scopedIds);

    if (ledgerError) return { error: ledgerError.message };

    const breakups = new Map<string, PartialPaymentBreakupEntry[]>();
    for (const row of ledger ?? []) {
      const list = breakups.get(row.subscription_id) ?? [];
      list.push({
        id: row.id,
        transactionType: row.transaction_type,
        amount: Number(row.amount),
        transactionDate: row.transaction_date,
        paymentMethod: row.payment_method ?? null,
        comment: row.comment ?? null,
        remark: row.remark ?? null,
      });
      breakups.set(row.subscription_id, list);
    }

    type PendingRow = Omit<PartialPaymentBalance, "customerSnapshot">;
    const rows: PendingRow[] = [];

    for (const sub of subscriptions ?? []) {
      const breakup = breakups.get(sub.id as string);

      // MEMBERSHIP RULE 1: no ledger, no row. Mirrors the admin board, which uses
      // this to keep legacy ledger-less records off the collections list. Do not
      // relax to `?? []`.
      if (!breakup || breakup.length === 0) continue;

      breakup.sort(byDateAsc);

      const balance = deriveSubscriptionBalance(
        sub.id as string,
        sub.total_payable,
        breakup,
      );

      // MEMBERSHIP RULE 2: strictly positive, compared in paise. A settled
      // subscription leaves the board the instant its last instalment lands, and
      // an over-collected one (refund due) never appears on a collections list.
      if (toPaise(balance.remainingBalance) <= 0) continue;

      const plan = Array.isArray(sub.subscription_plans)
        ? sub.subscription_plans[0]
        : sub.subscription_plans;

      rows.push({
        source: "MEAL",
        entityId: sub.id as string,
        customerProfileId: sub.customer_profile_id as string,
        entityStatus: sub.status as string,
        entityLabel: plan?.name ?? "Custom Plan",
        periodStart: (sub.starts_on as string) ?? null,
        // Same precedence the directory uses for a plan's end date, so this board
        // and the Meal Customers tab never disagree about when a plan ends.
        dueDate:
          (sub.effective_end_on as string) ?? (sub.ends_on as string) ?? null,
        totalNights: null,
        totalAmount: balance.totalPayable,
        totalPaid: balance.totalPaid,
        remainingBalance: balance.remainingBalance,
        breakup,
        ...summarise(breakup),
      });
    }

    if (rows.length === 0) return { success: true, data: [] };

    // ── 4. Customer identity for the owing set ───────────────────────────────
    // Bounded by the outstanding working set, never by the directory. Re-filtered
    // on `franchise_id` as defence in depth: step 2 already guaranteed it, but a
    // snapshot read is what ends up on screen.
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
      .in("id", profileIds)
      .eq("franchise_id", franchiseId);

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
        // Filled per-entity below: one customer can hold a settled and an
        // outstanding subscription, so these belong to the ROW, not the profile.
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

    const hydrated: PartialPaymentBalance[] = [];
    for (const row of rows) {
      const customerSnapshot = snapshots.get(row.customerProfileId);
      // No resolvable, in-tenant customer means no row — FAIL CLOSED rather than
      // render a balance whose owner could not be confirmed.
      if (!customerSnapshot) continue;

      hydrated.push({
        ...row,
        customerSnapshot: {
          ...customerSnapshot,
          status: row.entityStatus,
          activePlanName: row.entityLabel,
          customerCategory: "MEAL",
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
