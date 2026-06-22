"use server";

import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

/**
 * TEMPORARY endpoint to reset a franchise admin's password.
 * DELETE THIS FILE after use!
 *
 * Usage: POST /api/reset-franchise-password
 * Body: { "email": "...", "newPassword": "..." }
 */
export async function POST(request: Request) {
  try {
    const { email, newPassword } = await request.json();

    if (!email || !newPassword) {
      return NextResponse.json(
        { error: "email and newPassword are required" },
        { status: 400 }
      );
    }

    if (newPassword.length < 6) {
      return NextResponse.json(
        { error: "Password must be at least 6 characters" },
        { status: 400 }
      );
    }

    // Create client with service role key — NO auth options that might interfere
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // First, get the user's auth_user_id from public.users
    const { data: userRecord, error: userError } = await supabaseAdmin
      .from("users")
      .select("auth_user_id")
      .eq("email", email)
      .single();

    if (userError || !userRecord?.auth_user_id) {
      return NextResponse.json(
        { error: "No user found with this email in public.users" },
        { status: 404 }
      );
    }

    // Try auth.admin.updateUser
    if (
      supabaseAdmin.auth &&
      supabaseAdmin.auth.admin &&
      typeof supabaseAdmin.auth.admin.updateUser === "function"
    ) {
      const { error: updateError } = await supabaseAdmin.auth.admin.updateUser(
        userRecord.auth_user_id,
        { password: newPassword }
      );

      if (updateError) {
        return NextResponse.json(
          { error: updateError.message },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        message: `Password reset for ${email}`,
      });
    }

    // Fallback: use raw REST API call to Supabase Auth Admin
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

    const response = await fetch(
      `${supabaseUrl}/auth/v1/admin/users/${userRecord.auth_user_id}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceRoleKey}`,
          apikey: serviceRoleKey,
        },
        body: JSON.stringify({ password: newPassword }),
      }
    );

    if (!response.ok) {
      const errorData = await response.json();
      return NextResponse.json(
        { error: errorData.message || "Failed to update password via REST" },
        { status: response.status }
      );
    }

    return NextResponse.json({
      success: true,
      message: `Password reset for ${email} (via REST fallback)`,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message, stack: err.stack },
      { status: 500 }
    );
  }
}
