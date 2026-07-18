"use client";

// src/shared/components/customer/MobilePinLoginForm.tsx
// Customer-portal mobile-first PIN login (customer-pin-auth, Task 6.2).
//
// This replaces the OTP login form with a PIN-based two-step login:
//   MOBILE step — single mobile-number field → "Next" calls checkEligibilityAction.
//   PIN step    — PinInput + "Sign in" button + "Forgot PIN?" link + "Back" button.
//                 On submit: verifyPinAction; handles OK/TEMP_PIN/INVALID/LOCKED/ERROR.
//
// No reference to OTP, SMS, or "Enter code" anywhere in this component.
//
// Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 1.5, 3.4, 8.1

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  Loader2,
  ArrowLeft,
  Lock,
  ShieldCheck,
  Sparkles,
  KeyRound,
} from "lucide-react";

import {
  checkEligibilityAction,
  verifyPinAction,
} from "@/actions/pinAuthActions";
import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardTitle,
} from "@/shared/components/ui/card";
import { PinInput } from "@/shared/components/customer/PinInput";
import { MobileNumberInput } from "@/shared/components/customer/MobileNumberInput";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Step = "MOBILE" | "PIN";
type MessageTone = "error" | "info";

interface StatusMessage {
  tone: MessageTone;
  text: string;
}

interface MobilePinLoginFormProps {
  /** Where to send the customer after a successful login. */
  redirectPath?: string;
  /** Called when temp PIN verified — parent handles navigation to set-new-pin. */
  onTempPin?: (mobile: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MobilePinLoginForm({
  redirectPath = "/dashboard",
  onTempPin,
}: MobilePinLoginFormProps) {
  const router = useRouter();

  const [step, setStep] = useState<Step>("MOBILE");
  const [mobile, setMobile] = useState("");
  const [pin, setPin] = useState("");
  const [message, setMessage] = useState<StatusMessage | null>(null);
  const [showForgotPinInfo, setShowForgotPinInfo] = useState(false);
  const [locked, setLocked] = useState(false);
  const [retrySeconds, setRetrySeconds] = useState<number | undefined>();

  const [isPending, startTransition] = useTransition();

  // ---- Step 1: submit mobile number --------------------------------------
  const handleCheckEligibility = (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);
    setShowForgotPinInfo(false);

    startTransition(async () => {
      const result = await checkEligibilityAction(mobile);

      switch (result.outcome) {
        case "ELIGIBLE":
          setStep("PIN");
          setMessage(null);
          break;
        case "NOT_ELIGIBLE":
          setMessage({ tone: "error", text: result.message });
          break;
      }
    });
  };

  // ---- Step 2: verify PIN ------------------------------------------------
  const handleVerifyPin = (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);
    setShowForgotPinInfo(false);

    startTransition(async () => {
      const result = await verifyPinAction(mobile, pin);

      switch (result.outcome) {
        case "OK":
          router.push(redirectPath);
          router.refresh();
          break;
        case "TEMP_PIN":
          if (onTempPin) {
            onTempPin(mobile);
          }
          break;
        case "INVALID":
          setMessage({ tone: "error", text: "Invalid PIN" });
          break;
        case "LOCKED":
          setLocked(true);
          setRetrySeconds(result.retryAfterSeconds);
          setMessage({
            tone: "error",
            text: result.retryAfterSeconds
              ? `Too many attempts. Please try again in ${Math.ceil(result.retryAfterSeconds / 60)} minute(s).`
              : "Too many attempts. Please try again later.",
          });
          break;
        case "ERROR":
          setMessage({ tone: "error", text: result.message });
          break;
      }
    });
  };

  // ---- Back to mobile entry ------------------------------------------------
  const handleBack = () => {
    setStep("MOBILE");
    setPin("");
    setMessage(null);
    setShowForgotPinInfo(false);
    setLocked(false);
    setRetrySeconds(undefined);
  };

  // ---- Forgot PIN ----------------------------------------------------------
  const handleForgotPin = () => {
    setShowForgotPinInfo(true);
    setMessage(null);
  };

