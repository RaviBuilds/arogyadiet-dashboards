import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createCustomerFromOAth } from "@/services/signupService";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);

  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/customer/dashboard";
  const expectedRole = "CUSTOMER";

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=Invalid_Request`);
  }

  const supabase = await createClient();

  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.exchangeCodeForSession(code);

  if (sessionError || !session) {
    return NextResponse.redirect(`${origin}/login?error=OAuth_Failed`);
  }

  const authUserId = session.user.id;

  const { data: userData, error: userError } = await supabase
    .from("users")
    .select(`is_active, roles(code)`)
    .eq("auth_user_id", authUserId)
    .single();

  // if user does not exist in our business table
  if (userError || !userData) {
    try {
      const email = session.user.email || '';
      const fullName = session.user.user_metadata?.full_name || 'Customer';

      await createCustomerFromOAth(
        authUserId,
        email,
        fullName,
      );
    } catch (error) {
      await supabase.auth.signOut();
      return NextResponse.redirect(
        `${origin}/customer/login?error=Signup_Failed`,
      );
    }
  } else {
    if (!userData.is_active) {
      await supabase.auth.signOut();
      return NextResponse.redirect(
        `${origin}/customer/login?error=Account_Deactivated`,
      );
    }
    //check the role boundary

    const userRole = Array.isArray(userData.roles)
      ? userData.roles[0]?.code
      : (userData.roles as { code: string })?.code;

    if (userRole !== expectedRole) {
      await supabase.auth.signOut();
      return NextResponse.redirect(
        `${origin}/customer/login?error=Unauthorized_Role`,
      );
    }
  }
  return NextResponse.redirect(`${origin}${next}`);
}
