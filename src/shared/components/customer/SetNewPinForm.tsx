"use client";

// src/shared/components/customer/SetNewPinForm.tsx
// "Set New PIN" form for the temp-to-permanent PIN transition flow.
// Presented after a customer successfully logs in with a temporary PIN.
// Requirements: 2.4, 2.5, 2.7, 13.6, 13.7

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Loader2 } from "lucide-react";

import { setPermanentPinAction } from "@/actions/pinAuthActions";
import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardTitle,
} from "@/shared/components/ui/card";
import { PinInput } from "@/shared/components/customer/PinInput";
import { cn } from "@/lib/utils";

interface SetNewPinFormProps {
  /** The normalized mobile number (passed from parent). */
  mobile: string;
  /** Where to redirect after successful PIN set. Defaults to "/dashboard". */
  redirectPath?: string;
}

export function SetNewPinForm({
  mobile,
  redirectPath = "/dashboard",
}: SetNewPinFormProps) {
  const router = useRouter();

  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      const result = await setPermanentPinAction(mobile, newPin, confirmPin);

      switch (result.outcome) {
        case "OK":
          router.push(redirectPath);
          router.refresh();
          break;
        case "MISMATCH":
          setError("PINs do not match");
          break;
        case "INVALID_FORMAT":
          setError("PIN must be exactly 6 digits");
          break;
        case "ERROR":
          setError(result.message || "Something went wrong. Please try again.");
          break;
      }
    });
  };

  const isSubmitDisabled =
    isPending || newPin.length !== 6 || confirmPin.length !== 6;

  return (
    <div className="flex w-full max-w-[400px] flex-col gap-6">
      <Card className="relative overflow-hidden rounded-[28px] border border-white/60 bg-gradient-to-b from-white/85 to-white/70 py-0 shadow-[0_40px_80px_-30px_rgba(4,40,26,0.45),0_8px_24px_-12px_rgba(4,40,26,0.2)] ring-1 ring-emerald-900/5 backdrop-blur-xl sm:rounded-[32px]">
        {/* Single continuous wellness wash across the whole card (no seam),
            matching the login card's ambient styling. */}
        <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-emerald-200/40 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 -left-16 h-48 w-48 rounded-full bg-amber-100/40 blur-3xl" />

        {/* Hero section */}
        <div className="relative px-7 pb-6 pt-9 sm:px-8">
          <div className="relative flex flex-col items-center gap-4 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 shadow-lg shadow-emerald-900/20 ring-1 ring-white/40">
              <KeyRound className="h-7 w-7 text-white" aria-hidden="true" />
            </div>
            <div className="space-y-1.5">
              <CardTitle className="font-display text-[1.75rem] font-semibold leading-tight tracking-tight text-slate-900">
                Set New PIN
              </CardTitle>
              <CardDescription className="text-[0.95rem] text-slate-500">
                Choose a new PIN to continue. This will replace your temporary PIN.
              </CardDescription>
            </div>
          </div>
        </div>

        <CardContent className="relative space-y-6 px-7 pb-8 pt-2 sm:px-8">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-3">
              <div className="text-center text-sm font-medium text-slate-600">
                New PIN
              </div>
              <div className="flex justify-center py-1">
                <PinInput
                  id="new-pin"
                  value={newPin}
                  onChange={setNewPin}
                  disabled={isPending}
                  autoFocus
                  label="New PIN"
                />
              </div>
            </div>

            <div className="space-y-3">
              <div className="text-center text-sm font-medium text-slate-600">
                Confirm PIN
              </div>
              <div className="flex justify-center py-1">
                <PinInput
                  id="confirm-pin"
                  value={confirmPin}
                  onChange={setConfirmPin}
                  disabled={isPending}
                  autoFocus={false}
                  label="Confirm PIN"
                />
              </div>
            </div>

            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-center text-sm font-medium text-red-700">
                {error}
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
              disabled={isSubmitDisabled}
            >
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent"
              />
              <span className="relative flex items-center justify-center">
                {isPending ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden="true" />
                    Setting PIN...
                  </>
                ) : (
                  "Set PIN"
                )}
              </span>
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
