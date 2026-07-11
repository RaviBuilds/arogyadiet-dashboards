import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";

/**
 * ONE-TIME fix-up endpoint: repairs a specific accommodation customer row
 * that was created by `onboardAccommodationCustomerAction` BEFORE that
 * action created a Supabase Auth identity (bug fixed in
 * accommodationOnboardingActions.ts). Affected rows have a `public.users`
 * record with `auth_user_id IS NULL` and no `pin_hash`, so the customer can
 * never sign in.
 *
 * This endpoint:
 *   1. Looks up the `users` row by mobile number.
 *   2. If `auth_user_id` is already set, does nothing (already fixed / not
 *      the affected record).
 *   3. Otherwise creates the missing `auth.users` identity with the row's
 *      existing email + CUSTOMER_SERVER_PASSWORD, links it via
 *      `auth_user_id`, and sets a known temporary PIN (`is_temp_pin = true`)
 *      so the customer can log in and choose a permanent PIN.
 *
 * DELETE THIS FILE after running once successfully!
 *
 * Usage: GET or POST /api/migrate/fix-stuck-accommodation-user?mobile=9158665251&tempPin=111111
 *   - mobile:  required, the 10-digit mobile number of the stuck customer.
 *   - tempPin: optional, defaults to "111111". Must be exactly 6 digits.
 */
export async function GET(request: Request) {
  return runFix(request);
}

export async function POST(request: Request) {
  return runFix(request);
}

async function runFix(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const mobile = searchParams.get("mobile");
    const tempPin = searchParams.get("tempPin") ?? "111111";

    if (!mobile || !/^[6-9]\d{9}$/.test(mobile)) {
      return NextResponse.json(
        { error: "Provide a valid 10-digit mobile number via ?mobile=" },
        { status: 400 },
      );
    }

    if (!/^\d{6}$/.test(tempPin)) {
      return NextResponse.json(
        { error: "tempPin must be exactly 6 digits" },
        { status: 400 },
      );
    }

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

    // 1. Look up the stuck user row.
    const { data: user, error: fetchError } = await supabaseAdmin
      .from("users")
      .select("id, auth_user_id, email, full_name")
      .eq("mobile", mobile)
      .maybeSingle();

    if (fetchError) {
      return NextResponse.json(
        { error: `Failed to look up user: ${fetchError.message}` },
        { status: 500 },
      );
    }

    if (!user) {
      return NextResponse.json(
        { error: `No user found for mobile ${mobile}` },
        { status: 404 },
      );
    }

    if (user.auth_user_id) {
      return NextResponse.json({
        success: true,
        message: `User ${mobile} already has an auth identity (auth_user_id=${user.auth_user_id}). No action taken.`,
        alreadyFixed: true,
      });
    }

    // 2. Create the missing Supabase Auth identity using the row's existing email.
    const { data: authData, error: authError } =
      await supabaseAdmin.auth.admin.createUser({
        email: user.email,
        password: serverPassword,
        phone: `+91${mobile}`,
        email_confirm: true,
        phone_confirm: true,
        user_metadata: { full_name: user.full_name, fixed_by_migration: true },
      });

    if (authError || !authData?.user) {
      return NextResponse.json(
        {
          error: `Failed to create auth identity: ${authError?.message ?? "unknown error"}`,
        },
        { status: 500 },
      );
    }
    const authUserId = authData.user.id;

    // 3. Link auth_user_id and set a known temporary PIN so the customer can log in.
    const pinHash = await bcrypt.hash(tempPin, 10);

    const { error: updateError } = await supabaseAdmin
      .from("users")
      .update({
        auth_user_id: authUserId,
        pin_hash: pinHash,
        is_temp_pin: true,
        pin_set_at: new Date().toISOString(),
      })
      .eq("id", user.id);

    if (updateError) {
      // Compensate: remove the just-created auth identity since the link failed.
      await supabaseAdmin.auth.admin.deleteUser(authUserId);
      return NextResponse.json(
        { error: `Failed to link auth identity: ${updateError.message}` },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      message: `Fixed user ${mobile}. Auth identity created and linked. Temporary PIN set to ${tempPin} — the customer must set a new permanent PIN on next login.`,
      authUserId,
      email: user.email,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
