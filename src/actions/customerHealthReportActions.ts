"use server";

// src/actions/customerHealthReportActions.ts
//
// The customer-facing read of their own Health Report.
//
// Dietitian_Logs live in `public.health_logs`, keyed only by
// (customer_profile_id, log_date) — there is no stay_id column — so the report
// is scoped to a stay by date window, exactly the way the PDF report does it
// (see `HealthReportService.generateStayHealthReport`). That keeps the on-screen
// day cards and the downloaded PDF showing the same set of days.
//
// Self_Logs (author_type = 'CUSTOMER') are deliberately excluded: the Health
// Report surfaces only what the wellness team recorded.

import { differenceInCalendarDays, parseISO } from "date-fns";

import { getCustomerSession } from "@/lib/customer/get-session";
import {
  getDietitianHealthLogsInWindow,
  getDietitianLogDates,
  getReportHeaderInfo,
} from "@/repositories/healthReportRepository";
import * as stayRepository from "@/repositories/stayRepository";
import * as AccommodationService from "@/services/AccommodationService";
import type { CustomParameter, ParameterValue } from "@/types/dietitian";

// ---------------------------------------------------------------------------
// View model
// ---------------------------------------------------------------------------

/** One day of the report — a single Dietitian_Log. */
export interface HealthReportDay {
  id: string;
  /** IST calendar date the log applies to, `YYYY-MM-DD`. */
  logDate: string;
  /** 1-based day of the stay, or `null` when the date falls outside it. */
  dayNumber: number | null;
  /** Sparse map keyed by `FieldDefinition.key` — an absent key means no value. */
  parameters: Record<string, ParameterValue>;
  customParameters: CustomParameter[];
  closingComment: string | null;
  /** Submission timestamp, ISO 8601. */
  submittedAt: string;
}

/** The stay the report is scoped to. */
export interface HealthReportStay {
  id: string;
  startDate: string;
  /** Inclusive last day of the stay. */
  endDate: string;
  totalNights: number;
  stayType: string;
  occupancyType: string;
  status: string;
  /** `false` when falling back to the most recent completed stay. */
  isActive: boolean;
}

/** Everything the Health Report page renders. */
export interface CustomerHealthReportData {
  stay: HealthReportStay;
  /** Assigned dietitian's name, for the "recorded by" line. */
  dietitianName: string | null;
  /** Chronological, oldest first. */
  days: HealthReportDay[];
}

export type CustomerHealthReportResult =
  | { success: true; data: CustomerHealthReportData }
  | { success: true; data: null } // authenticated, but no stay on record
  | { error: string };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalize the `custom_parameters` JSONB column (typed `unknown` at the
 * repository boundary) into the label/value/unit triples the UI renders.
 * Anything that does not match the shape is dropped rather than thrown on.
 */
function normalizeCustomParameters(raw: unknown): CustomParameter[] {
  if (!Array.isArray(raw)) return [];

  return raw.flatMap((entry): CustomParameter[] => {
    if (typeof entry !== "object" || entry === null) return [];
    const candidate = entry as Record<string, unknown>;
    const label = typeof candidate.label === "string" ? candidate.label.trim() : "";
    const value = typeof candidate.value === "string" ? candidate.value.trim() : "";
    if (!label || !value) return [];
    return [
      {
        label,
        value,
        unit: typeof candidate.unit === "string" ? candidate.unit.trim() : "",
      },
    ];
  });
}

/** 1-based day of the stay for a log date, or `null` when outside the stay. */
function resolveDayNumber(logDate: string, startDate: string, totalNights: number): number | null {
  const offset = differenceInCalendarDays(parseISO(logDate), parseISO(startDate));
  if (offset < 0 || offset > totalNights - 1) return null;
  return offset + 1;
}

/**
 * The stay the report should show: the ACTIVE stay, else the most recent
 * FINISHED/EXPIRED one (the report stays readable after checkout).
 * `getStayHistory` already orders most-recent-first.
 */
