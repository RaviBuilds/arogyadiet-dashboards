/**
 * Shared fulfillment vocabulary for shop (`addon_orders`) orders.
 *
 * Feature: admin-place-shop-order-for-customer.
 *
 * These mirror the `addon_orders.fulfillment_status` CHECK values (see
 * `scripts/add-delivery-fulfillment-to-addon-orders.sql`). Centralized so the
 * placement service, the admin operations actions, and any UI use the exact
 * same string literals rather than re-typing them.
 */

/** Set by the franchise-stock fail-safe when stock couldn't be honored. */
export const FULFILLMENT_UNFULFILLABLE_STOCK = "UNFULFILLABLE_STOCK" as const;

/**
 * Set when the customer collects the product at the clinic. Applied at
 * placement time (operator ticked "Clinic pickup") — the order is created
 * already DELIVERED and never enters routing.
 */
export const FULFILLMENT_CLINIC_PICKUP = "CLINIC_PICKUP" as const;

/**
 * Set when an admin marks an existing order delivered manually from Operations
 * (e.g. handed over at the clinic after the order was placed). The order is set
 * DELIVERED and unlinked from any assigned delivery.
 */
export const FULFILLMENT_DELIVERED_OFFLINE = "DELIVERED_OFFLINE" as const;

export type AddonFulfillmentStatus =
  | typeof FULFILLMENT_UNFULFILLABLE_STOCK
  | typeof FULFILLMENT_CLINIC_PICKUP
  | typeof FULFILLMENT_DELIVERED_OFFLINE;

/** The addon_orders.status value for a completed (out-of-routing) order. */
export const ADDON_STATUS_DELIVERED = "DELIVERED" as const;
