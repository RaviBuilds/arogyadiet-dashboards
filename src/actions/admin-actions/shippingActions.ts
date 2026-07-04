"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { logAdminAction } from "@/lib/logger";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type {
  ShippingInfo,
  ShippingInfoRow,
  CreateShippingInfoInput,
  CourierPartner,
} from "@/types/kitShipping";
import {
  transformShippingInfoRow,
  validateTrackingUrl,
} from "@/types/kitShipping";
import type { CustomerCategory } from "@/lib/onboarding/category";

/**
 * KIT Shipping Management Actions
 * 
 * Server actions for managing courier tracking information for KIT subscriptions.
 * KIT subscriptions use courier-based delivery (not riders) and require tracking
 * information to be recorded and displayed to customers.
 * 
 * Requirements: 6.5, 9.4
 * Task: 12.2
 */

type ActionResult<T = void> =
  | { success: true; data?: T }
  | { success: false; error: string };

/**
 * Validates that a subscription belongs to the KIT category.
 * Throws an error if the subscription is not a KIT subscription.
 * 
 * This prevents MEAL customers from accessing KIT operations
 * like shipping management and courier tracking.
 * 
 * Requirements: 7.3
 * Task: 17.2
 */
async function assertKitSubscription(subscriptionId: string): Promise<void> {
  const supabase = createAdminClient();
  
  const { data: subscription, error } = await supabase
    .from("subscriptions")
    .select("customer_category")
    .eq("id", subscriptionId)
    .single();

  if (error || !subscription) {
    throw new Error("Subscription not found");
  }

  const category = subscription.customer_category as CustomerCategory;
  
  if (category !== "KIT") {
    throw new Error("This operation is only available for KIT subscriptions");
  }
}

// Validation schema for shipping information
const saveShippingInfoSchema = z.object({
  customer_profile_id: z.string().uuid("Invalid customer profile ID"),
  subscription_id: z.string().uuid("Invalid subscription ID"),
  courier_partner: z.enum(["OTHER", "APSRTC", "TGSRTC", "DTDC"], {
    message: "Invalid courier partner",
  }),
  tracking_number: z
    .string()
    .min(1, "Tracking number is required")
    .max(100, "Tracking number must be 100 characters or less"),
  tracking_url: z
    .string()
    .url("Invalid URL format")
    .optional()
    .or(z.literal("")),
  shipped_at: z.date().optional(),
  delivered_at: z.date().optional(),
});

/**
 * Save shipping information for a KIT subscription order
 * 
 * Creates or updates courier tracking details for a KIT customer. Enforces
 * the business rule that "Other shipping" courier requires a tracking URL.
 * 
 * Requirements: 6.5, 9.4
 * 
 * @param input - Shipping information including customer, subscription, courier details
 * @returns Action result with saved shipping data or error message
 */
