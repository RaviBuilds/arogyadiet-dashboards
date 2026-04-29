// src/app/api/auth/recovery/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  // 1. Get the true hostname directly from headers
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

  // Exchange code for a session
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(`${baseOrigin}/login?error=Recovery_Failed`);
  }

  // 2. Build the final redirect URL using the verified host header
  const finalUrl = new URL(next, baseOrigin);
  finalUrl.search = ""; // Clean the URL for security

  return NextResponse.redirect(finalUrl);
}
