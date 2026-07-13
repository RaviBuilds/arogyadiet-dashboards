import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  // 1. Get the true hostname directly from headers (Crucial for subdomain routing)
  const host = request.headers.get("host");
  const protocol = host?.includes("localhost") ? "http" : "https";
  const baseOrigin = `${protocol}://${host}`;

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");

  // This route is strictly for recovery, so we safely hardcode the destination
  const next = "/update-password";

  const supabase = await createClient();

  // Handle PKCE code-based flow (works when same browser context is maintained)
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      console.error("Auth Recovery Error (code exchange):", error.message);
      return NextResponse.redirect(`${baseOrigin}/login?error=Recovery_Failed`);
    }

    const finalUrl = new URL(next, baseOrigin);
    finalUrl.search = "";
    return NextResponse.redirect(finalUrl);
  }

  // Handle token_hash-based flow (works on mobile / cross-browser / email clients)
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type: type as "recovery",
      token_hash: tokenHash,
    });

    if (error) {
      console.error("Auth Recovery Error (token_hash verify):", error.message);
      return NextResponse.redirect(`${baseOrigin}/login?error=Recovery_Failed`);
    }

    const finalUrl = new URL(next, baseOrigin);
    finalUrl.search = "";
    return NextResponse.redirect(finalUrl);
  }

  // No valid parameters provided
  return NextResponse.redirect(`${baseOrigin}/login?error=Invalid_Request`);
}
