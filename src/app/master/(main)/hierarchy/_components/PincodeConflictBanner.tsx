"use client";

// src/app/master/(main)/hierarchy/_components/PincodeConflictBanner.tsx
// Presentational client leaf for the Master Hierarchy UI
// (multi-tenant-franchise spec — Task 13.5, Requirements 15.2, 15.3).
//
// Renders the OVERLAP-CONFLICT text returned by
// `assignPincodeToFranchiseClinic` — a message that names the duplicated
// pincode and every entity it maps to (Req 15.2) — as a dismissible warning
// banner so a conflicting franchise-setup pincode is surfaced immediately
// (Req 15.3). This component does NO data fetching: it is driven entirely by
// the `message` prop supplied by its parent (the ClinicWiringDialog).

import { useEffect, useState } from "react";
import { AlertTriangle, X } from "lucide-react";

import { Button } from "@/shared/components/ui/button";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/shared/components/ui/alert";

interface PincodeConflictBannerProps {
  /**
   * The overlap-conflict text (naming the pincode + mapped entities) returned
   * by `assignPincodeToFranchiseClinic`, or `null` when there is no conflict to
   * surface.
   */
  message: string | null;
  /** Optional notifier so the parent can clear its conflict state on dismiss. */
  onDismiss?: () => void;
}

export function PincodeConflictBanner({
  message,
  onDismiss,
}: PincodeConflictBannerProps) {
  // Track dismissal locally; re-surface whenever a new conflict message arrives.
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (message) setDismissed(false);
  }, [message]);

  if (!message || dismissed) return null;

  const handleDismiss = () => {
    setDismissed(true);
    onDismiss?.();
  };

  return (
    <Alert
      variant="destructive"
      className="border-amber-300 bg-amber-50 text-amber-900"
      role="alert"
      aria-live="assertive"
    >
      <AlertTriangle className="h-4 w-4 text-amber-600" />
      <AlertTitle>Pincode overlap conflict</AlertTitle>
      <AlertDescription className="text-amber-800">{message}</AlertDescription>
      <AlertAction>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-amber-700 hover:bg-amber-100 hover:text-amber-900"
          onClick={handleDismiss}
          aria-label="Dismiss conflict warning"
        >
          <X className="h-4 w-4" />
        </Button>
      </AlertAction>
    </Alert>
  );
}

export default PincodeConflictBanner;
