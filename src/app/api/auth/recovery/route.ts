import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  // 1. Get the true hostname directly from headers (Crucial for subdomain routing)
  const host = request.headers.get("host");
  const protocol = host?.includes("localhost") ? "http" : "https";
  const baseOrigin = `${protocol}://${host}`;

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");

  // This route is strictly for recovery, so we safely hardcode the destination
  const next = "/update-password";

  if (!code) {
    return NextResponse.redirect(`${baseOrigin}/login?error=Invalid_Request`);
  }

  const supabase = await createClient();

  // 2. Exchange the single-use code for an active session
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    // Log the exact error to your terminal to help with debugging
    console.error("Auth Recovery Error:", error.message);
    return NextResponse.redirect(`${baseOrigin}/login?error=Recovery_Failed`);
  }

  // 3. Build the final redirect URL using the verified host header
  const finalUrl = new URL(next, baseOrigin);

  // Clean the URL search params so the one-time code doesn't linger in the browser bar
  finalUrl.search = "";

  return NextResponse.redirect(finalUrl);
}