  return (
    <div className="flex w-full max-w-[400px] flex-col gap-6">
      <Card className="relative overflow-hidden rounded-[28px] border border-white/60 bg-gradient-to-b from-white/85 to-white/70 py-0 shadow-[0_40px_80px_-30px_rgba(4,40,26,0.45),0_8px_24px_-12px_rgba(4,40,26,0.2)] ring-1 ring-emerald-900/5 backdrop-blur-xl sm:rounded-[32px]">
        {/* Single continuous wellness wash across the whole card (no seam). */}
        <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-emerald-200/40 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 -left-16 h-48 w-48 rounded-full bg-amber-100/40 blur-3xl" />
        {step === "MOBILE" ? (
          <>
            {/* Welcome — Hero Section */}
            <div className="relative px-7 pb-6 pt-9 sm:px-8">
              <div className="relative flex flex-col items-center gap-4 text-center">
                {/* Hidden on mobile: the page header already shows the logo
                    right above the card there, so repeating the wordmark inside
                    the card reads as duplication. On desktop the logo lives on
                    the separate left brand panel, so the card mark is shown. */}
                <div className="hidden lg:block">
                  <BrandMark />
                </div>
                <div className="space-y-1.5">
                  <CardTitle className="font-display text-[1.75rem] font-semibold leading-tight tracking-tight text-slate-900">
                    Welcome back
                  </CardTitle>
                  <CardDescription className="text-[0.95rem] text-slate-500">
                    Enter your registered mobile number to continue
                  </CardDescription>
                </div>
              </div>
            </div>

            <CardContent className="relative space-y-6 px-7 pb-8 pt-2 sm:px-8">
              <form onSubmit={handleCheckEligibility} className="space-y-6">
                <div className="space-y-2.5">
                  <label
                    htmlFor="mobile"
                    className="block text-center text-sm font-medium text-slate-600"
                  >
                    Mobile Number
                  </label>
                  <MobileNumberInput
                    id="mobile"
                    value={mobile}
                    onChange={setMobile}
                    disabled={isPending}
                    autoFocus
                    placeholder="00000 00000"
                  />
                </div>

                {message && (
                  <div
                    className={cn(
                      "rounded-xl border p-3 text-center text-sm font-medium",
                      message.tone === "error"
                        ? "border-red-200 bg-red-50 text-red-700"
                        : "border-blue-200 bg-blue-50 text-blue-700"
                    )}
                  >
                    {message.text}
                  </div>
                )}

                <Button
                  type="submit"
                  size="lg"
                  className={cn(
                    "group/cta relative h-13 w-full overflow-hidden rounded-2xl text-base font-semibold text-white transition-all duration-200",
                    "bg-gradient-to-br from-emerald-500 via-emerald-600 to-emerald-700 shadow-lg shadow-emerald-900/30",
                    "hover:-translate-y-0.5 hover:shadow-xl hover:shadow-emerald-900/40 active:translate-y-0",
                    "disabled:pointer-events-none disabled:translate-y-0 disabled:from-emerald-400 disabled:via-emerald-400 disabled:to-emerald-400 disabled:opacity-60 disabled:shadow-none"
                  )}
                  disabled={isPending || mobile.length < 10}
                >
                  {/* Subtle top sheen for a premium glassy CTA. */}
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent"
                  />
                  <span className="relative flex items-center justify-center">
                    {isPending ? (
                      <>
                        <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden="true" />
                        Verifying...
                      </>
                    ) : (
                      "Continue"
                    )}
                  </span>
                </Button>

                <TrustStrip />
              </form>
            </CardContent>
          </>
        ) : (
          <>
            {/* PIN Entry - Hero Section */}
            <div className="relative px-7 pb-6 pt-9 sm:px-8">
              <div className="relative flex flex-col items-center gap-4 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 shadow-lg shadow-emerald-900/20 ring-1 ring-white/40">
                  <Lock className="h-7 w-7 text-white" aria-hidden="true" />
                </div>
                <div className="space-y-1.5">
                  <CardTitle className="font-display text-[1.75rem] font-semibold leading-tight tracking-tight text-slate-900">
                    Enter your PIN
                  </CardTitle>
                  <CardDescription className="text-[0.95rem] text-slate-500">
                    {mobile}
                  </CardDescription>
                </div>
              </div>
            </div>

            <CardContent className="relative space-y-6 px-7 pb-8 pt-2 sm:px-8">
              <form onSubmit={handleVerifyPin} className="space-y-6">
                <div className="space-y-3">
                  <div className="text-center text-sm font-medium text-slate-600">
                    6-Digit PIN
                  </div>
                  <div className="flex justify-center py-1">
                    <PinInput
                      value={pin}
                      onChange={setPin}
                      disabled={isPending || locked}
                    />
                  </div>
                  {pin.length > 0 && pin.length < 6 && (
                    <p className="text-center text-xs text-slate-400">
                      {6 - pin.length} digit{pin.length !== 5 ? "s" : ""} remaining
                    </p>
                  )}
                </div>

                {message && (
                  <div
                    className={cn(
                      "rounded-xl border p-3 text-center text-sm font-medium",
                      message.tone === "error"
                        ? "border-red-200 bg-red-50 text-red-700"
                        : "border-blue-200 bg-blue-50 text-blue-700"
                    )}
                  >
                    {message.text}
                  </div>
                )}

                {showForgotPinInfo && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-center text-sm text-amber-800">
                    Please contact admin to reset your PIN
                  </div>
                )}

                <div className="space-y-3">
                  <Button
                    type="submit"
                    size="lg"
                    className={cn(
                      "group/cta relative h-13 w-full overflow-hidden rounded-2xl text-base font-semibold text-white transition-all duration-200",
                      "bg-gradient-to-br from-emerald-500 via-emerald-600 to-emerald-700 shadow-lg shadow-emerald-900/30",
                      "hover:-translate-y-0.5 hover:shadow-xl hover:shadow-emerald-900/40 active:translate-y-0",
                      "disabled:pointer-events-none disabled:translate-y-0 disabled:from-emerald-400 disabled:via-emerald-400 disabled:to-emerald-400 disabled:opacity-60 disabled:shadow-none"
                    )}
                    disabled={isPending || locked || pin.length !== 6}
                  >
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent"
                    />
                    <span className="relative flex items-center justify-center">
                      {isPending ? (
                        <>
                          <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden="true" />
                          Signing in...
                        </>
                      ) : (
                        "Sign in"
                      )}
                    </span>
                  </Button>

                  <Button
                    type="button"
                    variant="ghost"
                    size="lg"
                    className="h-11 w-full rounded-2xl text-sm font-medium text-slate-500 hover:bg-emerald-50 hover:text-emerald-700"
                    onClick={handleForgotPin}
                    disabled={isPending}
                  >
                    Forgot PIN?
                  </Button>
                </div>

                <div className="flex items-center justify-center border-t border-slate-100 pt-4">
                  <Button
                    type="button"
                    variant="link"
                    className="text-sm font-medium text-slate-500 hover:text-emerald-700"
                    onClick={handleBack}
                    disabled={isPending}
                  >
                    <ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden="true" />
                    Change number
                  </Button>
                </div>
              </form>
            </CardContent>
          </>
        )}
      </Card>
    </div>
  );
}

