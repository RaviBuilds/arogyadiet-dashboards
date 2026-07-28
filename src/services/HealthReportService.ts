// src/services/HealthReportService.ts
//
// Business logic for the Health Report — a MEAL subscription's report and an
// ACCOMMODATION stay's report.
// Mirrors `KitReportService`: authorize ownership + category, assemble the
// report data, then `renderToBuffer` under a 30-second timeout. Data access is
// delegated to `healthReportRepository`; this module never reads
// `next/headers` or a session (the Route Handler that calls it owns auth).
//
// The report contains ONLY the Dietitian-authored health-log values that fall
// inside the subscription's own date window, so the customer sees exactly what
// their Dietitian recorded for that subscription.

import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import React from "react";

import { getISTDateString, istDateStringOf } from "@/lib/dates/ist";
import { deserializeCustomParameters } from "@/lib/dietitian/customParameters";
import * as repo from "@/repositories/healthReportRepository";
import type { ParameterValue } from "@/types/dietitian";

import {
  HealthReportDocument,
  type BPTrendPoint,
  type HealthReportData,
  type HealthReportLogEntry,
  type HealthReportTrends,
  type TrendPoint,
} from "./HealthReportTemplate";

/** Maximum time allowed for PDF generation before timeout (ms). Mirrors KitReportService. */
const GENERATION_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate the per-subscription Health Report PDF for a MEAL customer.
 *
 * Authorization:
 * - Verifies the subscription belongs to the requesting customer.
 * - Verifies the subscription is a MEAL category.
 *
 * Returns the PDF as a Buffer, or throws {@link ReportError} for
 * authorization/generation failures.
 */
export async function generateMealHealthReport(
  subscriptionId: string,
  customerProfileId: string,
): Promise<Buffer> {
  const subscription = await repo.getMealSubscriptionForReport(subscriptionId);

  if (!subscription) {
    throw new ReportError("Subscription not found.", 404);
  }
  if (subscription.customerProfileId !== customerProfileId) {
    throw new ReportError("Unauthorized: subscription does not belong to this customer.", 403);
  }
  if (subscription.customerCategory !== "MEAL") {
    throw new ReportError("Category mismatch: not a meal subscription.", 403);
  }
  if (!subscription.startsOn) {
    throw new ReportError("Subscription has not started yet.", 400);
  }

  // Bound the health-log window by the subscription's effective end (or ends_on),
  // falling back to today for an open-ended/ongoing subscription.
  const windowStart = subscription.startsOn;
  const declaredEnd = subscription.effectiveEndOn ?? subscription.endsOn;
  const windowEnd = declaredEnd ?? getISTDateString(0);

  return generateWithTimeout({
    customerProfileId: subscription.customerProfileId,
    windowStart,
    windowEnd,
    planName: subscription.planName?.trim() || "Meal Plan",
    planLabel: "Plan",
    reportSubtitle: "Dietitian-recorded health tracking for your meal subscription",
    subscriptionCode: subscription.subscriptionCode,
    status: subscription.status,
    displayEndDate: declaredEnd ?? null,
    durationDays: computeDurationDays(subscription.totalDays, windowStart, declaredEnd),
  });
}

/**
 * Generate the per-stay Health Report PDF for an ACCOMMODATION customer.
 *
 * Same shape and aesthetic as the meal report; the health-log window is the
 * stay's `start_date` through its inclusive end date.
 */
export async function generateStayHealthReport(
  stayId: string,
  customerProfileId: string,
): Promise<Buffer> {
  const stay = await repo.getStayForReport(stayId);

  if (!stay) {
    throw new ReportError("Stay not found.", 404);
  }
  if (stay.customerProfileId !== customerProfileId) {
    throw new ReportError("Unauthorized: stay does not belong to this customer.", 403);
  }

  const stayLabel = [stay.stayType, stay.occupancyType].filter(Boolean).join(" · ");

  return generateWithTimeout({
    customerProfileId: stay.customerProfileId,
    windowStart: stay.startDate,
    windowEnd: stay.endDate,
    planName: stayLabel || "Accommodation Stay",
    planLabel: "Stay",
    reportSubtitle: "Dietitian-recorded health tracking for your stay",
    subscriptionCode: null,
    status: stay.status,
    displayEndDate: stay.endDate,
    durationDays: stay.totalNights,
  });
}

