import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { generateStayHealthReport, ReportError } from "@/services/HealthReportService";

/**
 * GET /api/stay-health-report/[stayId]
 *
 * Generates and serves the ACCOMMODATION Health Report PDF for one stay.
 *
 * The middleware lets /api requests through unauthenticated, so this route
 * authenticates the customer from their session itself; ownership of the stay is
 * verified inside `generateStayHealthReport` against the resolved profile id, so
 * a customer can only ever download their own report.
 *
 * Mirrors /api/meal-health-report/[subscriptionId] for MEAL customers.
 *
 * Returns:
 * - 200 with PDF binary (Content-Type: application/pdf)
 * - 401 when unauthenticated / profile not resolvable
 * - 403 when the stay belongs to another customer
 * - 404 when the stay does not exist
 * - 500 for generation errors or timeout
 */

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ stayId: string }> },
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: dbUser } = await supabase
      .from("users")
      .select("id")
      .eq("auth_user_id", user.id)
      .maybeSingle();

    if (!dbUser) {
      return NextResponse.json({ error: "User record not found" }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from("customer_profiles")
      .select("id")
      .eq("user_id", dbUser.id)
      .maybeSingle();

    if (!profile) {
      return NextResponse.json({ error: "Customer profile not found" }, { status: 401 });
    }

    const { stayId } = await params;

    const pdfBuffer = await generateStayHealthReport(stayId, profile.id);

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="health-report-${stayId}.pdf"`,
        "Content-Length": pdfBuffer.length.toString(),
      },
    });
  } catch (error: unknown) {
    if (error instanceof ReportError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }

    console.error("Stay Health Report Generation Error:", error);
    return NextResponse.json(
      { error: "Report could not be generated" },
      { status: 500 },
    );
  }
}
