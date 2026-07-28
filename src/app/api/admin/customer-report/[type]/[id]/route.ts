import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  generateMealHealthReport,
  generateStayHealthReport,
  ReportError,
} from "@/services/HealthReportService";
import {
  generateReport as generateKitReport,
  ReportError as KitReportError,
} from "@/services/KitReportService";
import {
  getMealSubscriptionForReport,
  getStayForReport,
} from "@/repositories/healthReportRepository";

/**
 * GET /api/admin/customer-report/[type]/[id]
 *
 * Admin-side download of the SAME report PDF the customer downloads from their
 * own dashboard:
 * - `type=meal` + subscription id  → the MEAL Health Report
 * - `type=kit`  + subscription id  → the KIT Report
 * - `type=stay` + stay id          → the ACCOMMODATION Health Report
 *
 * The middleware lets /api requests through unauthenticated, so this route
 * enforces admin access itself. Ownership is resolved from the record rather
 * than the session (an admin is not the owner), after the role check passes.
 */

export const dynamic = "force-dynamic";

/** Roles allowed to download any customer's report. Dietitians carry ADMIN/FRANCHISE_ADMIN. */
const ALLOWED_ROLES = ["ADMIN", "MASTER_ADMIN", "FRANCHISE_ADMIN"];

type ReportType = "meal" | "kit" | "stay";

function isReportType(value: string): value is ReportType {
  return value === "meal" || value === "kit" || value === "stay";
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ type: string; id: string }> },
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

    const { type, id } = await params;
    if (!isReportType(type)) {
      return NextResponse.json({ error: "Unknown report type." }, { status: 400 });
    }

    const { pdf, filename } = await generateForType(type, id);

    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": pdf.length.toString(),
      },
    });
  } catch (error: unknown) {
    if (error instanceof ReportError || error instanceof KitReportError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }

    console.error("Admin Customer Report Generation Error:", error);
    return NextResponse.json(
      { error: "Report could not be generated" },
      { status: 500 },
    );
  }
}

/**
 * Resolve the record's owning customer, then delegate to the very same service
 * the customer-facing route uses — so the admin download is byte-for-byte the
 * report the customer gets.
 */
async function generateForType(
  type: ReportType,
  id: string,
): Promise<{ pdf: Buffer; filename: string }> {
  if (type === "stay") {
    const stay = await getStayForReport(id);
    if (!stay) {
      throw new ReportError("Stay not found.", 404);
    }
    return {
      pdf: await generateStayHealthReport(id, stay.customerProfileId),
      filename: `health-report-${id}.pdf`,
    };
  }

  const subscription = await getMealSubscriptionForReport(id);
  if (!subscription) {
    throw new ReportError("Subscription not found.", 404);
  }

  if (type === "kit") {
    return {
      pdf: await generateKitReport(id, subscription.customerProfileId),
      filename: `kit-report-${id}.pdf`,
    };
  }

  return {
    pdf: await generateMealHealthReport(id, subscription.customerProfileId),
    filename: `health-report-${id}.pdf`,
  };
}
