// src/services/DietitianReportService.ts
// Feature: dietitian-management — DietitianReportService (task 7.17).
//
// Assembles the per-customer Report_Card (Requirement 19): the date-ordered
// parameter table, the Weight/BP/Fasting Sugar trend series, the adherence
// summary and the reverse-chronological Closing_Comment history, then renders
// `DietitianReportTemplate.tsx` with `@react-pdf/renderer` under a 30-second
// timeout.
//
// LAYERING: Business logic / orchestration only, mirroring `CadenceService`
// and `KitReportService`. No `'use server'` wrapper here — the Server Action
// wrapper lives in `src/actions/dietitian-actions/reportCardActions.ts`
// (task 9.6), which is also responsible for restricting this to `KIT` and
// `ACCOMMODATION` Customer_Records (Req 19.1) and for resolving
// `checkDietitianScope`. This module never reads `next/headers` or a session.
//
// `DietitianReportService` follows `KitReportService`: assemble the report
// data, then `renderToBuffer` under a timeout, then return the `Buffer`
// (design "Component Design" table; "PDF generation failures").
//
// Requirements: 19.2, 19.3, 19.4, 19.5, 19.6, 19.7, 19.8

import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import React from "react";

import { getISTDateString, istDateStringOf } from "@/lib/dates/ist";
import { NO_HEALTH_LOGS_RECORDED } from "@/lib/dietitian/messages";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCadenceForCustomer, type CadenceResult } from "@/services/CadenceService";
import {
  getHealthLogTimeline,
  getHealthLogTimelineForWindow,
  type TimelineRow,
} from "@/repositories/dietitian/healthLogRepository";
import {
  getKitSkippedDatesSince,
  getNonEligibleDatesSince,
} from "@/repositories/dietitian/cadenceRepository";
import { getReportCardById } from "@/repositories/dietitian/reportCardRepository";
import { slotDates } from "@/lib/dietitian/logSlots";
import { deserializeCustomParameters } from "@/lib/dietitian/customParameters";
import type { CustomerCategory, ParameterValue } from "@/types/dietitian";

import {
  DietitianReportDocument,
  type BPTrendPoint,
  type ClosingCommentEntry,
  type DietitianReportData,
  type ReportCardAdherenceSummary,
  type ReportCardParameterRow,
  type ReportCardTrends,
  type TrendPoint,
} from "./DietitianReportTemplate";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum time allowed for PDF generation before timeout (ms). Mirrors KitReportService. */
const GENERATION_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** The Report_Card view data — everything a UI needs to render Requirement 19.2–19.5. */
export interface ReportCardViewModel {
  customerName: string;
  customerCode: string | null;
  category: CustomerCategory;
  assignedDietitianName: string | null;
  parameterTable: ReportCardParameterRow[];
  trends: ReportCardTrends;
  adherence: ReportCardAdherenceSummary;
  closingComments: ClosingCommentEntry[];
  /** `false` when the Customer_Record has no Health_Log (Req 19.8). */
  hasHealthLogs: boolean;
}

/** The outcome of {@link getReportCard}. */
export type GetReportCardResult =
  | { ok: true; report: ReportCardViewModel }
  | { ok: false; error: string };

/** The outcome of {@link generateReportCardPdf}. */
export type GenerateReportCardPdfResult =
  | { ok: true; pdf: Buffer }
  | { ok: false; error: string };

/**
 * A Report_Card scoped to ONE subscription/stay period
 * (report-card-lifecycle Phase 4) — the "final report" a closed period shows.
 *
 * Same body as {@link ReportCardViewModel}, plus the period it covers and its
 * finalisation stamp. Every figure is derived from the period's own window, so a
 * finished period's report never shifts when a later period gains logs.
 */