// ---------------------------------------------------------------------------
// Internal — data assembly
// ---------------------------------------------------------------------------

/**
 * Everything the shared assembly needs that differs between a MEAL
 * subscription and an ACCOMMODATION stay. The health-log body itself is
 * identical for both: the Dietitian_Logs inside `[windowStart, windowEnd]`.
 */
interface ReportRequest {
  customerProfileId: string;
  windowStart: string;
  windowEnd: string;
  planName: string;
  planLabel: string;
  reportSubtitle: string;
  subscriptionCode: string | null;
  status: string;
  displayEndDate: string | null;
  durationDays: number;
}

async function generatePdf(request: ReportRequest): Promise<Buffer> {
  const [{ customerName, dietitianName }, logs] = await Promise.all([
    repo.getReportHeaderInfo(request.customerProfileId),
    repo.getDietitianHealthLogsInWindow(
      request.customerProfileId,
      request.windowStart,
      request.windowEnd,
    ),
  ]);

  const entries: HealthReportLogEntry[] = logs.map((log) => ({
    logDate: log.logDate,
    parameters: log.parameters,
    customParameters: deserializeCustomParameters(log.customParameters),
    closingComment: log.closingComment,
  }));

  const reportData: HealthReportData = {
    customerName,
    planName: request.planName,
    planLabel: request.planLabel,
    reportSubtitle: request.reportSubtitle,
    subscriptionCode: request.subscriptionCode,
    dietitianName,
    durationDays: request.durationDays,
    startDate: request.windowStart,
    endDate: request.displayEndDate,
    status: request.status,
    generatedAtIst: formatGeneratedAtIst(new Date()),
    totalDietitianLogs: entries.length,
    trends: buildTrends(logs),
    entries,
  };

  const element = React.createElement(HealthReportDocument, {
    data: reportData,
  }) as React.ReactElement<DocumentProps>;
  const buffer = await renderToBuffer(element);
  return Buffer.from(buffer);
}

/** Extract the Weight, BP and Fasting Sugar trend series from date-ordered logs. */
function buildTrends(logs: readonly repo.DietitianHealthLogRow[]): HealthReportTrends {
  const weight: TrendPoint[] = [];
  const bp: BPTrendPoint[] = [];
  const fastingSugar: TrendPoint[] = [];

  for (const log of logs) {
    const params = log.parameters ?? {};

    const weightValue = readNumericParameter(params.weight);
    if (weightValue !== null) {
      weight.push({ date: log.logDate, value: weightValue });
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

  return { weight, bp, fastingSugar };
}

/** Reads a numeric `ParameterValue`'s value, or `null` when absent/non-numeric. */
function readNumericParameter(value: ParameterValue | undefined): number | null {
  if (!value) return null;
  if ("systolic" in value) return null;
  if (typeof value.value === "number") return value.value;
  return null;
}

/** Prefer the stored `total_days`; otherwise derive an inclusive day count from the window. */
function computeDurationDays(
  totalDays: number | null,
  startDate: string,
  endDate: string | null,
): number {
  if (totalDays && totalDays > 0) return totalDays;
  if (!endDate) return 0;
  const [sy, sm, sd] = startDate.split("-").map(Number);
  const [ey, em, ed] = endDate.split("-").map(Number);
  const start = Date.UTC(sy, sm - 1, sd);
  const end = Date.UTC(ey, em - 1, ed);
  const days = Math.round((end - start) / 86_400_000) + 1;
  return days > 0 ? days : 0;
}

/** Formats a generation instant as a display string in IST. */
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

// ---------------------------------------------------------------------------
// Internal — PDF rendering with timeout (mirrors KitReportService)
// ---------------------------------------------------------------------------

async function generateWithTimeout(request: ReportRequest): Promise<Buffer> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new ReportError("Report generation timed out.", 500));
    }, GENERATION_TIMEOUT_MS);
  });

  return Promise.race([generatePdf(request), timeoutPromise]);
}

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

/** Custom error for report generation with HTTP status code, mirrors `KitReportService`. */
export class ReportError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "ReportError";
    this.statusCode = statusCode;
  }
}
