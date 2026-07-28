// src/services/KitReportService.ts
//
// Business logic layer for KIT PDF report generation.
// Handles authorization, data assembly, PDF rendering, and caching.
//
// LAYERING: This module applies authorization checks and orchestrates
// data fetching + PDF generation. Data access is delegated to
// `src/repositories/kitLifecycleRepository`.
//
// Requirements: 9.1, 9.5, 9.7, 10.1, 10.4, 12.3

import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import React from "react";

import { getISTDateString } from "@/lib/dates/ist";
import { createAdminClient } from "@/lib/supabase/admin";
import * as repo from "@/repositories/kitLifecycleRepository";
import type { KitDailyLogRow } from "@/repositories/kitLifecycleRepository";

import { KitReportDocument, type KitReportData } from "./KitReportTemplate";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum time allowed for PDF generation before timeout (ms). Req 9.6, 10.5 */
const GENERATION_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate or retrieve a cached PDF report for a KIT subscription.
 *
 * Authorization:
 * - Verifies the subscription belongs to the requesting customer (Req 9.7)
 * - Verifies the subscription is a KIT category (Req 12.3)
 * - Rejects PENDING subscriptions (no report available)
 *
 * Behavior by status:
 * - ACTIVE: Generate PDF dynamically from kit_received_date through current IST date (Req 9.1, 9.5)
 * - EXPIRED: Check cache first; if not cached, generate and cache (Req 10.1, 10.4)
 *
 * Returns PDF as Buffer, or throws an error for authorization/generation failures.
 *
 * Validates: Requirements 9.1, 9.5, 9.7, 10.1, 10.4, 12.3
 */
export async function generateReport(
  subscriptionId: string,
  customerProfileId: string
): Promise<Buffer> {
  // 1. Authorize ownership and validate category
  const subscription = await repo.getSubscriptionWithOwner(subscriptionId);

  if (!subscription) {
    throw new ReportError("Subscription not found.", 404);
  }

  if (subscription.customer_profile_id !== customerProfileId) {
    throw new ReportError("Unauthorized: subscription does not belong to this customer.", 403);
  }

  if (subscription.customer_category !== "KIT") {
    throw new ReportError("Category mismatch: not a KIT subscription.", 403);
  }

  if (subscription.status === "PENDING") {
    throw new ReportError("Report not available for pending subscriptions.", 400);
  }

  if (!subscription.kit_received_date) {
    throw new ReportError("KIT has not been started yet.", 400);
  }

  // 2. For EXPIRED KITs, check cache first (Req 10.4)
  if (subscription.status === "EXPIRED") {
    const cached = await repo.getCachedReport(subscriptionId);
    if (cached && cached.pdf_data) {
      return Buffer.from(cached.pdf_data);
    }
  }

  // 3. Assemble report data and generate PDF with timeout
  const pdfBuffer = await generateWithTimeout(subscription);

  // 4. Cache the report for EXPIRED KITs (Req 10.4)
  if (subscription.status === "EXPIRED") {
    await repo.saveCachedReport(subscriptionId, pdfBuffer);
  }

  return pdfBuffer;
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

/**
 * Generate the PDF with a 30-second timeout.
 * Throws ReportError if generation exceeds the timeout.
 */
async function generateWithTimeout(
  subscription: repo.KitSubscriptionRow
): Promise<Buffer> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new ReportError("Report generation timed out.", 500));
    }, GENERATION_TIMEOUT_MS);
  });

  const generationPromise = generatePdf(subscription);

  return Promise.race([generationPromise, timeoutPromise]);
}

/**
 * Assemble all data and render the PDF to a Buffer.
 */
async function generatePdf(
  subscription: repo.KitSubscriptionRow
): Promise<Buffer> {
  // Fetch daily logs for the subscription
  const dailyLogs = await repo.getDailyLogsForSubscription(subscription.id);

  // Fetch customer name
  const customerName = await getCustomerName(subscription.customer_profile_id);

  // Fetch KIT product name
  const kitProductName = await getKitProductName(subscription.kit_product_id);

  // Determine date range based on status
  const startDate = subscription.kit_received_date!;
  let endDate: string;

  if (subscription.status === "EXPIRED" && subscription.kit_tracker_end_date) {
    // EXPIRED: from kit_received_date through tracker_end_date (Req 10.1)
    endDate = subscription.kit_tracker_end_date;
  } else {
    // ACTIVE: from kit_received_date through current IST date (Req 9.1)
    endDate = getISTDateString(0);
  }

  // Build the full date range array
  const dateRange = buildDateRange(startDate, endDate);

  // Build a Map of daily logs keyed by log_date for O(1) lookup
  const dailyLogsByDate = new Map<string, KitDailyLogRow>();
  for (const log of dailyLogs) {
    dailyLogsByDate.set(log.log_date, log);
  }

  // Assemble the report data
  const reportData: KitReportData = {
    customerName,
    kitProductName,
    durationDays: subscription.kit_duration_days ?? 0,
    startDate,
    endDate: subscription.status === "EXPIRED" ? endDate : null,
    status: subscription.status as "ACTIVE" | "EXPIRED",
    totalSkippedDays: subscription.kit_total_skipped_days ?? 0,
    dailyLogsByDate,
    dateRange,
  };

  // Render PDF to buffer using @react-pdf/renderer
  const element = React.createElement(
    KitReportDocument,
    { data: reportData }
  ) as React.ReactElement<DocumentProps>;
  const buffer = await renderToBuffer(element);

  return Buffer.from(buffer);
}

/**
 * Fetch the customer's full_name via the users table.
 * Falls back to "Customer" if not found.
 */
async function getCustomerName(customerProfileId: string): Promise<string> {
  const admin = createAdminClient();

  const { data } = await admin
    .from("customer_profiles")
    .select("users!customer_profiles_user_id_fkey(full_name)")
    .eq("id", customerProfileId)
    .maybeSingle();

  if (!data || !data.users) return "Customer";

  const users = data.users as
    | { full_name?: string | null }
    | { full_name?: string | null }[];
  const user = Array.isArray(users) ? users[0] : users;

  return user?.full_name?.trim() || "Customer";
}

/**
 * Fetch the KIT product name.
 * Falls back to "KIT Product" if not found.
 */
async function getKitProductName(
  kitProductId: string | null
): Promise<string> {
  if (!kitProductId) return "KIT Product";

  const admin = createAdminClient();

  const { data } = await admin
    .from("kit_products")
    .select("name")
    .eq("id", kitProductId)
    .maybeSingle();

  return data?.name?.trim() || "KIT Product";
}

/**
 * Build an array of YYYY-MM-DD date strings from startDate to endDate inclusive.
 */
function buildDateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const [startYear, startMonth, startDay] = startDate.split("-").map(Number);
  const [endYear, endMonth, endDay] = endDate.split("-").map(Number);

  const start = new Date(Date.UTC(startYear, startMonth - 1, startDay));
  const end = new Date(Date.UTC(endYear, endMonth - 1, endDay));

  const current = new Date(start);
  while (current <= end) {
    const year = current.getUTCFullYear();
    const month = String(current.getUTCMonth() + 1).padStart(2, "0");
    const day = String(current.getUTCDate()).padStart(2, "0");
    dates.push(`${year}-${month}-${day}`);
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return dates;
}

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

/**
 * Custom error for report generation with HTTP status code.
 */
export class ReportError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "ReportError";
    this.statusCode = statusCode;
  }
}
