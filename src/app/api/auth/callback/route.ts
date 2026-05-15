import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createCustomerFromOAth } from "@/services/signupService";

export async function GET(request: NextRequest) {
  // 1. Get the true hostname directly from headers (Handles subdomains perfectly)
  const host = request.headers.get("host");
  const protocol = host?.includes("localhost") ? "http" : "https";
  const baseOrigin = `${protocol}://${host}`;

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  // Use baseOrigin + /login (The middleware handles the /customer/ folder routing)
  if (!code) {
    return NextResponse.redirect(`${baseOrigin}/login?error=Invalid_Request`);
  }

  const supabase = await createClient();

  // Exchange code for a session
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.exchangeCodeForSession(code);

  if (sessionError || !session) {
    return NextResponse.redirect(`${baseOrigin}/login?error=OAuth_Failed`);
  }

  const authUserId = session.user.id;

  const { data: userData, error: userError } = await supabase
    .from("users")
    .select(`is_active, roles(code)`)
    .eq("auth_user_id", authUserId)
    .single();

  if (userError || !userData) {
    // NEW USER: Auto-register them
    try {
      const email = session.user.email || "";
      const fullName = session.user.user_metadata?.full_name || "Customer";

      await createCustomerFromOAth(authUserId, email, fullName);
    } catch (error) {
      await supabase.auth.signOut();
      return NextResponse.redirect(`${baseOrigin}/login?error=Signup_Failed`);
    }
  } else {
    // EXISTING USER: Check constraints
    if (!userData.is_active) {
      await supabase.auth.signOut();
      return NextResponse.redirect(
        `${baseOrigin}/login?error=Account_Deactivated`,
      );
    }

    const userRole = Array.isArray(userData.roles)
      ? userData.roles[0]?.code
      : (userData.roles as { code: string })?.code;

    // Prevent internal staff (like MASTER) from logging into the Customer portal via OAuth
    if (userRole === "MASTER") {
      await supabase.auth.signOut();
      return NextResponse.redirect(
        `${baseOrigin}/login?error=Unauthorized_Role`,
      );
    }
  }

  // 2. Build the final redirect URL using the verified host header
  const finalUrl = new URL(next, baseOrigin);
  finalUrl.search = ""; // Clean the URL for security

  return NextResponse.redirect(finalUrl);
}
