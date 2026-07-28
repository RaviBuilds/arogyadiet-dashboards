"use server";

// src/actions/dietitian-actions/reportCardActions.ts
// Feature: dietitian-management — the `'use server'` boundary for the
// per-customer Report_Card (task 9.6).
//
// LAYERING: This module is a thin Server Action wrapper. It owns exactly two
// things `DietitianReportService` deliberately does not:
//   1. Resolving the acting Dietitian via `checkDietitianScope` — the
//      self-gating choke point for Req 5.8, 5.9 (every function below calls
//      it FIRST, before touching any customer data).
//   2. Restricting the Report_Card to `KIT` and `ACCOMMODATION`
//      Customer_Records (Req 19.1) — a `MEAL` customer's Customer_Category is
//      resolved via `cadenceRepository.getGoverningRecords` (the same lookup
//      `CadenceService`/the list actions use, so this action and the rest of
//      the feature always agree on which category governs a customer) and
//      rejected with an error result rather than a throw, before either
//      service function ever runs.
//
// Everything else — the parameter table, the trend series, the adherence
// summary, the Closing_Comment history, the PDF rendering and its 30-second
// timeout — is `DietitianReportService`'s responsibility, not this wrapper's
// (Req 19.2, 19.3, 19.4, 19.5, 19.6, 19.7, 19.8).
//
// PDF RETURN SHAPE: a Server Action's return value is serialized to the
// client, so it cannot hand back a raw `Buffer` the way the KIT report's
// Route Handler (`src/app/api/kit-report/[subscriptionId]/route.ts`) streams
// one directly as an HTTP response body. There is no existing Server Action
// in this codebase that exports a PDF — the KIT report is the only prior
// export and it uses a Route Handler, not a Server Action. Since task 9.6
// explicitly calls for a Server Action here, `exportReportCardPdf` base64-
// encodes the generated `Buffer` into the `ActionResult` data instead; the
// caller (`ReportCardView.tsx`) decodes it client-side and triggers the
// download the same way any other client-generated Blob download works.
//
// Portal-neutral: both the admin and franchise portals call this same module
// (design "Dietitian actions live in a new `src/actions/dietitian-actions/`
// folder"). It must never import from `src/app/admin` or `src/app/franchise`.
//
// Requirements: 19.1, 19.6, 19.7, 19.8

import { checkDietitianScope } from "@/lib/auth/adminAccess";
import { getGoverningRecords } from "@/repositories/dietitian/cadenceRepository";
import {
  generateReportCardPdf as generateReportCardPdfService,
  getReportCard as getReportCardService,
  type ReportCardViewModel,
} from "@/services/DietitianReportService";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ActionSuccess<T> = { success: true; data: T };
type ActionError = { success: false; error: string };
type ActionResult<T> = ActionSuccess<T> | ActionError;

/** Report_Card is offered only for these Customer_Categories (Req 19.1). */
const REPORT_CARD_CATEGORIES = new Set(["KIT", "ACCOMMODATION"]);

/** Returned when a Report_Card is requested for a `MEAL` Customer_Record (Req 19.1). */
const REPORT_CARD_NOT_AVAILABLE_FOR_CATEGORY =
  "Report Card is available only for KIT and Accommodation customers.";

/** The base64-encoded PDF payload returned by {@link exportReportCardPdf}. */
export interface ReportCardPdfExport {
  /** The generated PDF, base64-encoded, for client-side decoding into a downloadable Blob. */
  base64: string;
  /** Suggested download filename, mirroring the KIT report's `kit-report-{id}.pdf` convention. */
  filename: string;
}

// ---------------------------------------------------------------------------
// Internal — the Req 19.1 category gate shared by both actions
// ---------------------------------------------------------------------------

