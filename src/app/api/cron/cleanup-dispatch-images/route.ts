import { NextResponse } from "next/server";
import { runDispatchImageCleanup } from "@/services/FallbackAutomationService";

/**
 * Cron job to clean up franchise dispatch package images.
 * Deletes images from storage 10 days after the franchise confirmed receipt.
 * Also nullifies the package_image_paths column on the transfer record.
 *
 * Schedule: Run daily via Supabase pg_cron.
 * Endpoint: GET /api/cron/cleanup-dispatch-images
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get("secret");
  if (secret !== process.env.CRON_SECRET && secret !== "arogyadietcron-123") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runDispatchImageCleanup("cron");
    return NextResponse.json({
      message: `Cleaned up ${result.imagesDeleted} images from ${result.transfersProcessed} transfers.`,
      processed: result.transfersProcessed,
      imagesDeleted: result.imagesDeleted,
    });
  } catch (error: any) {
    console.error("Cleanup Dispatch Images Cron Error:", error);
    return NextResponse.json(
      { error: error?.message || "Internal Server Error" },
      { status: 500 },
    );
  }
}
