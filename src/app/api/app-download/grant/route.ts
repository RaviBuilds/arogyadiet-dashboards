// src/app/api/app-download/grant/route.ts
// Download_Grant_Endpoint for the App APK Distribution feature.
//
// This endpoint accepts a Turnstile token and app slug, verifies the token with
// Cloudflare, claims a rate-limit grant, and returns a signed download URL.
//
// The ordering of operations is critical for security (Property 1: No unverified byte):
//   1. Validate request body (slug, token)
//   2. Resolve client IP from headers
//   3. Verify Turnstile token (short-circuits on failure)
//   4. Claim rate-limit grant (after verification, so bots can't consume quota)
//   5. Read release manifest
//   6. Create signed download URL
//   7. Return response
//
// Only POST is exported, so Next.js answers any other method with 405 (Req 6.1).

import { NextResponse } from "next/server";
import { grantRequestSchema } from "@/validations/appDistribution";
import { parseAppSlug, type AppSlug } from "@/lib/appDistribution/slug";
import { verifyTurnstileToken } from "@/lib/appDistribution/turnstile";
import {
  resolveClientIp,
  hashClientIp,
} from "@/lib/appDistribution/rateLimit";
import { claimDownloadGrant } from "@/repositories/appDownloadThrottleRepository";
import {
  readReleaseManifest,
  createSignedDownloadUrl,
} from "@/lib/appDistribution/storage";

export const dynamic = "force-dynamic";

/**
 * Error response bodies.
 * These are strongly typed to ensure consistent error formatting.
 */
const ERROR_RESPONSES = {
  INVALID_REQUEST: { error: "INVALID_REQUEST" } as const,
  VERIFICATION_FAILED: { error: "VERIFICATION_FAILED" } as const,
  RATE_LIMITED: (retryAfterSeconds: number) => ({
    error: "RATE_LIMITED",
    retryAfterSeconds,
  }),
  UNAVAILABLE: { error: "UNAVAILABLE" } as const,
} as const;

/**
 * POST /api/app-download/grant
 *
 * Issues a signed download URL after verifying a Turnstile token and checking
 * the per-IP rate limit.
 *
 * Request body:
 *   { "slug": "customer" | "rider", "token": "<turnstile token>" }
 *
 * Responses:
 *   200 { url, version, filename } - Success
 *   400 { error: "INVALID_REQUEST" } - Missing or invalid slug/token
 *   403 { error: "VERIFICATION_FAILED" } - Turnstile verification failed
 *   429 { error: "RATE_LIMITED", retryAfterSeconds } + Retry-After header
 *   503 { error: "UNAVAILABLE" } - Service temporarily unavailable
 *
 * Requirements: 6.1, 6.2, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 6.11, 6.12,
 *               6.13, 6.15, 6.16, 7.2, 7.3, 7.5
 */
export async function POST(request: Request): Promise<NextResponse> {
  // Step 1: Parse and validate the request body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(ERROR_RESPONSES.INVALID_REQUEST, { status: 400 });
  }

  const parseResult = grantRequestSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json(ERROR_RESPONSES.INVALID_REQUEST, { status: 400 });
  }

  const { slug: slugInput, token } = parseResult.data;

  // Validate slug against allowed values
  const slug: AppSlug | null = parseAppSlug(slugInput);
  if (!slug) {
    return NextResponse.json(ERROR_RESPONSES.INVALID_REQUEST, { status: 400 });
  }

  // Step 2: Resolve client IP from headers (Req 7.6)
  const clientIp = resolveClientIp(request.headers);

  // Step 3: Verify Turnstile token (Req 6.2 - verification precedes any signed URL)
  const verdict = await verifyTurnstileToken(token, clientIp);

  if (verdict.kind !== "VALID") {
    // Non-VALID verdicts short-circuit - no signed URL is created
    // Log the rejection for server-side visibility (error-codes never reach response body)
    if (verdict.kind === "REJECTED") {
      console.warn("[grant] Turnstile token rejected:", {
        codes: verdict.codes,
        slug,
        clientIp: clientIp ? "[present]" : "[absent]",
      });
      return NextResponse.json(ERROR_RESPONSES.VERIFICATION_FAILED, {
        status: 403,
      });
    }

    if (verdict.kind === "MISCONFIGURED") {
      // Turnstile secret key is missing - log as error
      console.error("[grant] Turnstile misconfigured: secret key is absent");
      return NextResponse.json(ERROR_RESPONSES.UNAVAILABLE, { status: 503 });
    }

    // UNAVAILABLE - Cloudflare unreachable or returned malformed response
    console.warn("[grant] Turnstile verification unavailable:", {
      detail: verdict.detail,
      slug,
    });
    return NextResponse.json(ERROR_RESPONSES.UNAVAILABLE, { status: 503 });
  }

  // Step 4: Claim rate-limit grant (after verification per Req 7.5)
  // This ordering ensures a bot spraying invalid tokens cannot consume a real
  // user's quota from a shared NAT address
  const ipHash = hashClientIp(clientIp);
  const grant = await claimDownloadGrant(ipHash, slug);

  if (!grant.granted) {
    // Rate limit hit - return 429 with Retry-After header (Req 7.2, 7.3)
    return NextResponse.json(
      ERROR_RESPONSES.RATE_LIMITED(grant.retryAfterSeconds),
      {
        status: 429,
        headers: {
          "Retry-After": String(grant.retryAfterSeconds),
        },
      },
    );
  }

  // Step 5: Read the release manifest (Req 6.4)
  const manifestResult = await readReleaseManifest(slug);

  if (!manifestResult.ok) {
    // Manifest unavailable or invalid - return 503 (Req 6.11, 6.12)
    console.warn("[grant] Failed to read manifest:", {
      reason: manifestResult.reason,
      detail: manifestResult.detail,
      slug,
    });
    return NextResponse.json(ERROR_RESPONSES.UNAVAILABLE, { status: 503 });
  }

  const { manifest } = manifestResult;

  // Step 6: Create signed download URL (Req 6.4, 6.5)
  const urlResult = await createSignedDownloadUrl(slug, manifest.filename);

  if (!urlResult.ok) {
    // Signed URL creation failed - return 503
    console.error("[grant] Failed to create signed URL:", {
      detail: urlResult.detail,
      slug,
      filename: manifest.filename,
    });
    return NextResponse.json(ERROR_RESPONSES.UNAVAILABLE, { status: 503 });
  }

  // Step 7: Return success response with URL, version, and filename (Req 6.6)
  return NextResponse.json(
    {
      url: urlResult.url,
      version: manifest.version,
      filename: manifest.filename,
    },
    { status: 200 },
  );
}
