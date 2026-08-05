"use server";

// src/actions/dietitian-actions/reportCardLifecycleActions.ts
// Feature: report-card-lifecycle — Phase 2 (read path).
//
// Server Actions for the per-subscription / per-stay Report_Card history and
// the per-report slot view.
//
// LAYERING: Action layer ONLY. Every export gates on
// `checkDietitianScope(customerProfileId)` first, exactly like
// `reportCardActions.ts`, so an out-of-scope or unauthenticated caller never
// reaches `ReportCardService`. All business logic lives in the service; all
// data access in the repositories.
//
// NOTE ON CATEGORY: unlike `reportCardActions.ts`, these actions are NOT
// restricted to KIT / ACCOMMODATION. The Report_Card lifecycle applies to all
// three Customer_Categories — a MEAL customer's subscriptions each get a
// closable report too, which is the point of the feature. The Req 19.1
// restriction stays where it is, on the legacy customer-wide Report_Card PDF.
//
// A report card is addressed by its own id, so `getReportCardDetailAction`
// resolves the owning customer BEFORE scope-checking: the scope check must run
// against the customer, and an id belonging to someone out of scope must be
// indistinguishable from one that does not exist.

import { revalidatePath } from "next/cache";

import { checkDietitianScope } from "@/lib/auth/adminAccess";
import type { LogSlot } from "@/lib/dietitian/logSlots";
import { getReportCardById } from "@/repositories/dietitian/reportCardRepository";
import {
  finaliseReport as finaliseReportService,
  getReportCardDetail as getReportCardDetailService,
  getReportCardHistory as getReportCardHistoryService,
  reopenReport as reopenReportService,
  type ReportCardHistory,
} from "@/services/ReportCardService";
import {
  generatePeriodReportPdf as generatePeriodReportPdfService,
  getPeriodReport as getPeriodReportService,
  type PeriodReportViewModel,
} from "@/services/DietitianReportService";
import type {
  ReportCardProgress,
  ReportCardWithEditability,
} from "@/types/dietitian";

/**
 * The client-facing projection of one Report_Card.
 *
 * `ReportCardService.ReportCardDetail` also carries the raw `TimelineRow[]` the
 * final report will render (Phase 4). That is a repository type, so it is
 * dropped here rather than handed across the client boundary.
 */
