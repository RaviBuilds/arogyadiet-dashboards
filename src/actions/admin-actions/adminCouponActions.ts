"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { z } from "zod";

// ─── schemas ────────────────────────────────────────────────────────────────

const createCouponSchema = z
  .object({
    customerProfileId: z.string().uuid(),
    code: z
      .string()
      .min(3, "Code must be at least 3 characters")
      .max(30, "Code must be 30 characters or less")
      .regex(/^[A-Z0-9_-]+$/, "Code can only contain letters, numbers, - and _"),
    discountType: z.enum(["FLAT", "PERCENTAGE"]),
    // FLAT fields
    discountValue30Days: z.number().min(0).optional(),
    discountValue60Days: z.number().min(0).optional(),
    discountValue90Days: z.number().min(0).optional(),
    // PERCENTAGE field
    discountValue: z.number().min(0).max(100).optional(),
    maxUses: z.number().int().min(1, "Max uses must be at least 1"),
    expiresAt: z.string().optional(),
  })
  .superRefine((d, ctx) => {
    if (d.discountType === "FLAT") {
      const hasAny =
        (d.discountValue30Days ?? 0) > 0 ||
        (d.discountValue60Days ?? 0) > 0 ||
        (d.discountValue90Days ?? 0) > 0;
      if (!hasAny) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "At least one plan duration discount must be greater than 0",
          path: ["discountValue30Days"],
        });
      }
    }
    if (d.discountType === "PERCENTAGE") {
      if (!d.discountValue || d.discountValue <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Discount percentage must be greater than 0",
          path: ["discountValue"],
        });
      }
    }
  });

type ActionResult = { success: boolean; error?: string };

// ─── createCoupon ────────────────────────────────────────────────────────────

export async function createCoupon(
  formData: z.infer<typeof createCouponSchema>,
): Promise<ActionResult> {
  const parsed = createCouponSchema.safeParse(formData);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const d = parsed.data;
  const supabase = createAdminClient();

  try {
    // Check for duplicate code for this customer
    const { data: existing } = await supabase
      .from("coupons")
      .select("id")
      .eq("code", d.code)
      .eq("customer_profile_id", d.customerProfileId)
      .maybeSingle();

    if (existing) {
      return {
        success: false,
        error: `Coupon code "${d.code}" already exists for this customer.`,
      };
    }

    const { error } = await supabase.from("coupons").insert({
      customer_profile_id: d.customerProfileId,
      code: d.code,
      discount_type: d.discountType,
      discount_value_30_days: d.discountValue30Days ?? 0,
      discount_value_60_days: d.discountValue60Days ?? 0,
      discount_value_90_days: d.discountValue90Days ?? 0,
      discount_value: d.discountValue ?? 0,
      max_uses: d.maxUses,
      times_used: 0,
      expires_at: d.expiresAt ? new Date(d.expiresAt).toISOString() : null,
    });

    if (error) throw new Error(error.message);

    revalidatePath(`/admin/customers`);

    return { success: true };
  } catch (err: unknown) {
    const msg =
      err instanceof Error ? err.message : "Failed to create coupon.";
    console.error("createCoupon error:", msg);
    return { success: false, error: msg };
  }
}

// ─── deleteCoupon ────────────────────────────────────────────────────────────

export async function deleteCoupon(
  couponId: string,
  customerProfileId: string,
): Promise<ActionResult> {
  const supabase = createAdminClient();

  try {
    const { error } = await supabase
      .from("coupons")
      .delete()
      .eq("id", couponId)
      .eq("customer_profile_id", customerProfileId);

    if (error) throw new Error(error.message);

    revalidatePath(`/admin/customers`);

    return { success: true };
  } catch (err: unknown) {
    const msg =
      err instanceof Error ? err.message : "Failed to delete coupon.";
    console.error("deleteCoupon error:", msg);
    return { success: false, error: msg };
  }
}
