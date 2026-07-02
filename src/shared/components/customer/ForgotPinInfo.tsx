"use client";

// src/shared/components/customer/ForgotPinInfo.tsx
// Informational screen for the "Forgot PIN?" flow (customer-pin-auth, Task 6.4).
//
// This component instructs the customer to contact their clinic admin to get
// a new temporary PIN. There is NO self-service reset mechanism — no email,
// no SMS, no security questions (Requirement 8.3).
//
// Requirements: 8.1, 8.2, 8.3

import { Phone, ArrowLeft } from "lucide-react";

import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";

interface ForgotPinInfoProps {
  /** Called when the user clicks "Back to login". */
  onBack?: () => void;
}

export function ForgotPinInfo({ onBack }: ForgotPinInfoProps) {
  return (
    <div className="flex w-full max-w-[360px] flex-col gap-6">
      <Card>
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Phone className="h-6 w-6 text-muted-foreground" />
          </div>
          <CardTitle className="text-xl">Forgot your PIN?</CardTitle>
        </CardHeader>
        <CardContent className="text-center">
          <p className="text-sm text-muted-foreground">
            Please contact the admin at your clinic or call support to get a new
            temporary PIN. Once you receive your new PIN, come back and log in.
          </p>

          {onBack && (
            <Button
              type="button"
              variant="ghost"
              className="mt-6 w-full"
              onClick={onBack}
            >
              <ArrowLeft className="mr-1 h-4 w-4" />
              Back to login
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
