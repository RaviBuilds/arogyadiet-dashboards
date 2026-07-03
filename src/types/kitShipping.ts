/**
 * KIT Shipping Type Definitions
 * 
 * Represents courier delivery information for KIT subscription orders.
 * KIT subscriptions are one-time meal package purchases delivered via courier
 * (not riders), completely isolated from meal subscription delivery logic.
 * 
 * Requirements: 6.2, 9.4
 */

/**
 * Courier partner options for KIT delivery
 * Exactly 4 partners as specified in Requirement 6.2
 */
export type CourierPartner = 'OTHER' | 'APSRTC' | 'TGSRTC' | 'DTDC';

/**
 * Shipping information for a KIT subscription order
 * Links to both customer profile and subscription for data integrity
 */
export interface ShippingInfo {
  id: string;
  customer_profile_id: string;
  subscription_id: string;
  courier_partner: CourierPartner;
  tracking_number: string;
  tracking_url?: string; // Required only when courier_partner === 'OTHER'
  shipped_at?: Date;
  delivered_at?: Date;
  created_at: Date;
  updated_at: Date;
}

/**
 * Database row representation with timestamp strings
 * Used when reading directly from Supabase
 */
export interface ShippingInfoRow {
  id: string;
  customer_profile_id: string;
  subscription_id: string;
  courier_partner: CourierPartner;
  tracking_number: string;
  tracking_url?: string | null;
  shipped_at?: string | null;
  delivered_at?: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Helper type for creating shipping information
 * Used in the Shipping Dashboard form
 */
export interface CreateShippingInfoInput {
  customer_profile_id: string;
  subscription_id: string;
  courier_partner: CourierPartner;
  tracking_number: string;
  tracking_url?: string; // Required when courier_partner === 'OTHER'
  shipped_at?: Date;
  delivered_at?: Date;
}

/**
 * Helper type for updating shipping information
 * Allows partial updates while preserving required fields
 */
export interface UpdateShippingInfoInput {
  courier_partner?: CourierPartner;
  tracking_number?: string;
  tracking_url?: string;
  shipped_at?: Date;
  delivered_at?: Date;
}

/**
 * Shipping information with customer and subscription details
 * Used in admin dashboard views
 */
export interface ShippingInfoWithDetails extends ShippingInfo {
  customer_name?: string;
  customer_code?: string;
  kit_product_name?: string;
}

/**
 * Transform database row to ShippingInfo with parsed dates
 */
export function transformShippingInfoRow(row: ShippingInfoRow): ShippingInfo {
  return {
    id: row.id,
    customer_profile_id: row.customer_profile_id,
    subscription_id: row.subscription_id,
    courier_partner: row.courier_partner,
    tracking_number: row.tracking_number,
    tracking_url: row.tracking_url ?? undefined,
    shipped_at: row.shipped_at ? new Date(row.shipped_at) : undefined,
    delivered_at: row.delivered_at ? new Date(row.delivered_at) : undefined,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
  };
}

/**
 * Validate tracking URL requirement based on courier partner
 * Returns true if validation passes, error message if fails
 */
export function validateTrackingUrl(
  courierPartner: CourierPartner,
  trackingUrl?: string
): { valid: boolean; error?: string } {
  if (courierPartner === 'OTHER') {
    if (!trackingUrl || trackingUrl.trim() === '') {
      return {
        valid: false,
        error: 'Tracking URL is required when using "Other shipping" courier.',
      };
    }
  }
  return { valid: true };
}

/**
 * Get display name for courier partner
 */
export function getCourierDisplayName(courier: CourierPartner): string {
  const displayNames: Record<CourierPartner, string> = {
    OTHER: 'Other shipping',
    APSRTC: 'APSRTC Logistics',
    TGSRTC: 'TGSRTC Logistics',
    DTDC: 'DTDC',
  };
  return displayNames[courier];
}

/**
 * Get all available courier partners with display names
 * Used for dropdown population in Shipping Dashboard
 */
export function getCourierOptions(): Array<{
  value: CourierPartner;
  label: string;
}> {
  const couriers: CourierPartner[] = ['OTHER', 'APSRTC', 'TGSRTC', 'DTDC'];
  return couriers.map((courier) => ({
    value: courier,
    label: getCourierDisplayName(courier),
  }));
}

/**
 * Check if shipping information indicates delivery is complete
 */
export function isDelivered(shippingInfo: ShippingInfo): boolean {
  return shippingInfo.delivered_at !== undefined;
}

/**
 * Check if shipping information indicates package has been shipped
 */
export function isShipped(shippingInfo: ShippingInfo): boolean {
  return shippingInfo.shipped_at !== undefined;
}

/**
 * Get shipping status as human-readable string
 */
export function getShippingStatus(shippingInfo: ShippingInfo): string {
  if (isDelivered(shippingInfo)) {
    return 'Delivered';
  }
  if (isShipped(shippingInfo)) {
    return 'Shipped';
  }
  return 'Pending';
}
