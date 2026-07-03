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
import { Loader2, ArrowLeft, Smartphone, Lock, ShieldCheck } from "lucide-react";

import {
  checkEligibilityAction,
  verifyPinAction,
} from "@/actions/pinAuthActions";
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

  const messageClassName =
    message?.tone === "error"
      ? "text-sm text-red-500 text-center font-medium"
      : "text-sm text-muted-foreground text-center";

  return (
    <div className="flex w-full max-w-[400px] flex-col gap-6">
      <Card className="shadow-lg">
        {step === "MOBILE" ? (
          <>
            {/* Mobile Number Entry - Hero Section */}
            <div className="relative overflow-hidden border-b bg-slate-50 px-6 py-10 dark:bg-slate-900">
              <div className="relative flex flex-col items-center gap-4 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white shadow-md ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700">
                  <Smartphone className="h-8 w-8 text-slate-700 dark:text-slate-300" />
                </div>
                <div className="space-y-1.5">
                  <CardTitle className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                    Welcome back
                  </CardTitle>
                  <CardDescription className="text-base text-slate-600 dark:text-slate-400">
                    Enter your mobile number to sign in
                  </CardDescription>
                </div>
              </div>
            </div>

            <CardContent className="p-6">
              <form onSubmit={handleCheckEligibility} className="space-y-6">
                <div className="space-y-3">
                  <div className="text-center text-sm font-semibold text-slate-700 dark:text-slate-300">
                    Mobile Number
                  </div>
                  <MobileNumberInput
                    id="mobile"
                    value={mobile}
                    onChange={setMobile}
                    disabled={isPending}
                    autoFocus
                    placeholder="0000000000"
                  />
                </div>

                {message && (
                  <div
                    className={cn(
                      "rounded-lg border p-3 text-center text-sm font-medium",
                      message.tone === "error"
                        ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/50 dark:text-red-400"
                        : "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/50 dark:bg-blue-950/50 dark:text-blue-400"
                    )}
                  >
                    {message.text}
                  </div>
                )}

                <Button
                  type="submit"
                  size="lg"
                  className={cn(
                    "h-12 w-full text-base font-semibold shadow-md transition-all duration-200",
                    "bg-primary hover:bg-primary/90 active:scale-[0.98]",
                    "disabled:opacity-50 disabled:cursor-not-allowed"
                  )}
                  disabled={isPending || mobile.length < 10}
                >
                  {isPending ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      Verifying...
                    </>
                  ) : (
                    "Continue"
                  )}
                </Button>

                <div className="flex items-center justify-center gap-2 pt-2 text-xs text-slate-500 dark:text-slate-400">
                  <ShieldCheck className="h-4 w-4" />
                  <span>Secure & encrypted login</span>
                </div>
              </form>
            </CardContent>
          </>
        ) : (
          <>
            {/* PIN Entry - Hero Section */}
            <div className="relative overflow-hidden border-b bg-slate-50 px-6 py-10 dark:bg-slate-900">
              <div className="relative flex flex-col items-center gap-4 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white shadow-md ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700">
                  <Lock className="h-8 w-8 text-slate-700 dark:text-slate-300" />
                </div>
                <div className="space-y-1.5">
                  <CardTitle className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                    Enter your PIN
                  </CardTitle>
                  <CardDescription className="text-base text-slate-600 dark:text-slate-400">
                    {mobile}
                  </CardDescription>
                </div>
              </div>
            </div>

            <CardContent className="p-6">
              <form onSubmit={handleVerifyPin} className="space-y-6">
                <div className="space-y-4">
                  <div className="text-center text-sm font-semibold text-slate-700 dark:text-slate-300">
                    6-Digit PIN
                  </div>
                  <div className="flex justify-center py-2">
                    <PinInput
                      value={pin}
                      onChange={setPin}
                      disabled={isPending || locked}
                    />
                  </div>
                  {pin.length > 0 && pin.length < 6 && (
                    <p className="text-center text-xs text-slate-500 dark:text-slate-400">
                      {6 - pin.length} digit{pin.length !== 5 ? 's' : ''} remaining
                    </p>
                  )}
                </div>

                {message && (
                  <div
                    className={cn(
                      "rounded-lg border p-3 text-center text-sm font-medium",
                      message.tone === "error"
                        ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/50 dark:text-red-400"
                        : "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/50 dark:bg-blue-950/50 dark:text-blue-400"
                    )}
                  >
                    {message.text}
                  </div>
                )}

                {showForgotPinInfo && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-center text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/50 dark:text-amber-400">
                    Please contact admin to reset your PIN
                  </div>
                )}

                <div className="space-y-3">
                  <Button
                    type="submit"
                    size="lg"
                    className={cn(
                      "h-12 w-full text-base font-semibold shadow-md transition-all duration-200",
                      "bg-primary hover:bg-primary/90 active:scale-[0.98]",
                      "disabled:opacity-50 disabled:cursor-not-allowed"
                    )}
                    disabled={isPending || locked || pin.length !== 6}
                  >
                    {isPending ? (
                      <>
                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                        Signing in...
                      </>
                    ) : (
                      "Sign in"
                    )}
                  </Button>

                  <Button
                    type="button"
                    variant="ghost"
                    size="lg"
                    className="h-11 w-full text-sm font-medium"
                    onClick={handleForgotPin}
                    disabled={isPending}
                  >
                    Forgot PIN?
                  </Button>
                </div>

                <div className="flex items-center justify-center border-t pt-4">
                  <Button
                    type="button"
                    variant="link"
                    className="text-sm font-medium text-slate-600 dark:text-slate-400"
                    onClick={handleBack}
                    disabled={isPending}
                  >
                    <ArrowLeft className="mr-1.5 h-4 w-4" />
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
