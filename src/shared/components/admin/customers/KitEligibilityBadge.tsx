"use client";

import React, { useEffect, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Badge } from "@/shared/components/ui/badge";
import { checkKitEligibilityAction } from "@/actions/admin-actions/kitLifecycleActions";
import type { KitEligibility } from "@/types/kitLifecycle";

interface KitEligibilityBadgeProps {
  customerProfileId: string;
  /** Called when admin clicks "Send New KIT" button */
  onSendNewKit?: () => void;
}

/**
 * KIT Eligibility Badge + "Send New KIT" button for the Customer 360 Dashboard.
 *
 * Fetches eligibility on mount via `checkKitEligibilityAction` and conditionally
 * renders the action button when the customer is eligible (expired or ≤5 days
 * remaining, no PENDING subscription exists).
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6
 */
export function KitEligibilityBadge({
  customerProfileId,
  onSendNewKit,
}: KitEligibilityBadgeProps) {
  const [eligibility, setEligibility] = useState<KitEligibility | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchEligibility() {
      setLoading(true);
      setError(null);

      try {
        const result = await checkKitEligibilityAction(customerProfileId);
        if (cancelled) return;

        if (result.success) {
          setEligibility(result.data);
        } else {
          setError(result.error);
        }
      } catch (err) {
        if (cancelled) return;
        setError("Failed to check eligibility.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchEligibility();

    return () => {
      cancelled = true;
    };
  }, [customerProfileId]);

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Checking eligibility…</span>
      </div>
    );
  }

  // Error state — don't render the button
  if (error || !eligibility) {
    return null;
  }

  // Not eligible — hide the button entirely (Requirements 3.3, 3.4, 3.5, 3.6)
  if (!eligibility.eligible) {
    return null;
  }

  // Eligible — show badge + "Send New KIT" button (Requirements 3.1, 3.2)
  return (
    <div className="flex items-center gap-3">
      {eligibility.reason === "expired" && (
        <Badge
          variant="outline"
          className="border-gray-300 text-gray-600 bg-gray-50"
        >
          KIT Expired
        </Badge>
      )}
      {eligibility.reason === "expiring_soon" && eligibility.daysRemaining != null && (
        <Badge
          variant="outline"
          className="border-amber-300 text-amber-700 bg-amber-50"
        >
          {eligibility.daysRemaining} day{eligibility.daysRemaining !== 1 ? "s" : ""} remaining
        </Badge>
      )}
      <Button
        size="sm"
        onClick={onSendNewKit}
        className="gap-2"
      >
        <Send className="h-4 w-4" />
        Send New KIT
      </Button>
    </div>
  );
}
