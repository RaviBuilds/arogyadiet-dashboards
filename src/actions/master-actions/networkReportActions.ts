"use server";

// src/actions/master-actions/networkReportActions.ts
// Server Actions backing the consolidated cross-franchise reporting section on
// the Master home (multi-tenant-franchise — Task 13.7, Req 11.5–11.9).
//
// The Master home is MASTER_ADMIN-gated by its layout, so these actions read
// with full-network scope by default (Core + every Franchise) and support a
// single-Franchise drill-down (Req 11.6). All franchise-specific behavior is
// gated behind FRANCHISE_FEATURES_ENABLED: when the flag is OFF the drill-down
// list is empty and the report rolls up the full network exactly as today.

import {
  getConsolidatedNetworkReport,
  type ConsolidatedNetworkReport,
} from "@/services/dashboardMetrics";
import { listFranchises } from "@/repositories/franchise/franchiseRepository";
import { FRANCHISE_FEATURES_ENABLED } from "@/lib/franchise/constants";

/** A Franchise option for the network drill-down selector. */
export type NetworkFranchiseOption = {
  id: string;
  name: string;
};

/**
 * Loads the consolidated network report for a reporting period, optionally
 * drilled into a single Franchise (Req 11.5/11.6/11.7). Each metric is isolated
 * so a single failure does not block the others (Req 11.9); an empty period
 * yields zero values (Req 11.8).
 */
export async function loadConsolidatedNetworkReport(
  from: string,
  to: string,
  franchiseId?: string | null,
): Promise<ConsolidatedNetworkReport> {
  return getConsolidatedNetworkReport({ from, to, franchiseId });
}

/**
 * Lists the Franchises available for the drill-down selector. Returns an empty
 * list when the franchise feature is disabled, so the Master home shows only the
 * full-network view (and the drill-down control hides) — preserving today's
 * behavior (Req 20.x).
 */
export async function listNetworkFranchises(): Promise<NetworkFranchiseOption[]> {
  if (!FRANCHISE_FEATURES_ENABLED) {
    return [];
  }

  try {
    const franchises = await listFranchises();
    return franchises.map((f) => ({ id: f.id, name: f.name }));
  } catch {
    // A failure to enumerate franchises must not break the Master home; the
    // full-network report still renders without the drill-down.
    return [];
  }
}
