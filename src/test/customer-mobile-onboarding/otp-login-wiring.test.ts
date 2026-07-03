// Integration test — Supabase phone-OTP send/verify + session establishment
// wiring through OtpLoginService (customer-mobile-onboarding, Task 11.2).
//
// SCOPE: external-service wiring, NOT policy. The pure OTP policy state machine
// is exhaustively covered by the property tests in src/lib/otp. Here we verify
// that OtpLoginService correctly bridges to the Supabase phone-OTP boundary:
//   - a permitted send calls `signInWithOtp` with the E.164 phone and
//     `shouldCreateUser: false` and reports SENT (Req 2.2).
//   - a verify calls `verifyOtp` with the E.164 phone, the submitted token, and
//     `type: "sms"`, and on success reports OK — i.e. the Supabase session is
//     established through the SSR server client (Req 2.4 / 3.3).
//   - a Supabase delivery failure reports SEND_FAILED and does NOT persist a
//     throttle mutation (no resend consumed — Req 2.8 commit contract).
//
// The external boundary is mocked: the Supabase client is injected as a fake
// (OtpLoginService accepts a `client` override), and the throttle repository is
// mocked with an in-memory record so no real Supabase/SMS call is made.
//
// Validates: Requirements 2.2, 2.4, 3.3

import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mock the throttle repository (service-role DB access) ──────────────────
// Keep an in-memory record keyed by mobile so the pure policy sees a realistic
// persisted state without touching Supabase.
const throttleStore = new Map<string, unknown>();

vi.mock("@/repositories/otpThrottleRepository", () => ({
  getThrottle: vi.fn(async (mobile: string) => throttleStore.get(mobile) ?? null),
  saveThrottle: vi.fn(async (mobile: string, state: unknown) => {
    throttleStore.set(mobile, state);
  }),
}));

// Guard: the real SSR server client must never be constructed in this test —
// we always inject a fake client. If it were called it would throw here.
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => {
    throw new Error("real Supabase server client must not be used in wiring test");
  }),
}));

import { requestOtp, verifyOtp } from "@/services/OtpLoginService";
import { getThrottle, saveThrottle } from "@/repositories/otpThrottleRepository";

// A canonical, valid 10-digit Indian mobile and its expected E.164 form.
const MOBILE = "9876543210";
const E164 = "+919876543210";

/** Build a fake Supabase client exposing only the phone-OTP surface used. */
function fakeSupabase(opts: {
  signInError?: unknown;
  verifyError?: unknown;
}) {
  const signInWithOtp = vi.fn(async () => ({
    error: opts.signInError ?? null,
  }));
  const verifyOtpFn = vi.fn(async () => ({
    data: opts.verifyError ? {} : { session: { access_token: "tok" } },
    error: opts.verifyError ?? null,
  }));
  return {
    client: { auth: { signInWithOtp, verifyOtp: verifyOtpFn } } as never,
    signInWithOtp,
    verifyOtpFn,
  };
}

beforeEach(() => {
  throttleStore.clear();
  vi.mocked(getThrottle).mockClear();
  vi.mocked(saveThrottle).mockClear();
});

describe("OtpLoginService ↔ Supabase phone-OTP wiring", () => {
  it("send: calls signInWithOtp with E.164 phone + shouldCreateUser:false and reports SENT (Req 2.2)", async () => {
    const sb = fakeSupabase({});

    const result = await requestOtp(MOBILE, sb.client);

    expect(result.status).toBe("SENT");
    expect(sb.signInWithOtp).toHaveBeenCalledTimes(1);
    expect(sb.signInWithOtp).toHaveBeenCalledWith({
      phone: E164,
      options: { shouldCreateUser: false },
    });
    // A confirmed send commits the throttle state exactly once.
    expect(saveThrottle).toHaveBeenCalledTimes(1);
  });

  it("verify: calls verifyOtp with E.164 phone/token/type:sms and reports OK — session established (Req 2.4, 3.3)", async () => {
    const sb = fakeSupabase({});

    // Realistic flow: a passcode must be sent (opening the validity window)
    // before it can be verified.
    await requestOtp(MOBILE, sb.client);
    const result = await verifyOtp(MOBILE, "123456", sb.client);

    expect(result.status).toBe("OK");
    expect(sb.verifyOtpFn).toHaveBeenCalledTimes(1);
    expect(sb.verifyOtpFn).toHaveBeenCalledWith({
      phone: E164,
      token: "123456",
      type: "sms",
    });
  });

  it("verify: a Supabase mismatch reports INVALID without establishing a session (Req 2.4)", async () => {
    const sb = fakeSupabase({ verifyError: { message: "invalid otp" } });

    await requestOtp(MOBILE, sb.client);
    const result = await verifyOtp(MOBILE, "000000", sb.client);

    expect(result.status).toBe("INVALID");
    expect(sb.verifyOtpFn).toHaveBeenCalledTimes(1);
  });

  it("send: a Supabase delivery failure reports SEND_FAILED and consumes no resend (Req 2.8 commit contract)", async () => {
    const sb = fakeSupabase({ signInError: { message: "sms gateway down" } });

    const result = await requestOtp(MOBILE, sb.client);

    expect(result.status).toBe("SEND_FAILED");
    expect(sb.signInWithOtp).toHaveBeenCalledTimes(1);
    // No throttle mutation is persisted on a delivery failure.
    expect(saveThrottle).not.toHaveBeenCalled();
  });
});
