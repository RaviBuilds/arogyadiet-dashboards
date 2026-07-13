"use server";

// src/actions/master-actions/rateConfigActions.ts
// Master-portal Server Actions for the Rate Configuration card.
//
// LAYERING: Action layer ONLY. Orchestrates authorization (MASTER_ADMIN role
// check), validation (MASTER_CARD_MAX_RATE_PER_KM bound), persistence via
// RateConfigService, audit logging, and path revalidation.
//
// Requirements: 10.6, 10.7, 10.8, 10.9, 12.1, 12.2, 12.3

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { MASTER_CARD_MAX_RATE_PER_KM } from "@/lib/delivery/deliveryCharge";
import {
  listRateConfigs,
  upsertRate,
  type RateScope,
  type RateField,
} from "@/services/RateConfigService";

// ─── Types ───────────────────────────────────────────────────────────────────

/** Shape returned by getRateConfigsAction on success. */
export type RateConfigView = Awaited<ReturnType<typeof listRateConfigs>>;

// ─── Authorization ───────────────────────────────────────────────────────────

const ALLOWED_ROLES = new Set(["MASTER_ADMIN"]);

/**
 * Resolve the calling user and confirm they hold a MASTER_ADMIN role.
 * Returns the internal user ID on success for audit logging (Req 12.1, 12.2).
 */
async function assertMasterAdmin(): Promise<
  { ok: true; userId: string } | { ok: false; error: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { ok: false, error: "Unauthorized" };

  const { data: userRecord } = await supabase
    .from("users")
    .select("id, roles(code)")
    .eq("auth_user_id", user.id)
    .single();

  if (!userRecord) return { ok: false, error: "User record not found" };

  const rolesData = userRecord.roles as
    | { code?: string }
    | { code?: string }[]
    | null;
  const roleCode = Array.isArray(rolesData)
    ? rolesData[0]?.code
    : rolesData?.code;

  if (!roleCode || !ALLOWED_ROLES.has(roleCode)) {
    return {
      ok: false,
      error: "Only a Master Admin can manage rate configurations",
    };
  }

  return { ok: true, userId: userRecord.id };
}

// ─── Actions ─────────────────────────────────────────────────────────────────

/**
 * Fetches all rate configurations for the master card view.
 * Returns Core rates + per-franchise entries (Req 10.6).
 */
export async function getRateConfigsAction(): Promise<
  | { success: true; data: RateConfigView }
  | { success: false; error: string }
> {
  const auth = await assertMasterAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  try {
    const supabase = await createClient();
    const data = await listRateConfigs(supabase);
    return { success: true, data };
  } catch (err) {
    console.error("getRateConfigsAction error:", err);
    return { success: false, error: "Failed to load rate configurations" };
  }
}

/**
 * Upserts a single rate field for a given scope after validating against the
 * master-card bound (MASTER_CARD_MAX_RATE_PER_KM = ₹9,999.99).
 *
 * On success writes an audit log row and revalidates the master system page
 * (Req 10.7, 10.8, 10.9, 12.3).
 */
export async function upsertRateAction(input: {
  scope: RateScope;
  field: RateField;
  value: number;
}): Promise<{ success: true } | { success: false; error: string; field?: string }> {
  const auth = await assertMasterAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const { scope, field, value } = input;

  // ─── Master-card validation (Req 10.7, 10.8) ────────────────────────────
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return { success: false, error: "Rate must be a valid number", field };
  }
  if (value < 0) {
    return { success: false, error: "Rate must not be negative", field };
  }
  if (value > MASTER_CARD_MAX_RATE_PER_KM) {
    return {
      success: false,
      error: `Rate must not exceed ₹${MASTER_CARD_MAX_RATE_PER_KM.toLocaleString("en-IN")} per km`,
      field,
    };
  }
  // Check at most 2 decimal places
  const scaled = Math.round(value * 100);
  if (Math.abs(value * 100 - scaled) > 1e-9) {
    return { success: false, error: "Rate must have at most 2 decimal places", field };
  }

  // ─── Persist via RateConfigService ──────────────────────────────────────
  try {
    const supabase = await createClient();
    const result = await upsertRate(supabase, scope, field, value);

    if (!result.ok) {
      return { success: false, error: result.error, field };
    }

    // ─── Audit log (Req 12.3) ─────────────────────────────────────────────
    const scopeType = scope.type === "CORE_BUSINESS" ? "CORE_BUSINESS" : "FRANCHISE";
    const franchiseId = scope.type === "FRANCHISE" ? scope.franchiseId : null;

    const { error: auditError } = await supabase
      .from("rate_config_audit_logs")
      .insert({
        actor_user_id: auth.userId,
        scope_type: scopeType,
        franchise_id: franchiseId,
        field,
        previous_value: result.previous,
        new_value: value,
        created_at: new Date().toISOString(),
      });

    if (auditError) {
      // Log but don't fail the action — the rate was persisted successfully
      console.error("Audit log write failed:", auditError);
    }

    // ─── Revalidate master system page (Req 10.9) ─────────────────────────
    revalidatePath("/master/system");

    return { success: true };
  } catch (err) {
    console.error("upsertRateAction error:", err);
    return { success: false, error: "Failed to update rate configuration" };
  }
}
