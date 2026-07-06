"use server";

import { createAdminClient } from "@/lib/supabase/admin";

const DISPATCH_IMAGES_BUCKET = "franchise-dispatch-images";

type GetImagesResult =
  | { success: true; urls: string[] }
  | { success: false; error: string };

/**
 * Fetches signed URLs for package images attached to a franchise stock transfer.
 * Returns empty array if no images exist or transfer not found.
 * Signed URLs expire after 1 hour (images are accessed on-demand).
 */
export async function getPackageImageUrls(
  transferId: string,
): Promise<GetImagesResult> {
  if (!transferId) {
    return { success: false, error: "Transfer ID is required." };
  }

  const admin = createAdminClient();

  // Fetch the package_image_paths from the transfer record
  const { data, error } = await admin
    .from("franchise_stock_transfers")
    .select("package_image_paths")
    .eq("id", transferId)
    .single();

  if (error) {
    return { success: false, error: error.message };
  }

  const paths: string[] | null = data?.package_image_paths;

  if (!paths || paths.length === 0) {
    return { success: true, urls: [] };
  }

  // Generate signed URLs for each image (1 hour expiry)
  const urls: string[] = [];
  for (const path of paths) {
    const { data: signedData, error: signError } = await admin.storage
      .from(DISPATCH_IMAGES_BUCKET)
      .createSignedUrl(path, 3600); // 1 hour

    if (signError || !signedData?.signedUrl) {
      // Image might have been deleted (past 10-day retention) — skip
      continue;
    }

    urls.push(signedData.signedUrl);
  }

  return { success: true, urls };
}