/**
 * BrandMark — the login card's focal icon. Replaces the generic phone glyph
 * with the actual ArogyaDiet leaf/apple mark (logo without wordmark), set in a
 * soft gradient "wellness token" container with a faint glow ring so it reads
 * as a premium brand moment rather than a stock icon.
 */
function BrandMark() {
  return (
    <div className="relative">
      {/* soft outer glow */}
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 scale-125 rounded-[22px] bg-emerald-400/25 blur-xl"
      />
      {/* The logo (Logo-arogya.jpeg) has its own opaque background, so it fills
          the container edge-to-edge as a rounded "app-icon" badge — no light
          padding framing a dark square (box-in-a-box). A white ring + emerald
          glow keep it feeling premium against the glass card. */}
      <div className="h-[72px] w-[72px] overflow-hidden rounded-[22px] shadow-[0_12px_30px_-10px_rgba(4,40,26,0.45)] ring-1 ring-white/70">
        <Image
          src="/Logo-arogya.jpeg"
          alt="ArogyaDiet"
          width={72}
          height={72}
          priority
          className="h-full w-full object-cover"
        />
      </div>
    </div>
  );
}

/**
 * TrustStrip — replaces the previous single small caption with a premium,
 * legible row of trust signals. Purely presentational (no claims about
 * backend behaviour beyond what already exists — PIN auth + OTP-based
 * eligibility already encrypt data in transit).
 */
function TrustStrip() {
  const items = [
    { icon: ShieldCheck, label: "Secure login" },
    { icon: KeyRound, label: "PIN verified" },
    { icon: Sparkles, label: "Privacy protected" },
  ];

  return (
    <div className="flex items-center justify-center gap-4 pt-1 sm:gap-5">
      {items.map(({ icon: Icon, label }) => (
        <div
          key={label}
          className="flex items-center gap-1.5 text-xs font-medium text-slate-500"
        >
          <Icon className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" />
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}
