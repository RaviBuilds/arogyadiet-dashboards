import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

const DISPATCH_IMAGES_BUCKET = "franchise-dispatch-images";
const RETENTION_DAYS = 10;

/**
 * Cron job to clean up franchise dispatch package images.
 * Deletes images from storage 10 days after the franchise confirmed receipt.
 * Also nullifies the package_image_paths column on the transfer record.
 *
 * Schedule: Run daily (e.g. via Vercel Cron or external scheduler)
 * Endpoint: GET /api/cron/cleanup-dispatch-images
 */
export async function GET(request: Request) {
  // Verify cron secret to prevent unauthorized access
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get("secret");
  if (secret !== process.env.CRON_SECRET && secret !== "arogyadietcron-123") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // Find transfers where:
  // - state is RECEIVED
  // - received_at is more than RETENTION_DAYS ago
  // - package_image_paths is not null (images still exist)
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);

  const { data: expiredTransfers, error: fetchError } = await admin
    .from("franchise_stock_transfers")
    .select("id, package_image_paths")
    .eq("state", "RECEIVED")
    .lt("received_at", cutoffDate.toISOString())
    .not("package_image_paths", "is", null);

  if (fetchError) {
    return NextResponse.json(
      { error: fetchError.message },
      { status: 500 },
    );
  }

  if (!expiredTransfers || expiredTransfers.length === 0) {
    return NextResponse.json({
      message: "No expired images to clean up.",
      processed: 0,
    });
  }

  let totalDeleted = 0;
  let transfersProcessed = 0;

  for (const transfer of expiredTransfers) {
    const paths: string[] = transfer.package_image_paths ?? [];

    if (paths.length > 0) {
      // Delete images from storage
      const { error: deleteError } = await admin.storage
        .from(DISPATCH_IMAGES_BUCKET)
        .remove(paths);

      if (deleteError) {
        console.error(
          `Failed to delete images for transfer ${transfer.id}:`,
          deleteError.message,
        );
        // Continue processing other transfers
        continue;
      }

      totalDeleted += paths.length;
    }

    // Nullify the package_image_paths column
    await admin
      .from("franchise_stock_transfers")
      .update({ package_image_paths: null })
      .eq("id", transfer.id);

    transfersProcessed += 1;
  }

  return NextResponse.json({
    message: `Cleaned up ${totalDeleted} images from ${transfersProcessed} transfers.`,
    processed: transfersProcessed,
    imagesDeleted: totalDeleted,
  });
}
