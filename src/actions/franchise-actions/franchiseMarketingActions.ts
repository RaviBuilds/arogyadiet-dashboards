"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { resolveFranchiseContext } from "@/lib/franchise/context";
import { logAdminAction } from "@/lib/logger";
import { revalidatePath } from "next/cache";
import {
  createGlobalCoupon,
  listGlobalCoupons,
} from "@/actions/admin-actions/adminCouponActions";
import {
  getHolidaysForMonth,
  saveHolidaysForMonth,
} from "@/actions/admin-actions/holidayActions";
import type { HolidayDayEntry } from "@/lib/holidays";

type Guard =
  | { success: true; franchiseId: string }
  | { success: false; error: string };

/**
 * Resolves the calling franchise admin's franchise_id from their session.
 * Rejects anyone who is not a FRANCHISE_ADMIN with an assigned franchise.
 *
 * The franchise scope is ALWAYS derived from the session here — the client
 * never gets to choose which franchise it writes to.
 */
async function resolveCallerFranchiseId(): Promise<Guard> {
  const ctx = await resolveFranchiseContext();

  if (!ctx) {
    return { success: false, error: "Unable to resolve franchise context." };
  }
  if (ctx.role !== "FRANCHISE_ADMIN") {
    return {
      success: false,
      error: "You are not authorized to perform franchise operations.",
    };
  }
  if (!ctx.franchise_id) {
    return { success: false, error: "No franchise is assigned to your account." };
  }

  return { success: true, franchiseId: ctx.franchise_id };
}

// ── Global Discounts (franchise-scoped) ──────────────────────────────────────

/** Lists global discount coupons owned by the calling franchise. */
export async function franchiseListGlobalCoupons(
  _scope?: string | null,
): Promise<
  | { success: true; data: unknown[] }
  | { success: false; error: string; data: never[] }
> {
  const caller = await resolveCallerFranchiseId();
  if (!caller.success) return { ...caller, data: [] };

  return listGlobalCoupons(caller.franchiseId);
}

/** Creates a global discount coupon scoped to the calling franchise. */
export async function franchiseCreateGlobalCoupon(
  formData: Parameters<typeof createGlobalCoupon>[0],
  _scope?: string | null,
): Promise<{ success: boolean; error?: string }> {
  const caller = await resolveCallerFranchiseId();
  if (!caller.success) return caller;

  const res = await createGlobalCoupon(formData, caller.franchiseId);
  if (res.success) revalidatePath("/subscriptions");
  return res;
}

/**
 * Deletes a franchise-owned global discount coupon.
 * Verifies the coupon belongs to the calling franchise before deleting.
 */
export async function franchiseDeleteGlobalCoupon(
  couponId: string,
): Promise<{ success: boolean; error?: string }> {
  const caller = await resolveCallerFranchiseId();
  if (!caller.success) return caller;

  const supabase = createAdminClient();

  try {
    const { error } = await supabase
      .from("coupons")
      .delete()
      .eq("id", couponId)
      .is("customer_profile_id", null)
      .eq("franchise_id", caller.franchiseId);

    if (error) throw new Error(error.message);

    await logAdminAction("DELETE", "global_coupon", couponId, {
      franchise_id: caller.franchiseId,
    });

    revalidatePath("/subscriptions");
    return { success: true };
  } catch (err: unknown) {
    const msg =
      err instanceof Error ? err.message : "Failed to delete global coupon.";
    console.error("franchiseDeleteGlobalCoupon error:", msg);
    return { success: false, error: msg };
  }
}

// ── Holiday Calendar (franchise-scoped) ──────────────────────────────────────

/** Loads holidays for a month for the calling franchise. */
export async function franchiseGetHolidaysForMonth(
  year: number,
  month: number,
  _scope?: string | null,
): ReturnType<typeof getHolidaysForMonth> {
  const caller = await resolveCallerFranchiseId();
  if (!caller.success) return { success: false, error: caller.error };

  return getHolidaysForMonth(year, month, caller.franchiseId);
}

/** Saves holidays for a month for the calling franchise. */
export async function franchiseSaveHolidaysForMonth(
  year: number,
  month: number,
  entries: HolidayDayEntry[],
  _scope?: string | null,
): ReturnType<typeof saveHolidaysForMonth> {
  const caller = await resolveCallerFranchiseId();
  if (!caller.success) return { success: false, error: caller.error };

  const res = await saveHolidaysForMonth(year, month, entries, caller.franchiseId);
  if (res.success) revalidatePath("/subscriptions");
  return res;
}