export interface PeriodReportViewModel extends ReportCardViewModel {
  reportCardId: string;
  subjectType: "SUBSCRIPTION" | "STAY";
  windowStart: string;
  windowEnd: string;
  /** `CLOSED` reports are final; `ACTIVE` ones are a live preview. */
  status: "ACTIVE" | "CLOSED";
  /** The report-level Closing_Comment written at finalisation. */
  reportClosingComment: string | null;
  finalisedAt: string | null;
  reopenCount: number;
}

/** The outcome of {@link getPeriodReport}. */
export type GetPeriodReportResult =
  | { ok: true; report: PeriodReportViewModel }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Assemble the Report_Card view data for one Customer_Record (Req 19.2, 19.3,
 * 19.4, 19.5).
 *
 * Returns `hasHealthLogs: false` and the `No health logs recorded yet`
 * message when the customer has no Health_Log at all (Req 19.8) — the caller
 * (`ReportCardView.tsx` / the Server Action) uses that flag to disable the
 * PDF export rather than this function throwing.
 *
 * Req 19.2, 19.3, 19.4, 19.5, 19.8
 */
export async function getReportCard(
  customerProfileId: string,
): Promise<GetReportCardResult> {
  const customer = await getCustomerReportInfo(customerProfileId);
  if (!customer) {
    return { ok: false, error: "Customer not found." };
  }

  const [timeline, cadence] = await Promise.all([
    getHealthLogTimeline(customerProfileId),
    getCadenceForCustomer(customerProfileId),
  ]);

  const report = await assembleReportCard(customer, timeline, cadence);
  return { ok: true, report };
}

/**
 * Generate the Report_Card PDF export for one Customer_Record (Req 19.6,
 * 19.7), under a 30-second generation timeout mirroring `KitReportService`.
 *
 * Returns `{ ok: false }` with the `No health logs recorded yet` message
 * instead of generating a PDF when the customer has no Health_Log — the PDF
 * export stays disabled for that outcome (Req 19.8).
 *
 * Req 19.6, 19.7, 19.8
 */
