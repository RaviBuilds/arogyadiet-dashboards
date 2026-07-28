import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  generateMealHealthReport,
  ReportError,
} from "@/services/HealthReportService";

/**
 * GET /api/meal-health-report/[subscriptionId]
 *
 * Generates and serves a PDF Health Report for a MEAL subscription.
 * Authenticates the customer via session and validates ownership + category
 * inside the service.
 *
 * Returns:
 * - 200 with PDF binary (Content-Type: application/pdf)
 * - 401 when unauthenticated / profile not resolvable
 * - 403 for authorization failure or category mismatch
 * - 404 for not found
 * - 500 for generation errors or timeout
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ subscriptionId: string }> },
) {
  try {
    // Authenticate customer via session
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Resolve customer_profile_id from auth user
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

    const { subscriptionId } = await params;

    const pdfBuffer = await generateMealHealthReport(subscriptionId, profile.id);

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="health-report-${subscriptionId}.pdf"`,
        "Content-Length": pdfBuffer.length.toString(),
      },
    });
  } catch (error: unknown) {
    if (error instanceof ReportError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }

    console.error("Meal Health Report Generation Error:", error);
    return NextResponse.json(
      { error: "Report could not be generated" },
      { status: 500 },
    );
  }
}