/**
 * Resolve the customer's governing Customer_Category and confirm it is
 * `KIT` or `ACCOMMODATION` (Req 19.1). A customer with no governing
 * subscription/stay row (an empty `getGoverningRecords` result) is treated
 * as not eligible rather than defaulting to `MEAL`, since the Report_Card
 * restriction must fail closed.
 */
async function assertReportCardEligible(
  customerProfileId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const governingRecords = await getGoverningRecords([customerProfileId]);
  const category = governingRecords.get(customerProfileId)?.category;

  if (!category || !REPORT_CARD_CATEGORIES.has(category)) {
    return { ok: false, error: REPORT_CARD_NOT_AVAILABLE_FOR_CATEGORY };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// 1. getReportCard — Req 5.8, 5.9, 19.1, 19.2, 19.3, 19.4, 19.5, 19.8
// ---------------------------------------------------------------------------

/**
 * Read the Report_Card view data for one Customer_Record (Req 19.2, 19.3,
 * 19.4, 19.5, 19.8): the date-ordered parameter table, the Weight/BP/Fasting
 * Sugar trend series, the adherence summary and the Closing_Comment history.
 *
 * `checkDietitianScope(customerProfileId)` runs first: an out-of-scope or
 * unauthenticated caller never reaches the category check or
 * `DietitianReportService` (Req 5.8, 5.9). The Customer_Category is then
 * confirmed to be `KIT` or `ACCOMMODATION` before the service assembles
 * anything (Req 19.1) — a `MEAL` customer is rejected with an error result,
 * not a thrown exception.
 */
export async function getReportCard(
  customerProfileId: string,
): Promise<ActionResult<ReportCardViewModel>> {
  const scope = await checkDietitianScope(customerProfileId);
  if (!scope.ok) {
    return { success: false, error: scope.error };
  }

  const eligible = await assertReportCardEligible(customerProfileId);
  if (!eligible.ok) {
    return { success: false, error: eligible.error };
  }

  try {
    const result = await getReportCardService(customerProfileId);
    if (!result.ok) {
      return { success: false, error: result.error };
    }
    return { success: true, data: result.report };
  } catch (err) {
    console.error("[reportCardActions] getReportCard error", err);
    return { success: false, error: "Failed to load the report card." };
  }
}

// ---------------------------------------------------------------------------
// 2. exportReportCardPdf — Req 5.8, 5.9, 19.1, 19.6, 19.7, 19.8
// ---------------------------------------------------------------------------

/**
 * Generate the Report_Card PDF export for one Customer_Record (Req 19.6,
 * 19.7) and return it base64-encoded (see the PDF RETURN SHAPE note at the
 * top of this file for why a Server Action cannot hand back a raw `Buffer`).
 *
 * Same self-gating as {@link getReportCard}: `checkDietitianScope` first,
 * then the `KIT`/`ACCOMMODATION` category gate (Req 19.1). A Customer_Record
 * with no Health_Log yields the `No health logs recorded yet` error
 * (Req 19.8) — `DietitianReportService.generateReportCardPdf` refuses to
 * generate a PDF for that case, and this wrapper propagates that error
 * rather than generating an empty document.
 */
export async function exportReportCardPdf(
  customerProfileId: string,
): Promise<ActionResult<ReportCardPdfExport>> {
  const scope = await checkDietitianScope(customerProfileId);
  if (!scope.ok) {
    return { success: false, error: scope.error };
  }

  const eligible = await assertReportCardEligible(customerProfileId);
  if (!eligible.ok) {
    return { success: false, error: eligible.error };
  }

  try {
    const result = await generateReportCardPdfService(customerProfileId);
    if (!result.ok) {
      return { success: false, error: result.error };
    }

    return {
      success: true,
      data: {
        base64: result.pdf.toString("base64"),
        filename: `report-card-${customerProfileId}.pdf`,
      },
    };
  } catch (err) {
    console.error("[reportCardActions] exportReportCardPdf error", err);
    return { success: false, error: "Failed to generate the report card PDF." };
  }
}
