// src/lib/appDistribution/turnstile.ts
// Cloudflare Turnstile token verification for the app distribution feature.
// Posts secret, response, and remoteip to the siteverify endpoint and returns
// a discriminated verdict. The secret is read via config.ts, and MISCONFIGURED
// is returned without a network call when absent, so a missing key produces
// one clear log line instead of a stream of opaque Cloudflare errors.
//
// The error-codes array from Cloudflare is carried in REJECTED.codes for
// logging only. It never reaches the response body (Req 6.14).

import "server-only";

import { resolveTurnstileSecretKey } from "./config";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TIMEOUT_MS = 5000;

/**
 * The outcome of a Turnstile token verification.
 *
 * - VALID: The token was verified successfully. Proceed to rate-limit claim.
 * - REJECTED: The token was invalid, expired, or already redeemed. Return 403.
 * - UNAVAILABLE: Cloudflare was unreachable or returned a malformed response. Return 503.
 * - MISCONFIGURED: The TURNSTILE_SECRET_KEY is absent or empty. Return 503 + log error.
 */
export type TurnstileVerdict =
  | { kind: "VALID" }
  | { kind: "REJECTED"; codes: string[] }
  | { kind: "UNAVAILABLE"; detail: string }
  | { kind: "MISCONFIGURED" };

interface SiteverifySuccessResponse {
  success: true;
  challenge_ts: string;
  hostname: string;
  "error-codes"?: string[];
}

interface SiteverifyFailureResponse {
  success: false;
  "error-codes": string[];
}

type SiteverifyResponse = SiteverifySuccessResponse | SiteverifyFailureResponse;

/**
 * Verifies a Turnstile token against Cloudflare's siteverify endpoint.
 *
 * Posts `secret`, `response`, and `remoteip` as `application/x-www-form-urlencoded`.
 * A 5-second AbortSignal.timeout bounds the call so a Cloudflare stall cannot
 * hold a serverless invocation open.
 *
 * @param token - The Turnstile token from the client widget.
 * @param remoteIp - The client's IP address, or null if unavailable.
 * @returns A discriminated verdict indicating the outcome.
 */
export async function verifyTurnstileToken(
  token: string,
  remoteIp: string | null,
): Promise<TurnstileVerdict> {
  const secret = resolveTurnstileSecretKey();

  // Return MISCONFIGURED without a network call when the secret is absent.
  // This produces one clear log line instead of a stream of opaque Cloudflare errors.
  if (!secret) {
    return { kind: "MISCONFIGURED" };
  }

  // Build form-encoded body per Cloudflare spec.
  const body = new URLSearchParams();
  body.set("secret", secret);
  body.set("response", token);
  if (remoteIp !== null) {
    body.set("remoteip", remoteIp);
  }

  try {
    const response = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      // Non-200 responses from Cloudflare indicate service issues.
      return {
        kind: "UNAVAILABLE",
        detail: `Siteverify returned HTTP ${response.status}`,
      };
    }

    let data: SiteverifyResponse;
    try {
      data = await response.json();
    } catch {
      return {
        kind: "UNAVAILABLE",
        detail: "Siteverify returned malformed JSON",
      };
    }

    if (data.success) {
      return { kind: "VALID" };
    }

    // Token was rejected. Carry error-codes for logging only.
    // These codes distinguish "token already redeemed" from "invalid secret",
    // which is information an attacker could use to probe configuration.
    // Never expose these in the response body.
    return {
      kind: "REJECTED",
      codes: data["error-codes"] ?? [],
    };
  } catch (error) {
    // Network errors and timeouts both surface here.
    if (error instanceof Error) {
      // AbortError from timeout has name "TimeoutError" or "AbortError"
      if (error.name === "TimeoutError" || error.name === "AbortError") {
        return {
          kind: "UNAVAILABLE",
          detail: "Siteverify request timed out",
        };
      }
      return {
        kind: "UNAVAILABLE",
        detail: error.message,
      };
    }
    return {
      kind: "UNAVAILABLE",
      detail: "Unknown error during siteverify request",
    };
  }
}
