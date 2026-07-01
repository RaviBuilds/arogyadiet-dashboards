"use client";

// src/shared/components/customer/MobileOtpLoginForm.tsx
// Customer-portal mobile-first OTP login (customer-mobile-onboarding, Task 10.1).
//
// This is a CUSTOMER-SPECIFIC login leaf. It intentionally does NOT reuse the
// shared `login-form.tsx`, because that form is also mounted by the admin,
// rider, master, and franchise portals and still exposes email/password (and,
// for customer, Google OAuth). Reworking the shared form into an OTP flow would
// break those portals. Keeping this component separate satisfies Req 1.1/1.2/
// 1.3 (no signup link, no Google button, no email/password on the customer
// login) without touching the other portals.
//
// Flow (two steps):
//   MOBILE step — a single mobile-number field → "Next" calls requestOtpAction.
//                 Nothing else is shown (Req 2.1).
//   OTP step    — revealed only after the eligibility gate + a successful send;
//                 a 6-digit code field → "Verify" calls verifyOtpAction; on OK
//                 the client redirects to the customer dashboard (Req 2.4/2.6).
//                 A resend control applies the cooldown / lockout reported by
//                 the actions (Req 2.5/2.7/2.9/2.10).
//
// Layout: mobile-first, single column, capped at ~360px, no horizontal scroll
// (Req 15.1/15.4/15.5). Loading/disabled states mirror the existing portal
// patterns (Req 15.7/15.9).

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ArrowLeft } from "lucide-react";

import {
  requestOtpAction,
  resendOtpAction,
  verifyOtpAction,
  type RequestOtpActionResult,
} from "@/actions/mobileAuthActions";
import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import {
  Field,
  FieldGroup,
  FieldLabel,
} from "@/shared/components/ui/field";
import { Input } from "@/shared/components/ui/input";

/** Seconds to wait before the resend control becomes available again. */
const DEFAULT_RESEND_COOLDOWN_SECONDS = 30;

type Step = "MOBILE" | "OTP";
type MessageTone = "error" | "info";

interface StatusMessage {
  tone: MessageTone;
  text: string;
}

interface MobileOtpLoginFormProps {
  /** Where to send the customer after a verified login. */
  redirectPath?: string;
}