export async function saveShippingInfoAction(
  input: CreateShippingInfoInput
): Promise<ActionResult<ShippingInfo>> {
  // Server-side validation
  const parsed = saveShippingInfoSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0].message,
    };
  }

  // Category validation: Prevent MEAL customers from accessing KIT operations (Req 7.3, Task 17.2)
  try {
    await assertKitSubscription(parsed.data.subscription_id);
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Invalid subscription category",
    };
  }

  // Validate tracking URL requirement for 'OTHER' courier (Req 6.3, 6.4)
  const urlValidation = validateTrackingUrl(
    parsed.data.courier_partner as CourierPartner,
    parsed.data.tracking_url
  );

  if (!urlValidation.valid) {
    return {
      success: false,
      error: urlValidation.error || "Tracking URL validation failed",
    };
  }

  try {
    const supabase = createAdminClient();

    // Check if shipping info already exists for this subscription
    const { data: existing } = await supabase
      .from("kit_shipping_info")
      .select("id")
      .eq("subscription_id", parsed.data.subscription_id)
      .single();

    let shippingData: ShippingInfoRow;

    if (existing) {
      // Update existing record
      const { data, error } = await supabase
        .from("kit_shipping_info")
        .update({
          courier_partner: parsed.data.courier_partner,
          tracking_number: parsed.data.tracking_number,
          tracking_url: parsed.data.tracking_url || null,
          // Auto-set shipped_at to now if not already set (entering tracking = shipped)
          shipped_at: parsed.data.shipped_at?.toISOString() || new Date().toISOString(),
          delivered_at: parsed.data.delivered_at?.toISOString() || null,
        })
        .eq("id", existing.id)
        .select()
        .single();

      if (error) {
        console.error("saveShippingInfoAction update error:", error);
        
        // Handle database constraint violation for tracking URL
        if (error.code === "23514") {
          return {
            success: false,
            error: 'Tracking URL is required when using "Other shipping" courier.',
          };
        }

        return {
          success: false,
          error: "Failed to update shipping information. Please try again.",
        };
      }

      if (!data) {
        return {
          success: false,
          error: "Failed to retrieve updated shipping data.",
        };
      }

      shippingData = data as ShippingInfoRow;

      // Log admin action
      await logAdminAction("UPDATE", "kit_shipping_info", shippingData.id, {
        courier_partner: shippingData.courier_partner,
        tracking_number: shippingData.tracking_number,
      });
    } else {
      // Insert new record
      const { data, error } = await supabase
        .from("kit_shipping_info")
        .insert({
          customer_profile_id: parsed.data.customer_profile_id,
          subscription_id: parsed.data.subscription_id,
          courier_partner: parsed.data.courier_partner,
          tracking_number: parsed.data.tracking_number,
          tracking_url: parsed.data.tracking_url || null,
          // Auto-set shipped_at to now (entering tracking info = package shipped)
          shipped_at: parsed.data.shipped_at?.toISOString() || new Date().toISOString(),
          delivered_at: parsed.data.delivered_at?.toISOString() || null,
        })
        .select()
        .single();

      if (error) {
        console.error("saveShippingInfoAction insert error:", error);
        
        // Handle database constraint violation for tracking URL
        if (error.code === "23514") {
          return {
            success: false,
            error: 'Tracking URL is required when using "Other shipping" courier.',
          };
        }

        return {
          success: false,
          error: "Failed to save shipping information. Please try again.",
        };
      }

      if (!data) {
        return {
          success: false,
          error: "Failed to retrieve saved shipping data.",
        };
      }

      shippingData = data as ShippingInfoRow;

      // Log admin action
      await logAdminAction("CREATE", "kit_shipping_info", shippingData.id, {
        customer_profile_id: shippingData.customer_profile_id,
        subscription_id: shippingData.subscription_id,
        courier_partner: shippingData.courier_partner,
      });
    }

    // Transform database row to ShippingInfo type
    const shippingInfo = transformShippingInfoRow(shippingData);

    // Revalidate relevant paths
    revalidatePath("/admin/customers");
    revalidatePath(`/admin/customers/${parsed.data.customer_profile_id}`);
    revalidatePath("/customer/dashboard");

    return {
      success: true,
      data: shippingInfo,
    };
  } catch (error) {
    console.error("saveShippingInfoAction unexpected error:", error);
    return {
      success: false,
      error: "An unexpected error occurred while saving shipping information.",
    };
  }
}

/**
 * Get shipping information for a KIT customer
 * 
 * Retrieves courier tracking details for a customer's KIT subscription order.
 * Used in both admin Shipping Dashboard and customer portal views.
 * 
 * Requirements: 9.4
 * 
 * @param customerId - The customer profile ID
 * @returns Action result with shipping info or null if not found
 */
export async function getShippingInfoAction(
  customerId: string
): Promise<ActionResult<ShippingInfo | null>> {
  // Validate customer ID format
  const customerIdSchema = z.string().uuid("Invalid customer ID");
  const parsed = customerIdSchema.safeParse(customerId);

  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0].message,
    };
  }

  try {
    const supabase = createAdminClient();

    // First, get the customer's active KIT subscription
    const { data: subscription, error: subError } = await supabase
      .from("subscriptions")
      .select("id, customer_category")
      .eq("customer_profile_id", parsed.data)
      .eq("status", "ACTIVE")
      .single();

    if (subError || !subscription) {
      return {
        success: false,
        error: "No active subscription found for this customer",
      };
    }

    // Category validation: Prevent MEAL customers from accessing KIT operations (Req 7.3, Task 17.2)
    try {
      await assertKitSubscription(subscription.id);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Invalid subscription category",
      };
    }

    // Query shipping info by customer_profile_id
    const { data, error } = await supabase
      .from("kit_shipping_info")
      .select("*")
      .eq("customer_profile_id", parsed.data)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("getShippingInfoAction database error:", error);
      return {
        success: false,
        error: "Failed to fetch shipping information.",
      };
    }

    // Return null if no shipping info exists yet
    if (!data) {
      return {
        success: true,
        data: null,
      };
    }

    // Transform database row to ShippingInfo type
    const shippingInfo = transformShippingInfoRow(data as ShippingInfoRow);

    return {
      success: true,
      data: shippingInfo,
    };
  } catch (error) {
    console.error("getShippingInfoAction unexpected error:", error);
    return {
      success: false,
      error: "An unexpected error occurred while fetching shipping information.",
    };
  }
}
