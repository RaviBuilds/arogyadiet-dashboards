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
import { Loader2, ArrowLeft } from "lucide-react";

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
    <div className="flex w-full max-w-[360px] flex-col gap-6">
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">
            {step === "MOBILE" ? "Sign in" : "Enter your PIN"}
          </CardTitle>
          <CardDescription>
            {step === "MOBILE"
              ? "Enter your registered mobile number to continue."
              : `Enter the 6-digit PIN for ${mobile || "your mobile number"}.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {step === "MOBILE" ? (
            <form onSubmit={handleCheckEligibility}>
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

                {message && (
                  <div className={messageClassName}>{message.text}</div>
                )}

                <Field>
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={isPending || mobile.trim() === ""}
                  >
                    {isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Checking...
                      </>
                    ) : (
                      "Next"
                    )}
                  </Button>
                </Field>
              </FieldGroup>
            </form>
          ) : (
            <form onSubmit={handleVerifyPin}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="pin">PIN</FieldLabel>
                  <PinInput
                    value={pin}
                    onChange={setPin}
                    disabled={isPending || locked}
                  />
                </Field>

                {message && (
                  <div className={messageClassName}>{message.text}</div>
                )}

                {showForgotPinInfo && (
                  <div className="text-sm text-muted-foreground text-center">
                    Please contact admin to reset your PIN.
                  </div>
                )}

                <Field>
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={isPending || locked || pin.length !== 6}
                  >
                    {isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Signing in...
                      </>
                    ) : (
                      "Sign in"
                    )}
                  </Button>

                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full"
                    onClick={handleForgotPin}
                    disabled={isPending}
                  >
                    Forgot PIN?
                  </Button>

                  <Button
                    type="button"
                    variant="link"
                    className="w-full text-muted-foreground"
                    onClick={handleBack}
                    disabled={isPending}
                  >
                    <ArrowLeft className="mr-1 h-4 w-4" />
                    Back
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
