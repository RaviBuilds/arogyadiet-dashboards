import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  generateShopReceipt,
  receiptNumberFor,
  ShopReceiptError,
} from "@/services/ShopReceiptService";

/**
 * GET /api/shop-receipt/[orderId]
 *
 * Generates and serves the Sale Receipt PDF for one shop order so staff can
 * hand or send a customer proof of purchase for stock that left the clinic.
 *
 * The middleware lets /api requests through unauthenticated, so this route
 * enforces access itself — mirroring
 * /api/admin/customer-report/[type]/[id]. Any staff role that can place or
 * review a shop order can reprint its receipt; the receipt contains no data
 * beyond what the All Shop Orders ledger already shows that role.
 */

export const dynamic = "force-dynamic";

/** Roles allowed to download a shop sale receipt. */
const ALLOWED_ROLES = ["ADMIN", "MASTER_ADMIN", "FRANCHISE_ADMIN"];

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> },
) {
  try {
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
      .maybeSingle();

    const rolesData: unknown = userProfile?.roles;
    const roleCode = Array.isArray(rolesData)
      ? (rolesData[0] as { code?: string } | undefined)?.code
      : (rolesData as { code?: string } | null)?.code;

    if (!roleCode || !ALLOWED_ROLES.includes(roleCode)) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    const { orderId } = await params;
    if (!orderId) {
      return NextResponse.json({ error: "Missing order id." }, { status: 400 });
    }

    const pdf = await generateShopReceipt(orderId);
    const filename = `sale-receipt-${receiptNumberFor(orderId)}.pdf`;

    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": pdf.length.toString(),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof ShopReceiptError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    console.error("Failed to generate shop receipt:", error);
    return NextResponse.json(
      { error: "Could not generate the receipt." },
      { status: 500 },
    );
  }
}
