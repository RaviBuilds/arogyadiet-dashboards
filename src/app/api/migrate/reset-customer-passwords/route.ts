import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

/**
 * ONE-TIME migration endpoint: Reset all existing customer auth passwords
 * to CUSTOMER_SERVER_PASSWORD so the PIN-based login flow can establish
 * sessions via signInWithPassword.
 *
 * DELETE THIS FILE after running once successfully!
 *
 * Usage: GET or POST /api/migrate/reset-customer-passwords
 * No body required. Uses CUSTOMER_SERVER_PASSWORD from env.
 */
export async function GET() {
  return runMigration();
}

export async function POST() {
  return runMigration();
}

async function runMigration() {
  try {
    const serverPassword = process.env.CUSTOMER_SERVER_PASSWORD;
    if (!serverPassword) {
      return NextResponse.json(
        { error: "CUSTOMER_SERVER_PASSWORD env var is not set" },
        { status: 500 },
      );
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    // Get all customer auth_user_ids
    const { data: customers, error: fetchError } = await supabaseAdmin
      .from("users")
      .select("id, auth_user_id, email")
      .in(
        "id",
        // subquery: all user_ids that have a customer_profile
        (
          await supabaseAdmin
            .from("customer_profiles")
            .select("user_id")
        ).data?.map((cp: { user_id: string }) => cp.user_id) ?? [],
      );

    if (fetchError) {
      return NextResponse.json(
        { error: `Failed to fetch customers: ${fetchError.message}` },
        { status: 500 },
      );
    }

    if (!customers || customers.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No customers found.",
        updated: 0,
        failed: 0,
      });
    }

    let updated = 0;
    let failed = 0;
    const failures: { email: string; error: string }[] = [];

    for (const customer of customers) {
      if (!customer.auth_user_id) {
        failed++;
        failures.push({
          email: customer.email,
          error: "No auth_user_id",
        });
        continue;
      }

      const { error: updateError } =
        await supabaseAdmin.auth.admin.updateUserById(
          customer.auth_user_id,
          { password: serverPassword },
        );

      if (updateError) {
        failed++;
        failures.push({
          email: customer.email,
          error: updateError.message,
        });
      } else {
        updated++;
      }
    }

    return NextResponse.json({
      success: failed === 0,
      message: `Updated ${updated} of ${customers.length} customer passwords.`,
      total: customers.length,
      updated,
      failed,
      failures: failures.slice(0, 20), // only first 20 for brevity
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
