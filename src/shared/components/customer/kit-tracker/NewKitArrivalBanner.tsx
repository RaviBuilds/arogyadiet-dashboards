"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { format, parseISO } from "date-fns";
import { Package, Truck, Loader2, ExternalLink } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Badge } from "@/shared/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { markKitReceivedAction } from "@/actions/kitLifecycleActions";

interface NewKitArrivalBannerProps {
  subscriptionId: string;
  courierPartner: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  shippedAt: string | null;
}

/**
 * Displays a notification banner when a new KIT has been shipped to the customer.
 * Shows shipping info + "Mark as KIT Received" button when shipped_at is set.
 * Shows "order being processed" message when no shipping info.
 *
 * Requirements: 5.2, 5.3, 5.4
 */
export function NewKitArrivalBanner({
  subscriptionId,
  courierPartner,
  trackingNumber,
  trackingUrl,
  shippedAt,
}: NewKitArrivalBannerProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>("");

  // If no shipping info (shipped_at is null), show processing message (Req 5.4)
  if (!shippedAt) {
    return (
      <div className="flex items-center justify-center min-h-[400px] px-4">
        <Card className="w-full max-w-md shadow-lg border-0">
          <CardHeader className="text-center pb-2 pt-8">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-100">
              <Package className="h-7 w-7 text-amber-600" />
            </div>
            <CardTitle className="text-xl">Order Being Processed</CardTitle>
            <p className="text-sm text-muted-foreground mt-2">
              Your new KIT order is being processed. You will be notified once
              it has been shipped.
            </p>
          </CardHeader>
        </Card>
      </div>
    );
  }

  // Shipped — show banner with tracking info and "Mark as KIT Received" button (Req 5.3)
  async function handleMarkReceived() {
    setIsLoading(true);
    setError("");

    const result = await markKitReceivedAction(subscriptionId);

    if (result.success) {
      router.refresh();
    } else {
      setError(result.error);
      setIsLoading(false);
    }
  }

  const courierLabel =
    courierPartner === "APSRTC"
      ? "APSRTC Logistics"
      : courierPartner === "TGSRTC"
        ? "TGSRTC Logistics"
        : courierPartner === "DTDC"
          ? "DTDC"
          : "Other Shipping";

  return (
    <div className="flex items-center justify-center min-h-[400px] px-4">
      <Card className="w-full max-w-md shadow-lg border-0">
        <CardHeader className="text-center pb-2 pt-8">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-blue-100">
            <Truck className="h-7 w-7 text-blue-600" />
          </div>
          <CardTitle className="text-xl">New KIT Has Been Sent</CardTitle>
          <p className="text-sm text-muted-foreground mt-2">
            Your new KIT is on the way! Mark it as received once it arrives.
          </p>
        </CardHeader>
        <CardContent className="space-y-4 px-6 pb-8 pt-4">
          {/* Shipping Details */}
          <div className="rounded-lg bg-muted/50 p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Courier</span>
              <Badge variant="secondary">{courierLabel}</Badge>
            </div>
            {trackingNumber && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  Tracking #
                </span>
                <span className="text-sm font-medium">{trackingNumber}</span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Shipped On</span>
              <span className="text-sm font-medium">
                {format(parseISO(shippedAt), "PPP")}
              </span>
            </div>
            {trackingUrl && (
              <div className="pt-1">
                <a
                  href={trackingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                >
                  Track Package <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}
          </div>

          {/* Error message */}
          {error && (
            <p className="text-sm text-destructive text-center" role="alert">
              {error}
            </p>
          )}

          {/* Mark as Received Button */}
          <Button
            className="w-full h-12 rounded-lg text-base font-semibold shadow-sm"
            onClick={handleMarkReceived}
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Marking...
              </>
            ) : (
              "Mark as KIT Received"
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