export async function generateReportCardPdf(
  customerProfileId: string,
): Promise<GenerateReportCardPdfResult> {
  const customer = await getCustomerReportInfo(customerProfileId);
  if (!customer) {
    return { ok: false, error: "Customer not found." };
  }

  const [timeline, cadence] = await Promise.all([
    getHealthLogTimeline(customerProfileId),
    getCadenceForCustomer(customerProfileId),
  ]);

  if (timeline.length === 0) {
    return { ok: false, error: NO_HEALTH_LOGS_RECORDED };
  }

  const report = await assembleReportCard(customer, timeline, cadence);
  const generatedAtIst = formatGeneratedAtIst(new Date());

  const reportData: DietitianReportData = {
    customerName: report.customerName,
    customerCode: report.customerCode,
    category: report.category,
    assignedDietitianName: report.assignedDietitianName,
    generatedAtIst,
    parameterTable: report.parameterTable,
    trends: report.trends,
    adherence: report.adherence,
    closingComments: report.closingComments,
  };

  try {
    const pdf = await generateWithTimeout(reportData);
    return { ok: true, pdf };
  } catch (error) {
    if (error instanceof ReportError) {
      return { ok: false, error: error.message };
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Per-period report (report-card-lifecycle Phase 4)
// ---------------------------------------------------------------------------

/**
 * Assemble the final report for ONE Report_Card period.
 *
 * Everything is scoped to the report's own Logging_Window, so a closed period's
 * report is stable: adding logs to a LATER subscription can never change what a
 * finished report says. That is the whole difference from
 * {@link getReportCard}, which spans the customer's entire history.
 *
 * The adherence block is computed per-period rather than reusing
 * `CadenceService`'s customer-current snapshot, which describes only the
 * governing record and would mis-report a historical period:
 *   - Dietitian_Log / Self_Log counts — from the windowed timeline
 *   - Pending_Log_Count — the period's own unlogged slot count, so a CLOSED
 *     report always reports 0 (every slot logged is a precondition of closing)
 *   - Paused_Days / Skipped_Self_Logs — counted inside the window only
 *
 * Works for an ACTIVE report too, where it reads as a live preview of what
 * finalising would produce.
 */
export async function getPeriodReport(
  reportCardId: string,
): Promise<GetPeriodReportResult> {
  const card = await getReportCardById(reportCardId);
  if (!card) {
    return { ok: false, error: "Report not found." };
  }

  const customer = await getCustomerReportInfo(card.customerProfileId);
  if (!customer) {
    return { ok: false, error: "Customer not found." };
  }

  const [timeline, periodAdherence] = await Promise.all([
    getHealthLogTimelineForWindow(
      card.customerProfileId,
      card.windowStart,
      card.windowEnd,
    ),
    computePeriodAdherence(card),
  ]);

  const authorNames = await resolveAuthorNames(
    timeline.map((row) => row.author_user_id),
  );

  const parameterTable: ReportCardParameterRow[] = timeline.map((row) => ({
    logDate: row.log_date,
    authorType: row.author_type,
    authorName: row.author_user_id
      ? authorNames.get(row.author_user_id) ?? null
      : null,
    parameters: row.parameters ?? {},
    customParameters: deserializeCustomParameters(row.custom_parameters),
  }));

  let dietitianLogCount = 0;
  let selfLogCount = 0;
  for (const row of timeline) {
    if (row.author_type === "DIETITIAN") dietitianLogCount++;
    else selfLogCount++;
  }

  return {
    ok: true,
    report: {
      // The period's category wins over the customer's current one: a report for
      // an old KIT subscription must not relabel itself because the customer is
      // on a MEAL plan today.
      customerName: customer.customerName,
      customerCode: customer.customerCode,
      category: card.category,
      assignedDietitianName: customer.assignedDietitianName,
      parameterTable,
      trends: buildTrends(timeline),
      adherence: {
        dietitianLogCount,
        selfLogCount,
        pendingLogCount: periodAdherence.pendingLogCount,
        skippedSelfLogCount: periodAdherence.skippedSelfLogCount,
        pausedDaysCount: periodAdherence.pausedDaysCount,
      },
      closingComments: buildClosingCommentHistory(timeline, authorNames),
      hasHealthLogs: timeline.length > 0,

      reportCardId: card.id,
      subjectType: card.subjectType,
      windowStart: card.windowStart,
      windowEnd: card.windowEnd,
      status: card.status,
      reportClosingComment: card.reportClosingComment,
      finalisedAt: card.finalisedAt,
      reopenCount: card.reopenCount,
    },
  };
}

/**
 * The PDF of one period's final report, under the same 30-second timeout as the
 * customer-wide export.
 *
 * A period with no Health_Log produces no PDF — the same `hasHealthLogs` rule
 * Req 19.8 applies to the customer-wide report.
 */
export async function generatePeriodReportPdf(
  reportCardId: string,
): Promise<GenerateReportCardPdfResult> {
  const result = await getPeriodReport(reportCardId);
  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  const report = result.report;
  if (!report.hasHealthLogs) {
    return { ok: false, error: NO_HEALTH_LOGS_RECORDED };
  }

  const reportData: DietitianReportData = {
    customerName: report.customerName,
    customerCode: report.customerCode,
    category: report.category,
    assignedDietitianName: report.assignedDietitianName,
    generatedAtIst: formatGeneratedAtIst(new Date()),
    parameterTable: report.parameterTable,
    trends: report.trends,
    adherence: report.adherence,
    closingComments: report.closingComments,
  };

  try {
    const pdf = await generateWithTimeout(reportData);
    return { ok: true, pdf };
  } catch (error) {
    if (error instanceof ReportError) {
      return { ok: false, error: error.message };
    }
    throw error;
  }
}

/**
 * Adherence figures for one period, all bounded to its own window.
 *
 * `pendingLogCount` is the period's unlogged slot count, computed from the same
 * `slotDates` schedule the workspace uses, so it agrees with what the Dietitian
 * sees on screen.
 */
async function computePeriodAdherence(card: {
  customerProfileId: string;
  category: CustomerCategory;
  windowStart: string;
  windowEnd: string;
}): Promise<{
  pendingLogCount: number;
  pausedDaysCount: number;
  skippedSelfLogCount: number;
}> {
  const today = getISTDateString();

  const [nonEligibleByCustomer, skippedByCustomer] = await Promise.all([
    getNonEligibleDatesSince([card.customerProfileId], card.windowStart),
    getKitSkippedDatesSince([card.customerProfileId], card.windowStart),
  ]);

  const inWindow = (date: string) =>
    date >= card.windowStart && date <= card.windowEnd;

  const pausedDates = (
    nonEligibleByCustomer.get(card.customerProfileId) ?? []
  ).filter(inWindow);
  const skippedDates = (
    skippedByCustomer.get(card.customerProfileId) ?? []
  ).filter(inWindow);

  const dates = slotDates({
    category: card.category,
    windowStart: card.windowStart,
    windowEnd: card.windowEnd,
    today,
    pausedDates,
  });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("health_logs")
    .select("log_date")
    .eq("customer_profile_id", card.customerProfileId)
    .eq("author_type", "DIETITIAN")
    .gte("log_date", card.windowStart)
    .lte("log_date", card.windowEnd);

  if (error) {
    throw new Error(
      `Failed to count period logs for report ${card.windowStart}..${card.windowEnd}: ${error.message}`,
    );
  }

  const logged = new Set(
    ((data ?? []) as Array<{ log_date: string }>).map((row) => row.log_date),
  );

  return {
    pendingLogCount: dates.filter((date) => !logged.has(date)).length,
    pausedDaysCount: pausedDates.length,
    skippedSelfLogCount: skippedDates.length,
  };
}

// ---------------------------------------------------------------------------
// Internal — assembly
// ---------------------------------------------------------------------------

/** Minimal customer info needed for the Report_Card header (Req 19.7). */
interface CustomerReportInfo {
  customerName: string;
  customerCode: string | null;
  category: CustomerCategory;
  assignedDietitianName: string | null;
}

/**
 * Resolve the customer's name, code, Customer_Category and assigned
 * Dietitian name for the Report_Card header (Req 19.7).
 *
 * The Customer_Category is read from the customer's most recently created
 * subscription row, mirroring `cadenceRepository.getGoverningRecords` — the
 * Report_Card and the Cadence_Engine must agree on which category governs a
 * customer.
 */
async function getCustomerReportInfo(
  customerProfileId: string,
): Promise<CustomerReportInfo | null> {
  const admin = createAdminClient();

  const { data: profile, error: profileError } = await admin
    .from("customer_profiles")
    .select("id, customer_code, dietitian_id, users!customer_profiles_user_id_fkey(full_name)")
    .eq("id", customerProfileId)
    .maybeSingle();

  if (profileError) {
    throw new Error(
      `Failed to load customer profile ${customerProfileId}: ${profileError.message}`,
    );
  }
  if (!profile) return null;

  const usersEmbed = (profile as { users: { full_name: string | null } | { full_name: string | null }[] | null })
    .users;
  const user = Array.isArray(usersEmbed) ? usersEmbed[0] : usersEmbed;
  const customerName = user?.full_name?.trim() || "Customer";
  const customerCode = (profile as { customer_code: string | null }).customer_code ?? null;
  const dietitianId = (profile as { dietitian_id: string | null }).dietitian_id;

  const [category, assignedDietitianName] = await Promise.all([
    resolveGoverningCategory(admin, customerProfileId),
    resolveDietitianName(admin, dietitianId),
  ]);

  return { customerName, customerCode, category, assignedDietitianName };
}

/** Resolve the customer's most recently created subscription's category. */
async function resolveGoverningCategory(
  admin: ReturnType<typeof createAdminClient>,
  customerProfileId: string,
): Promise<CustomerCategory> {
  const { data, error } = await admin
    .from("subscriptions")
    .select("customer_category, created_at")
    .eq("customer_profile_id", customerProfileId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to resolve governing category for customer ${customerProfileId}: ${error.message}`,
    );
  }

  const category = (data as { customer_category: string } | null)?.customer_category;
  return category === "ACCOMMODATION" || category === "KIT" || category === "MEAL"
    ? category
    : "MEAL";
}

/** Resolve the assigned Dietitian's name, or `null` when unlinked. */
async function resolveDietitianName(
  admin: ReturnType<typeof createAdminClient>,
  dietitianId: string | null,
): Promise<string | null> {
  if (!dietitianId) return null;

  const { data, error } = await admin
    .from("users")
    .select("full_name")
    .eq("id", dietitianId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to resolve dietitian name ${dietitianId}: ${error.message}`);
  }

  return (data as { full_name: string | null } | null)?.full_name?.trim() || null;
}

/**
 * Build the full Report_Card view model from the customer's Health_Log
 * timeline and cadence snapshot.
 *
 * The timeline is already ordered ascending by `log_date` then `submitted_at`
 * (oldest first) per `getHealthLogTimeline`'s contract, so:
 * - the parameter table (Req 19.2) uses it as-is (date order)
 * - the trend series (Req 19.3) walks it once, in the same order
 * - the Closing_Comment history (Req 19.5) reverses it (newest first)
 */
async function assembleReportCard(
  customer: CustomerReportInfo,
  timeline: readonly TimelineRow[],
  cadence: CadenceResult,
): Promise<ReportCardViewModel> {
  const authorNames = await resolveAuthorNames(timeline.map((row) => row.author_user_id));

  const parameterTable: ReportCardParameterRow[] = timeline.map((row) => ({
    logDate: row.log_date,
    authorType: row.author_type,
    authorName: row.author_user_id ? authorNames.get(row.author_user_id) ?? null : null,
    parameters: row.parameters ?? {},
    customParameters: deserializeCustomParameters(row.custom_parameters),
  }));

  const trends = buildTrends(timeline);
  const adherence = buildAdherenceSummary(timeline, cadence);
  const closingComments = buildClosingCommentHistory(timeline, authorNames);

  return {
    customerName: customer.customerName,
    customerCode: customer.customerCode,
    category: customer.category,
    assignedDietitianName: customer.assignedDietitianName,
    parameterTable,
    trends,
    adherence,
    closingComments,
    hasHealthLogs: timeline.length > 0,
  };
}

/**
 * Resolve author display names for a batch of `author_user_id`s in one query
 * (Req 19.5, 13.5) — the parameter table and the Closing_Comment history both
 * need the author name beside each entry. A `null`/legacy row (no
 * `author_user_id`, e.g. a `kit_daily_logs` Self_Log) resolves to `null`
 * rather than triggering a lookup.
 */
async function resolveAuthorNames(
  authorUserIds: readonly (string | null)[],
): Promise<Map<string, string>> {
  const distinct = Array.from(new Set(authorUserIds.filter((id): id is string => id !== null)));
  if (distinct.length === 0) return new Map();

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("users")
    .select("id, full_name")
    .in("id", distinct);

  if (error) {
    throw new Error(`Failed to resolve author names: ${error.message}`);
  }

  const map = new Map<string, string>();
  for (const row of (data ?? []) as Array<{ id: string; full_name: string | null }>) {
    if (row.full_name) map.set(row.id, row.full_name);
  }
  return map;
}

/**
 * Extract the Weight, BP and Fasting Sugar trend series (Req 19.3).
 *
 * `timeline` is already date-ordered ascending, so each series is built in a
 * single pass with no re-sort. A log date with no value for a given
 * parameter contributes no point to that parameter's series — the series
 * contains exactly the dated values recorded for that parameter (design
 * Property 32).
 */
function buildTrends(timeline: readonly TimelineRow[]): ReportCardTrends {
  const weight: TrendPoint[] = [];
  const bp: BPTrendPoint[] = [];
  const fastingSugar: TrendPoint[] = [];

  for (const row of timeline) {
    const params = row.parameters ?? {};

    const weightValue = readNumericParameter(params.weight);
    if (weightValue !== null) {
      weight.push({ date: row.log_date, value: weightValue });
    }

    const bpValue = params.bp as ParameterValue | undefined;
    if (bpValue && "systolic" in bpValue) {
      bp.push({ date: row.log_date, systolic: bpValue.systolic, diastolic: bpValue.diastolic });
    }

    const sugarValue = readNumericParameter(params.fasting_sugar);
    if (sugarValue !== null) {
      fastingSugar.push({ date: row.log_date, value: sugarValue });
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

/**
 * Build the adherence summary (Req 19.4): the count of Dietitian_Logs
 * recorded, Pending_Log_Count, the count of Self_Logs recorded, the count of
 * Skipped_Self_Logs and Paused_Days_Count.
 *
 * The Dietitian_Log and Self_Log counts are derived directly from the
 * Health_Log timeline (every Dietitian_Log lives in `health_logs`, every
 * Self_Log source is folded into the same view); Pending_Log_Count,
 * Skipped_Self_Log count and Paused_Days_Count come from `CadenceService` —
 * the single place those numbers are computed for every surface (design
 * "Cadence flow").
 */
function buildAdherenceSummary(
  timeline: readonly TimelineRow[],
  cadence: CadenceResult,
): ReportCardAdherenceSummary {
  let dietitianLogCount = 0;
  let selfLogCount = 0;
  for (const row of timeline) {
    if (row.author_type === "DIETITIAN") dietitianLogCount++;
    else selfLogCount++;
  }

  return {
    dietitianLogCount,
    pendingLogCount: cadence.pendingLogCount,
    selfLogCount,
    skippedSelfLogCount: cadence.skippedSelfLogCount,
    pausedDaysCount: cadence.pausedDaysCount,
  };
}

/**
 * Build the reverse-chronological Closing_Comment history (Req 19.5).
 *
 * `timeline` is ascending; reversing it yields newest-first without a
 * re-sort. Rows with no Closing_Comment (legacy Self_Log sources) contribute
 * no entry.
 */
function buildClosingCommentHistory(
  timeline: readonly TimelineRow[],
  authorNames: ReadonlyMap<string, string>,
): ClosingCommentEntry[] {
  const entries: ClosingCommentEntry[] = [];
  for (const row of timeline) {
    const comment = row.closing_comment?.trim();
    if (!comment) continue;
    entries.push({
      logDate: row.log_date,
      comment,
      authorName: row.author_user_id ? authorNames.get(row.author_user_id) ?? null : null,
      submittedAt: row.submitted_at,
    });
  }
  return entries.reverse();
}

/** Formats a generation instant as a display string in IST (Req 19.7). */
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

/**
 * Generate the PDF with a 30-second timeout.
 * Throws ReportError if generation exceeds the timeout.
 */
async function generateWithTimeout(data: DietitianReportData): Promise<Buffer> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new ReportError("Report generation timed out.", 500));
    }, GENERATION_TIMEOUT_MS);
  });

  const generationPromise = generatePdf(data);

  return Promise.race([generationPromise, timeoutPromise]);
}

/** Render `DietitianReportDocument` to a Buffer via `@react-pdf/renderer`. */
async function generatePdf(data: DietitianReportData): Promise<Buffer> {
  const element = React.createElement(DietitianReportDocument, { data }) as React.ReactElement<DocumentProps>;
  const buffer = await renderToBuffer(element);
  return Buffer.from(buffer);
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

// Re-exported so callers building the "today" IST date for display alongside
// the report never need a second import for something this module already
// pulls in.
export { getISTDateString };
