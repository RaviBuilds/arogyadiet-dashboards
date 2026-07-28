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

import { getISTDateString, istDateStringOf } from "@/lib/dates/ist";
import { deserializeCustomParameters } from "@/lib/dietitian/customParameters";
import { createAdminClient } from "@/lib/supabase/admin";
import * as healthRepo from "@/repositories/healthReportRepository";
import * as repo from "@/repositories/kitLifecycleRepository";
import type { KitDailyLogRow } from "@/repositories/kitLifecycleRepository";
import type { ParameterValue } from "@/types/dietitian";

import {
  KitReportDocument,
  type KitBPTrendPoint,
  type KitDietitianLogEntry,
  type KitReportData,
  type KitReportTrends,
  type KitTrendPoint,
} from "./KitReportTemplate";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum time allowed for PDF generation before timeout (ms). Req 9.6, 10.5 */
const GENERATION_TIMEOUT_MS = 30_000;

/**
 * Cache epoch for the KIT report template.
 *
 * EXPIRED KIT reports are cached as rendered PDF bytes, so a template change
 * would otherwise keep serving the old layout forever for already-expired
 * KITs. Any cache row generated before this instant is treated as stale and
 * re-rendered (the save is an upsert, so the stale row is overwritten in
 * place — nothing is deleted). Bump this whenever the template's content or
 * data shape changes.
 *
 * Current epoch: dual customer + dietitian log sections.
 */
const TEMPLATE_CACHE_EPOCH = Date.parse("2026-07-29T00:00:00Z");

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

  // 2. For EXPIRED KITs, check cache first (Req 10.4). A cache row rendered
  //    by an older template revision is ignored so the reader always gets the
  //    current layout; step 4 overwrites it.
  if (subscription.status === "EXPIRED") {
    const cached = await repo.getCachedReport(subscriptionId);
    if (cached && cached.pdf_data && !isCacheStale(cached.generated_at)) {
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

  // Both log sources plus the header names, fetched in parallel — the customer's
  // own `kit_daily_logs` and the Dietitian-authored `health_logs` inside the
  // same tracker window, so the report shows one period from two authors.
  const [dailyLogs, kitProductName, headerInfo, dietitianLogs] = await Promise.all([
    repo.getDailyLogsForSubscription(subscription.id),
    getKitProductName(subscription.kit_product_id),
    healthRepo.getReportHeaderInfo(subscription.customer_profile_id),
    healthRepo.getDietitianHealthLogsInWindow(
      subscription.customer_profile_id,
      startDate,
      endDate,
    ),
  ]);

  // Build the full date range array
  const dateRange = buildDateRange(startDate, endDate);

  // Build a Map of daily logs keyed by log_date for O(1) lookup
  const dailyLogsByDate = new Map<string, KitDailyLogRow>();
  for (const log of dailyLogs) {
    dailyLogsByDate.set(log.log_date, log);
  }

  const dietitianEntries: KitDietitianLogEntry[] = dietitianLogs.map((log) => ({
    logDate: log.logDate,
    parameters: log.parameters,
    customParameters: deserializeCustomParameters(log.customParameters),
    closingComment: log.closingComment,
  }));

  // Assemble the report data
  const reportData: KitReportData = {
    customerName: headerInfo.customerName,
    kitProductName,
    dietitianName: headerInfo.dietitianName,
    durationDays: subscription.kit_duration_days ?? 0,
    startDate,
    endDate: subscription.status === "EXPIRED" ? endDate : null,
    status: subscription.status as "ACTIVE" | "EXPIRED",
    totalSkippedDays: subscription.kit_total_skipped_days ?? 0,
    dailyLogsByDate,
    dateRange,
    dietitianEntries,
    trends: buildTrends(dateRange, dailyLogsByDate, dietitianLogs),
    generatedAtIst: formatGeneratedAtIst(new Date()),
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
 * Build the trend series the report charts.
 *
 * Weight is split by author: the customer's daily self-logged `weight_kg` and
 * the Dietitian's `weight` parameter stay as separate series because they are
 * separate measurements. BP and Fasting Sugar exist only in Dietitian logs —
 * `kit_daily_logs` has no column for either.
 */
function buildTrends(
  dateRange: readonly string[],
  dailyLogsByDate: ReadonlyMap<string, KitDailyLogRow>,
  dietitianLogs: readonly healthRepo.DietitianHealthLogRow[],
): KitReportTrends {
  const customerWeight: KitTrendPoint[] = [];
  const dietitianWeight: KitTrendPoint[] = [];
  const bp: KitBPTrendPoint[] = [];
  const fastingSugar: KitTrendPoint[] = [];

  // dateRange is chronological, so the series come out date-ascending.
  for (const date of dateRange) {
    const log = dailyLogsByDate.get(date);
    if (log && log.status === "FOOD_TAKEN" && log.weight_kg !== null) {
      customerWeight.push({ date, value: log.weight_kg });
    }
  }

  // The repository already orders dietitian logs by log_date ascending.
  for (const log of dietitianLogs) {
    const params = log.parameters ?? {};

    const weightValue = readNumericParameter(params.weight);
    if (weightValue !== null) {
      dietitianWeight.push({ date: log.logDate, value: weightValue });
    }

    const bpValue = params.bp as ParameterValue | undefined;
    if (bpValue && "systolic" in bpValue) {
      bp.push({ date: log.logDate, systolic: bpValue.systolic, diastolic: bpValue.diastolic });
    }

    const sugarValue = readNumericParameter(params.fasting_sugar);
    if (sugarValue !== null) {
      fastingSugar.push({ date: log.logDate, value: sugarValue });
    }
  }

  return { customerWeight, dietitianWeight, bp, fastingSugar };
}

/** Reads a numeric `ParameterValue`'s value, or `null` when absent/non-numeric. */
function readNumericParameter(value: ParameterValue | undefined): number | null {
  if (!value) return null;
  if ("systolic" in value) return null;
  if (typeof value.value === "number") return value.value;
  return null;
}

/** Formats a generation instant as a display string in IST, mirroring the Health Report. */
function formatGeneratedAtIst(instant: Date): string {
  const dateStr = istDateStringOf(instant);
  const [year, month, day] = dateStr.split("-").map(Number);
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const timeStr = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(instant);
  return `${day} ${months[month - 1]} ${year}, ${timeStr} IST`;
}

/** True when a cached PDF predates the current template revision. */
function isCacheStale(generatedAt: string | null | undefined): boolean {
  if (!generatedAt) return true;
  const generatedMs = Date.parse(generatedAt);
  if (Number.isNaN(generatedMs)) return true;
  return generatedMs < TEMPLATE_CACHE_EPOCH;
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
