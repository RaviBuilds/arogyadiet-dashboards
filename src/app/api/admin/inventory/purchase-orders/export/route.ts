import { NextResponse, type NextRequest } from "next/server";

import { purchaseOrderExportFiltersSchema } from "@/lib/inventory/product-schema";
import { createClient } from "@/lib/supabase/server";
import { createZip, type ZipEntry } from "@/lib/zip";
import {
  downloadPurchaseOrderFile,
  getPurchaseOrderFilesForExport,
} from "@/services/inventoryEngine";

export const dynamic = "force-dynamic";

const ALLOWED_ROLES = ["ADMIN", "MASTER_ADMIN"];

function sanitizeFileNamePart(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9 _-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

export async function GET(request: NextRequest) {
  // The middleware lets /api requests through unauthenticated,
  // so this route enforces admin access itself.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { data: userProfile } = await supabase
    .from("users")
    .select("roles(code)")
    .eq("auth_user_id", user.id)
    .single();

  const rolesData: unknown = userProfile?.roles;
  const roleCode = Array.isArray(rolesData)
    ? (rolesData[0] as { code?: string } | undefined)?.code
    : (rolesData as { code?: string } | null)?.code;

  if (!roleCode || !ALLOWED_ROLES.includes(roleCode)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const params = request.nextUrl.searchParams;
  const typeParam = params.get("type");
  const productIdsParam = params.get("productIds");

  const parsed = purchaseOrderExportFiltersSchema.safeParse({
    from: params.get("from") ?? "",
    to: params.get("to") ?? "",
    type: typeParam && typeParam !== "ALL" ? typeParam : undefined,
    productIds: productIdsParam
      ? productIdsParam.split(",").filter(Boolean)
      : undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid export filters." },
      { status: 400 },
    );
  }

  try {
    const files = await getPurchaseOrderFilesForExport(parsed.data);

    if (files.length === 0) {
      return NextResponse.json(
        {
          error:
            "No purchase orders found for the selected date range and filters.",
        },
        { status: 404 },
      );
    }

    const usedNames = new Set<string>();
    const entries: ZipEntry[] = [];

    for (const file of files) {
      const data = await downloadPurchaseOrderFile(file.path);
      const extension = file.path.split(".").pop() ?? "bin";
      const datePart = file.receivedAt.slice(0, 10);
      const productPart = sanitizeFileNamePart(file.productName) || "product";

      let name = `${datePart}_${productPart}_${file.batchNumber}.${extension}`;
      let suffix = 1;
      while (usedNames.has(name)) {
        name = `${datePart}_${productPart}_${file.batchNumber}_${suffix}.${extension}`;
        suffix += 1;
      }
      usedNames.add(name);

      entries.push({ name, data });
    }

    const zip = createZip(entries);
    const fileName = `purchase-orders_${parsed.data.from}_to_${parsed.data.to}.zip`;

    return new Response(Buffer.from(zip), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to export purchase orders.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
