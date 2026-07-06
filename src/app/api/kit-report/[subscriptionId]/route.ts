import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateReport, ReportError } from "@/services/KitReportService";

/**
 * GET /api/kit-report/[subscriptionId]
 *
 * Generates and serves a PDF report for a KIT subscription.
 * Authenticates the customer via session and validates ownership.
 *
 * Returns:
 * - 200 with PDF binary (Content-Type: application/pdf)
 * - 400 for PENDING subscriptions
 * - 403 for authorization failure or category mismatch
 * - 404 for not found
 * - 500 for generation errors or timeout
 *
 * Requirements: 9.1, 9.6, 9.7, 10.1, 10.5, 10.6, 12.3
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ subscriptionId: string }> }
) {
  try {
    // Authenticate customer via session
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Resolve customer_profile_id from auth user
    const { data: dbUser } = await supabase
      .from("users")
      .select("id")
      .eq("auth_user_id", user.id)
      .maybeSingle();

    if (!dbUser) {
      return NextResponse.json(
        { error: "User record not found" },
        { status: 401 }
      );
    }

    const { data: profile } = await supabase
      .from("customer_profiles")
      .select("id")
      .eq("user_id", dbUser.id)
      .maybeSingle();

    if (!profile) {
      return NextResponse.json(
        { error: "Customer profile not found" },
        { status: 401 }
      );
    }

    const { subscriptionId } = await params;

    // Generate the PDF report (handles auth, category check, caching internally)
    const pdfBuffer = await generateReport(subscriptionId, profile.id);

    // Return PDF as download (convert Buffer to Uint8Array for BodyInit compatibility)
    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="kit-report-${subscriptionId}.pdf"`,
        "Content-Length": pdfBuffer.length.toString(),
      },
    });
  } catch (error: unknown) {
    if (error instanceof ReportError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      );
    }

    console.error("KIT Report Generation Error:", error);
    return NextResponse.json(
      { error: "Report could not be generated" },
      { status: 500 }
    );
  }
}
