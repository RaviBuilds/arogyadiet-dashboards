import { format } from "date-fns";
import { Truck } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { Badge } from "@/shared/components/ui/badge";
import type { ShippingInfo } from "@/types/kitShipping";
import {
  getShippingStatus,
  getCourierDisplayName,
} from "@/types/kitShipping";

/**
 * Shipping Tracker Component
 * 
 * Displays shipping and delivery information for KIT subscriptions.
 * Reusable component that can be embedded in various customer portal views.
 * 
 * Features:
 * - Courier partner name display
 * - Tracking number display
 * - Clickable tracking URL (for OTHER courier or generated URLs)
 * - Shipped and delivered timestamps
 * - Status badge with visual timeline
 * 
 * Requirements: 8.3
 * Task: 16.2
 */

interface ShippingTrackerProps {
  shippingInfo: ShippingInfo | null;
  className?: string;
}

/**
 * Generate tracking URL for known courier partners
 * For OTHER courier, uses the provided tracking_url
 * For known couriers, generates tracking URL based on tracking number
 */
function getTrackingUrl(shippingInfo: ShippingInfo): string | null {
  if (shippingInfo.tracking_url) {
    return shippingInfo.tracking_url;
  }

  // Generate tracking URLs for known courier partners
  switch (shippingInfo.courier_partner) {
    case 'APSRTC':
      return `https://apsrtcparcel.in/track/${shippingInfo.tracking_number}`;
    case 'TGSRTC':
      return `https://www.tsrtc.telangana.gov.in/track/${shippingInfo.tracking_number}`;
    case 'DTDC':
      return `https://www.dtdc.in/tracking.asp?tracking_no=${shippingInfo.tracking_number}`;
    default:
      return null;
  }
}

export function ShippingTracker({ shippingInfo, className }: ShippingTrackerProps) {
  // Shipping status
  const shippingStatus = shippingInfo ? getShippingStatus(shippingInfo) : 'Pending';
  const shippingStatusColor = 
    shippingStatus === 'Delivered' 
      ? 'bg-green-50 text-green-700 border-green-200'
      : shippingStatus === 'Shipped'
      ? 'bg-blue-50 text-blue-700 border-blue-200'
      : 'bg-amber-50 text-amber-700 border-amber-200';

  const trackingUrl = shippingInfo ? getTrackingUrl(shippingInfo) : null;

  return (
    <Card className={`border border-slate-200 bg-white shadow-sm ${className || ''}`}>
      <CardHeader className="border-b border-slate-100 bg-slate-50/50 px-6 py-4">
        <CardTitle className="text-base font-semibold text-slate-900 flex items-center gap-2">
          <Truck className="h-5 w-5 text-primary" />
          Shipping Information
        </CardTitle>
      </CardHeader>
      <CardContent className="p-6">
        {shippingInfo ? (
          <div className="space-y-6">
            {/* Status Badge */}
            <div className="flex items-center gap-3">
              <span className="text-sm text-slate-600">Status:</span>
              <Badge
                variant="outline"
                className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider ${shippingStatusColor}`}
              >
                {shippingStatus}
              </Badge>
            </div>

            {/* Shipping Details Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                  Courier Partner
                </p>
                <p className="text-sm font-semibold text-slate-900">
                  {getCourierDisplayName(shippingInfo.courier_partner)}
                </p>
              </div>

              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                  Tracking Number
                </p>
                <p className="text-sm font-mono font-semibold text-slate-900">
                  {shippingInfo.tracking_number}
                </p>
              </div>

              {shippingInfo.shipped_at && (
                <div className="space-y-1">
                  <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                    Shipped On
                  </p>
                  <p className="text-sm font-semibold text-slate-900">
                    {format(shippingInfo.shipped_at, "MMM do, yyyy")}
                  </p>
                </div>
              )}

              {shippingInfo.delivered_at && (
                <div className="space-y-1">
                  <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                    Delivered On
                  </p>
                  <p className="text-sm font-semibold text-slate-900">
                    {format(shippingInfo.delivered_at, "MMM do, yyyy")}
                  </p>
                </div>
              )}
            </div>

            {/* Tracking Link */}
            {trackingUrl && (
              <div className="pt-4 border-t border-slate-100">
                <a
                  href={trackingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
                >
                  <Truck className="h-4 w-4" />
                  Track Your Package
                </a>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-8">
            <div className="rounded-full bg-slate-100 p-4 w-16 h-16 mx-auto mb-4 flex items-center justify-center">
              <Truck className="h-8 w-8 text-slate-400" />
            </div>
            <p className="text-sm font-medium text-slate-900 mb-1">
              Shipping Information Pending
            </p>
            <p className="text-sm text-slate-500">
              Your order is being processed. Shipping details will appear here once
              your package has been dispatched.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