export function MobileOtpLoginForm({
  redirectPath = "/dashboard",
}: MobileOtpLoginFormProps) {
  const router = useRouter();

  const [step, setStep] = useState<Step>("MOBILE");
  const [mobile, setMobile] = useState("");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<StatusMessage | null>(null);
  const [locked, setLocked] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  const [isPending, startTransition] = useTransition();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ---- Cooldown countdown ------------------------------------------------
  const startCooldown = useCallback((seconds: number) => {
    setCooldown(seconds);
  }, []);

  useEffect(() => {
    if (cooldown <= 0) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }
    if (intervalRef.current) return;
    intervalRef.current = setInterval(() => {
      setCooldown((prev) => {
        if (prev <= 1) {
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [cooldown]);

  // ---- Shared handling of a send/resend result ---------------------------
  const applySendResult = useCallback(
    (result: RequestOtpActionResult) => {
      switch (result.outcome) {
        case "SENT":
          setStep("OTP");
          setLocked(false);
          setMessage({
            tone: "info",
            text: "We've sent a verification code to your mobile number.",
          });
          startCooldown(DEFAULT_RESEND_COOLDOWN_SECONDS);
          break;
        case "NOT_ELIGIBLE":
          setMessage({ tone: "error", text: result.message });
          break;
        case "THROTTLED":
          setLocked(result.status === "LOCKED");
          setMessage({ tone: "error", text: result.message });
          if (result.retryAfterSeconds !== undefined) {
            startCooldown(result.retryAfterSeconds);
          }
          break;
        case "SEND_FAILED":
          setMessage({ tone: "error", text: result.message });
          break;
      }
    },
    [startCooldown],
  );

  // ---- Step 1: submit mobile number --------------------------------------
  const handleRequestOtp = (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);
    startTransition(async () => {
      const result = await requestOtpAction(mobile);
      applySendResult(result);
    });
  };

  // ---- Resend --------------------------------------------------------------
  const handleResend = () => {
    if (cooldown > 0 || locked || isPending) return;
    setMessage(null);
    setCode("");
    startTransition(async () => {
      const result = await resendOtpAction(mobile);
      applySendResult(result);
    });
  };

  // ---- Step 2: verify OTP --------------------------------------------------
  const handleVerifyOtp = (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);
    startTransition(async () => {
      const result = await verifyOtpAction(mobile, code);
      switch (result.outcome) {
        case "OK":
          router.push(redirectPath);
          router.refresh();
          break;
        case "LOCKED":
          setLocked(true);
          setMessage({ tone: "error", text: result.message });
          if (result.retryAfterSeconds !== undefined) {
            startCooldown(result.retryAfterSeconds);
          }
          break;
        case "INVALID":
        case "EXPIRED":
          setMessage({ tone: "error", text: result.message });
          break;
      }
    });
  };

  // ---- Back to mobile entry ------------------------------------------------
  const handleChangeNumber = () => {
    setStep("MOBILE");
    setCode("");
    setMessage(null);
    setLocked(false);
    setCooldown(0);
  };

  const messageClassName =
    message?.tone === "error"
      ? "text-sm text-red-500 text-center font-medium"
      : "text-sm text-muted-foreground text-center";

  return (
    <div className="flex w-full max-w-[360px] flex-col gap-6">
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">
            {step === "MOBILE" ? "Sign in" : "Enter code"}
          </CardTitle>
          <CardDescription>
            {step === "MOBILE"
              ? "Enter your registered mobile number to continue."
              : `We sent a 6-digit code to ${mobile || "your mobile number"}.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {step === "MOBILE" ? (
            <form onSubmit={handleRequestOtp}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="mobile">Mobile number</FieldLabel>
                  <Input
                    id="mobile"
                    name="mobile"
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel"
                    autoFocus
                    placeholder="10-digit mobile number"
                    value={mobile}
                    onChange={(e) => setMobile(e.target.value)}
                    disabled={isPending}
                    required
                  />
                </Field>

                {message && <div className={messageClassName}>{message.text}</div>}

                <Field>
                  <Button type="submit" disabled={isPending || mobile.trim() === ""}>
                    {isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Sending...
                      </>
                    ) : (
                      "Next"
                    )}
                  </Button>
                </Field>
              </FieldGroup>
            </form>
          ) : (
            <form onSubmit={handleVerifyOtp}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="otp">Verification code</FieldLabel>
                  <Input
                    id="otp"
                    name="otp"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    autoFocus
                    maxLength={6}
                    placeholder="6-digit code"
                    className="text-center text-lg tracking-[0.5em]"
                    value={code}
                    onChange={(e) =>
                      setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                    }
                    disabled={isPending || locked}
                    required
                  />
                </Field>

                {message && <div className={messageClassName}>{message.text}</div>}

                <Field>
                  <Button
                    type="submit"
                    disabled={isPending || locked || code.length !== 6}
                  >
                    {isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Verifying...
                      </>
                    ) : (
                      "Verify & sign in"
                    )}
                  </Button>

                  <Button
                    type="button"
                    variant="ghost"
                    onClick={handleResend}
                    disabled={isPending || locked || cooldown > 0}
                  >
                    {cooldown > 0
                      ? `Resend code in ${cooldown}s`
                      : "Resend code"}
                  </Button>

                  <Button
                    type="button"
                    variant="link"
                    className="text-muted-foreground"
                    onClick={handleChangeNumber}
                    disabled={isPending}
                  >
                    <ArrowLeft className="mr-1 h-4 w-4" />
                    Change mobile number
                  </Button>
                </Field>
              </FieldGroup>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
