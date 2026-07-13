"use server";

/**
 * Server actions for the "Fallback Automations" panel in Operations →
 * Automation Logs. These let an admin manually re-trigger any cron job that
 * doesn't already have a dedicated System Automation Control card (i.e.
 * everything except Order Creation, Product Linking, and Routing & Batching).
 *
 * Each action delegates to FallbackAutomationService with source="manual" so
 * the resulting automation_logs row records it as an admin-triggered run,
 * distinct from the scheduled Supabase pg_cron run for the same automation
 * type + date.
 *
 * auto-off-duty (the 5-minute rider sweep) is intentionally excluded — it
 * runs far too frequently for a manual "re-run" button to be meaningful.
 */

import { revalidatePath } from "next/cache";
import { checkGroupManage } from "@/lib/auth/adminAccess";
import { logAdminAction } from "@/lib/logger";
import {
  runSubscriptionActivation,
  runKitExpiration,
  runDispatchImageCleanup,
  runStayTransitions,
  runPurchaseOrderCleanup,
} from "@/services/FallbackAutomationService";

export type FallbackAutomationKey =
  | "SUB_ACTIVATE"
  | "KIT_EXPIRE"
  | "IMG_CLEANUP"
  | "STAY_TRANSITION"
  | "PO_CLEANUP";

export type FallbackAutomationResult =
  | { success: true; summary: string }
  | { success: false; error: string };

export async function runFallbackAutomation(
  key: FallbackAutomationKey,
): Promise<FallbackAutomationResult> {
  const gate = await checkGroupManage("operations");
  if (!gate.ok) return { success: false, error: gate.error };

  try {
    let summary = "";

    switch (key) {
      case "SUB_ACTIVATE": {
        const r = await runSubscriptionActivation("manual");
        summary = `${r.activated} subscription(s) activated, ${r.stopped} expired.`;
        break;
      }
      case "KIT_EXPIRE": {
        const r = await runKitExpiration("manual");
        summary = `${r.expired} KIT subscription(s) expired.`;
        break;
      }
      case "IMG_CLEANUP": {
        const r = await runDispatchImageCleanup("manual");
        summary = `${r.imagesDeleted} image(s) deleted from ${r.transfersProcessed} transfer(s).`;
        break;
      }
      case "STAY_TRANSITION": {
        const r = await runStayTransitions("manual");
        summary = `${r.activated} stay(s) activated, ${r.finished} finished.`;
        break;
      }
      case "PO_CLEANUP": {
        const r = await runPurchaseOrderCleanup("manual");
        summary = `${r.filesDeleted} PO file(s) deleted from ${r.lotsProcessed} lot(s).`;
        break;
      }
      default:
        return { success: false, error: "Unknown fallback automation." };
    }

    await logAdminAction("UPDATE", "system_automation", key, {
      executed_action: "runFallbackAutomation",
      source: "manual",
      summary,
    });

    revalidatePath("/admin/operations");
    return { success: true, summary };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "An unexpected server error occurred.";
    console.error(`[runFallbackAutomation] ${key} failed:`, error);
    return { success: false, error: message };
  }
}