async function pickStay(customerProfileId: string): Promise<{
  row: stayRepository.StayEntryRow;
  isActive: boolean;
} | null> {
  const active = await stayRepository.getActiveStay(customerProfileId);
  if (active) return { row: active, isActive: true };

  const past = await stayRepository.getStayHistory(customerProfileId);
  return past.length > 0 ? { row: past[0], isActive: false } : null;
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

/**
 * Read the authenticated customer's own Health Report.
 *
 * Self-scoped: the customer profile comes from the session, never from an
 * argument, so this action cannot be used to read another customer's logs.
 */
export async function getCustomerHealthReportAction(): Promise<CustomerHealthReportResult> {
  const { user, customerProfileId, error } = await getCustomerSession();

  if (error || !user) {
    return { error: "Your session has expired. Please sign in again." };
  }
  if (!customerProfileId) {
    return { error: "Unable to load your customer profile. Please try again." };
  }

  try {
    const picked = await pickStay(customerProfileId);

    if (!picked) {
      return { success: true, data: null };
    }

    const { row, isActive } = picked;
    const startDate = row.start_date;
    const endDate = AccommodationService.computeEndDate(startDate, row.total_nights);

    const [logs, header] = await Promise.all([
      getDietitianHealthLogsInWindow(customerProfileId, startDate, endDate),
      getReportHeaderInfo(customerProfileId),
    ]);

    return {
      success: true,
      data: {
        stay: {
          id: row.id,
          startDate,
          endDate,
          totalNights: row.total_nights,
          stayType: row.stay_type,
          occupancyType: row.occupancy_type,
          status: row.status,
          isActive,
        },
        dietitianName: header.dietitianName,
        days: logs.map((log) => ({
          id: log.id,
          logDate: log.logDate,
          dayNumber: resolveDayNumber(log.logDate, startDate, row.total_nights),
          parameters: log.parameters,
          customParameters: normalizeCustomParameters(log.customParameters),
          closingComment: log.closingComment,
          submittedAt: log.submittedAt,
        })),
      },
    };
  } catch (err) {
    console.error("[customerHealthReportActions] getCustomerHealthReportAction", err);
    return { error: "Failed to load your health report. Please try again." };
  }
}

// ---------------------------------------------------------------------------
// Per-stay recorded-day counts (stay history list)
// ---------------------------------------------------------------------------

/** How many days of readings sit behind each stay, keyed by stay id. */
export type StayRecordedDayCounts = Record<string, number>;

export type StayRecordedDaysResult =
  | { success: true; data: StayRecordedDayCounts }
  | { error: string };

/**
 * Count the days of Dietitian-recorded readings inside each of the customer's
 * stay windows, so the stay history list can offer a Health Report download only
 * where there is something to report (and say so where there isn't).
 *
 * One read of the customer's log dates plus one read of their stays; the bucketing
 * is done here rather than with a query per stay.
 *
 * Self-scoped: the customer profile comes from the session, never an argument.
 */
export async function getStayRecordedDayCountsAction(): Promise<StayRecordedDaysResult> {
  const { user, customerProfileId, error } = await getCustomerSession();

  if (error || !user) {
    return { error: "Your session has expired. Please sign in again." };
  }
  if (!customerProfileId) {
    return { error: "Unable to load your customer profile. Please try again." };
  }

  try {
    const [logDates, history, active] = await Promise.all([
      getDietitianLogDates(customerProfileId),
      stayRepository.getStayHistory(customerProfileId),
      stayRepository.getActiveStay(customerProfileId),
    ]);

    const stays = active ? [active, ...history] : history;
    const counts: StayRecordedDayCounts = {};

    for (const stay of stays) {
      const endDate = AccommodationService.computeEndDate(
        stay.start_date,
        stay.total_nights,
      );
      counts[stay.id] = logDates.filter(
        (date) => date >= stay.start_date && date <= endDate,
      ).length;
    }

    return { success: true, data: counts };
  } catch (err) {
    console.error("[customerHealthReportActions] getStayRecordedDayCountsAction", err);
    return { error: "Failed to load your health report availability." };
  }
}
