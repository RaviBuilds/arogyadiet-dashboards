import { NextResponse } from "next/server";
import { runPurchaseOrderCleanup } from "@/services/FallbackAutomationService";

/**
 * GET /api/cron/cleanup-old-po?secret=<CRON_SECRET>
 *
 * Scheduled monthly (1st of each month at 4:00 AM IST) via Supabase pg_cron.
 * Cleans up purchase order files from inventory_lots that are older than 3 months.
 * Deletes the file from Supabase storage and nullifies the purchase_order_path column.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const secret = searchParams.get("secret");
  const expectedSecret = process.env.CRON_SECRET;

  if (!expectedSecret || secret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runPurchaseOrderCleanup("cron");
    return NextResponse.json({
      success: true,
      message: `Cleaned up ${result.filesDeleted} PO files from ${result.lotsProcessed} lots.`,
      processed: result.lotsProcessed,
      filesDeleted: result.filesDeleted,
    });
  } catch (error: any) {
    console.error("PO Cleanup Cron Error:", error);
    return NextResponse.json(
      { success: false, error: error?.message || "Internal Server Error" },
      { status: 500 },
    );
  }
}