export interface ReportCardDetailView extends ReportCardProgress {
  reportCard: ReportCardWithEditability;
  slots: LogSlot[];
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ActionSuccess<T> = { success: true; data: T };
type ActionError = { success: false; error: string };
type ActionResult<T> = ActionSuccess<T> | ActionError;

/** Returned for an unknown report card id, and for one outside the caller's scope. */
const REPORT_CARD_NOT_FOUND = "Report not found.";

// ---------------------------------------------------------------------------
// 1. getReportCardHistoryAction
// ---------------------------------------------------------------------------

/**
 * Every Report_Card for a Customer_Record — one per MEAL/KIT subscription and
 * per accommodation stay — newest period first, each with its lock flags and
 * slot-completion progress.
 *
 * This is the list behind the "all subscriptions / stays" panel: it includes
 * reports whose slots are still unfinished, which is how a Dietitian returns to
 * an older subscription after a new one has already started.
 */
export async function getReportCardHistoryAction(
  customerProfileId: string,
): Promise<ActionResult<ReportCardHistory>> {
  const scope = await checkDietitianScope(customerProfileId);
  if (!scope.ok) {
    return { success: false, error: scope.error };
  }

  try {
    const history = await getReportCardHistoryService(
      customerProfileId,
      scope.ctx.userId,
    );
    return { success: true, data: history };
  } catch (err) {
    console.error(
      "[reportCardLifecycleActions] getReportCardHistoryAction error",
      err,
    );
    return { success: false, error: "Failed to load the report history." };
  }
}

// ---------------------------------------------------------------------------
// 2. getReportCardDetailAction
// ---------------------------------------------------------------------------

/**
 * The slot schedule and full log timeline for ONE Report_Card.
 *
 * Ownership is resolved before the scope check, and BOTH an unknown id and an
 * out-of-scope id return the same `REPORT_CARD_NOT_FOUND` message — a Dietitian
 * must not be able to probe for the existence of another Dietitian's customers
 * by id.
 */
export async function getReportCardDetailAction(
  reportCardId: string,
): Promise<ActionResult<ReportCardDetailView>> {
  try {
    const card = await getReportCardById(reportCardId);
    if (!card) {
      return { success: false, error: REPORT_CARD_NOT_FOUND };
    }

    const scope = await checkDietitianScope(card.customerProfileId);
    if (!scope.ok) {
      // Deliberately the not-found message, not scope.error — see the doc above.
      return { success: false, error: REPORT_CARD_NOT_FOUND };
    }

    const detail = await getReportCardDetailService(
      reportCardId,
      scope.ctx.userId,
    );
    if (!detail) {
      return { success: false, error: REPORT_CARD_NOT_FOUND };
    }

    // Project away the repository-owned `timeline` before crossing to a client.
    return {
      success: true,
      data: {
        reportCard: detail.reportCard,
        slots: detail.slots,
        totalSlots: detail.totalSlots,
        loggedSlots: detail.loggedSlots,
        isComplete: detail.isComplete,
      },
    };
  } catch (err) {
    console.error(
      "[reportCardLifecycleActions] getReportCardDetailAction error",
      err,
    );
    return { success: false, error: "Failed to load the report." };
  }
}

// ---------------------------------------------------------------------------
// 3. finaliseReportAction
// ---------------------------------------------------------------------------

/**
 * Close a Report_Card with its report-level Closing_Comment. Its Log_Slots
 * become read-only, and it becomes the customer's one reopenable report — which
 * simultaneously locks the previously-reopenable one for good.
 *
 * Every precondition (ACTIVE, comment present, all slots logged) is enforced in
 * `ReportCardService`, which returns rejections rather than throwing so they
 * surface as form errors.
 *
 * Scope is resolved from the report's own customer, and an out-of-scope id gets
 * the not-found message — same reasoning as `getReportCardDetailAction`.
 */
export async function finaliseReportAction(
  reportCardId: string,
  closingComment: string,
): Promise<ActionResult<ReportCardWithEditability>> {
  try {
    const card = await getReportCardById(reportCardId);
    if (!card) {
      return { success: false, error: REPORT_CARD_NOT_FOUND };
    }

    const scope = await checkDietitianScope(card.customerProfileId);
    if (!scope.ok) {
      return { success: false, error: REPORT_CARD_NOT_FOUND };
    }

    const result = await finaliseReportService(
      reportCardId,
      closingComment,
      scope.ctx.userId,
    );
    if (!result.ok) {
      return { success: false, error: result.error };
    }

    revalidatePath("/log-customer");
    return { success: true, data: result.reportCard };
  } catch (err) {
    console.error(
      "[reportCardLifecycleActions] finaliseReportAction error",
      err,
    );
    return { success: false, error: "Failed to finalise the report." };
  }
}

// ---------------------------------------------------------------------------
// 4. reopenReportAction
// ---------------------------------------------------------------------------

/**
 * Reopen the customer's most recently closed Report_Card so its logs can be
 * amended and re-closed.
 *
 * Only that one report is reopenable; every older closed report is permanently
 * locked. The rule is read from `v_report_card_editability` in the service, not
 * re-derived here.
 */
export async function reopenReportAction(
  reportCardId: string,
): Promise<ActionResult<ReportCardWithEditability>> {
  try {
    const card = await getReportCardById(reportCardId);
    if (!card) {
      return { success: false, error: REPORT_CARD_NOT_FOUND };
    }

    const scope = await checkDietitianScope(card.customerProfileId);
    if (!scope.ok) {
      return { success: false, error: REPORT_CARD_NOT_FOUND };
    }

    const result = await reopenReportService(reportCardId, scope.ctx.userId);
    if (!result.ok) {
      return { success: false, error: result.error };
    }

    revalidatePath("/log-customer");
    return { success: true, data: result.reportCard };
  } catch (err) {
    console.error("[reportCardLifecycleActions] reopenReportAction error", err);
    return { success: false, error: "Failed to reopen the report." };
  }
}

// ---------------------------------------------------------------------------
// 5. getPeriodReportAction
// ---------------------------------------------------------------------------

/**
 * The final report for one period: the parameter table, trends, per-period
 * adherence and Closing_Comment history, all bounded to that Report_Card's
 * Logging_Window.
 *
 * Available for an ACTIVE report too, where it reads as a preview of what
 * finalising would produce.
 */
export async function getPeriodReportAction(
  reportCardId: string,
): Promise<ActionResult<PeriodReportViewModel>> {
  try {
    const card = await getReportCardById(reportCardId);
    if (!card) {
      return { success: false, error: REPORT_CARD_NOT_FOUND };
    }

    const scope = await checkDietitianScope(card.customerProfileId);
    if (!scope.ok) {
      return { success: false, error: REPORT_CARD_NOT_FOUND };
    }

    const result = await getPeriodReportService(reportCardId);
    if (!result.ok) {
      return { success: false, error: result.error };
    }

    return { success: true, data: result.report };
  } catch (err) {
    console.error(
      "[reportCardLifecycleActions] getPeriodReportAction error",
      err,
    );
    return { success: false, error: "Failed to load the report." };
  }
}

// ---------------------------------------------------------------------------
// 6. exportPeriodReportPdfAction
// ---------------------------------------------------------------------------

/**
 * The period report as a base64 PDF, for client-side decoding into a download.
 * Mirrors `reportCardActions.exportReportCardPdf`'s transport shape.
 *
 * The filename carries the period so a customer's several reports do not
 * overwrite each other on disk.
 */
export async function exportPeriodReportPdfAction(
  reportCardId: string,
): Promise<ActionResult<{ base64: string; filename: string }>> {
  try {
    const card = await getReportCardById(reportCardId);
    if (!card) {
      return { success: false, error: REPORT_CARD_NOT_FOUND };
    }

    const scope = await checkDietitianScope(card.customerProfileId);
    if (!scope.ok) {
      return { success: false, error: REPORT_CARD_NOT_FOUND };
    }

    const result = await generatePeriodReportPdfService(reportCardId);
    if (!result.ok) {
      return { success: false, error: result.error };
    }

    return {
      success: true,
      data: {
        base64: result.pdf.toString("base64"),
        filename: `report-${card.windowStart}-to-${card.windowEnd}.pdf`,
      },
    };
  } catch (err) {
    console.error(
      "[reportCardLifecycleActions] exportPeriodReportPdfAction error",
      err,
    );
    return { success: false, error: "Failed to generate the report PDF." };
  }
}
