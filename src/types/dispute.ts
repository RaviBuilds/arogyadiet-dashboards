// src/types/dispute.ts
// TypeScript interfaces for the franchise dispute management feature.
// (franchise-dispute-management spec — Task 1.2)
//
// These types model the dispute lifecycle between franchise owners and
// master admins: dispute records, joined views with franchise name,
// received order options for inventory disputes, and creation input.
//
// Requirements validated: 1.1, 3.2, 7.2

import type { DisputeCategory, DisputeStatus } from "@/validations/disputeSchema";

/**
 * A franchise dispute record as stored in the `franchise_disputes` table.
 */
export interface Dispute {
  id: string;
  franchise_id: string;
  category: DisputeCategory;
  description: string;
  status: DisputeStatus;
  master_admin_comment: string | null;
  related_order_ids: string[] | null;
  created_at: string;
  updated_at: string;
}

/**
 * A dispute record joined with the franchise name — used in the master portal
 * where all disputes are listed alongside their originating franchise.
 */
export interface DisputeWithFranchiseName extends Dispute {
  franchise_name: string;
}

/**
 * A received stock transfer option shown in the multi-select dropdown when
 * raising an Inventory category dispute. Limited to orders received within
 * the last 72 hours.
 */
export interface ReceivedOrderOption {
  id: string;
  product_name: string;
  quantity: number;
  received_at: string;
}

/**
 * Input shape for creating a new dispute via the repository layer.
 * The franchise_id is resolved from the authenticated session/cookie.
 */
export interface CreateDisputeInput {
  franchise_id: string;
  category: DisputeCategory;
  description: string;
  related_order_ids?: string[];
}
