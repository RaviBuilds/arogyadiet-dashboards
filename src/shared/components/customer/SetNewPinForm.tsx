"use client";

// src/shared/components/customer/SetNewPinForm.tsx
// "Set New PIN" form for the temp-to-permanent PIN transition flow.
// Presented after a customer successfully logs in with a temporary PIN.
// Requirements: 2.4, 2.5, 2.7, 13.6, 13.7

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { setPermanentPinAction } from "@/actions/pinAuthActions";
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
import { PinInput } from "@/shared/components/customer/PinInput";

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
    <div className="flex w-full max-w-[360px] flex-col gap-6">
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Set New PIN</CardTitle>
          <CardDescription>
            Choose a new PIN to continue. This will replace your temporary PIN.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="new-pin">New PIN</FieldLabel>
                <PinInput
                  id="new-pin"
                  value={newPin}
                  onChange={setNewPin}
                  disabled={isPending}
                  autoFocus
                  label="New PIN"
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="confirm-pin">Confirm PIN</FieldLabel>
                <PinInput
                  id="confirm-pin"
                  value={confirmPin}
                  onChange={setConfirmPin}
                  disabled={isPending}
                  autoFocus={false}
                  label="Confirm PIN"
                />
              </Field>

              {error && (
                <div className="text-sm text-red-500 text-center font-medium">
                  {error}
                </div>
              )}

              <Field>
                <Button type="submit" disabled={isSubmitDisabled}>
                  {isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Setting PIN...
                    </>
                  ) : (
                    "Set PIN"
                  )}
                </Button>
              </Field>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
