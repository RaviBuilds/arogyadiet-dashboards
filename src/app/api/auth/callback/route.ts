import { NextRequest, NextResponse } from "next/server";

// Customer self-service OAuth (Google) sign-in / sign-up is disabled
// (Req 1.5).
//
// This callback endpoint previously exchanged the OAuth code for a session and
// auto-registered a CUSTOMER account. In the mobile-first, admin-initiated
// onboarding model that self-service path is removed: this endpoint no longer
// exchanges the code, creates a user, or establishes a session. Any request —
// including a direct hit that bypasses the UI — is rejected WITHOUT creating or
// authenticating an account and redirected to the mobile login screen.
//
// Account creation is admin-initiated only; the legacy 3-step admin
// customer-creation flow remains available and untouched (Req 4.8). The
// password-recovery callback (`/api/auth/recovery`) is a separate endpoint and
// is intentionally left unchanged.
export async function GET(request: NextRequest) {
  // Derive the true origin from the host header so the subdomain-based portal
  // routing (handled by middleware) resolves `/login` to the correct portal.
  const host = request.headers.get("host");
  const protocol = host?.includes("localhost") ? "http" : "https";
  const baseOrigin = `${protocol}://${host}`;

  return NextResponse.redirect(`${baseOrigin}/login`);
}
