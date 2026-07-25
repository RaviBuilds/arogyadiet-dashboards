import { format, parseISO } from "date-fns";
import { Truck, PackageCheck, Package, CheckCircle2, ExternalLink } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { cn } from "@/lib/utils";
import type { ShippingInfo } from "@/types/kitShipping";
import {
  getShippingStatus,
  getCourierDisplayName,
} from "@/types/kitShipping";

/**
 * Shipping Tracker Component
 *
 * Displays shipping and delivery information for KIT subscriptions as a
 * three-step journey (Packed → Shipped → Delivered) so the customer can see
 * where their kit is at a glance, in the same calm card language used across
 * the customer dashboard.
 *
 * Features:
 * - Visual progress rail with per-step timestamps
 * - Courier partner + tracking number
 * - Clickable tracking link (courier base page, or the provided URL for OTHER)
 * - Reassuring pending state before dispatch
 *
 * Requirements: 8.3
 */

interface ShippingTrackerProps {
  shippingInfo: ShippingInfo | null;
  /**
   * The date the customer themselves confirmed the kit arrived
   * (`subscriptions.kit_received_date`). Admins don't always fill in
   * `delivered_at`, so without this the rail keeps claiming the package is
   * "on the way" weeks after the customer started eating from it. Customer
   * confirmation is proof of delivery, so it completes the final step.
   */
  receivedOn?: string | null;
  className?: string;
}

/**
 * Generate tracking URL for known courier partners.
 * Only links to the courier's base tracking page — customer enters the
 * tracking number manually on the courier website.
 * For OTHER courier, uses the provided tracking_url as-is.
 */
function getTrackingUrl(shippingInfo: ShippingInfo): string | null {
  if (shippingInfo.tracking_url) {
    return shippingInfo.tracking_url;
  }

  // Base tracking page URLs — do NOT include the tracking number.
  // Verified against each courier's live site (2026-07-25):
  //   APSRTC  -> official ANL/door-to-door parcel tracking portal
  //   TGSRTC  -> official TGSRTC Logistics site (Track widget lives on this page)
  //   DTDC    -> official DTDC shipment tracking page
  switch (shippingInfo.courier_partner) {
    case "APSRTC":
      return `https://cargo.apsrtconline.in/track`;
    case "TGSRTC":
      return `https://tgsrtclogistics.co.in/TSRTC/`;
    case "DTDC":
      return `https://www.dtdc.com/track-your-shipment/`;
    default:
      return null;
  }
}

export function ShippingTracker({
  shippingInfo,
  receivedOn,
  className,
}: ShippingTrackerProps) {
  const confirmedByCustomer = Boolean(receivedOn && !shippingInfo?.delivered_at);
  const shippingStatus = confirmedByCustomer
    ? "Delivered"
    : shippingInfo
      ? getShippingStatus(shippingInfo)
      : "Pending";

  const trackingUrl = shippingInfo ? getTrackingUrl(shippingInfo) : null;

  // Three-step journey. `done` drives both the rail fill and the icon chip.
  const steps = [
    {
      icon: Package,
      label: "Packed with care",
      detail: shippingInfo
        ? format(shippingInfo.created_at, "MMM do, yyyy")
        : "Awaiting dispatch",
      done: true,
    },
    {
      icon: Truck,
      label: "Handed to courier",
      detail: shippingInfo?.shipped_at
        ? format(shippingInfo.shipped_at, "MMM do, yyyy")
        : confirmedByCustomer
          ? "Dispatched"
          : "Not shipped yet",
      done: Boolean(shippingInfo?.shipped_at) || confirmedByCustomer,
    },
    {
      icon: PackageCheck,
      label: "Delivered to you",
      detail: shippingInfo?.delivered_at
        ? format(shippingInfo.delivered_at, "MMM do, yyyy")
        : confirmedByCustomer
          ? `Confirmed by you · ${format(parseISO(receivedOn as string), "MMM do, yyyy")}`
          : "On the way",
      done: Boolean(shippingInfo?.delivered_at) || confirmedByCustomer,
    },
  ];

  const completedSteps = steps.filter((s) => s.done).length;
  const railProgress = ((completedSteps - 1) / (steps.length - 1)) * 100;

  const statusChip =
    shippingStatus === "Delivered"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : shippingStatus === "Shipped"
        ? "border-blue-200 bg-blue-50 text-blue-700"
        : "border-amber-200 bg-amber-50 text-amber-700";

  return (
    <Card
      className={cn(
        "overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm",
        className,
      )}
    >
      <CardHeader className="border-b border-slate-100 bg-emerald-50/40 px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-900">
            <Truck className="h-5 w-5 text-emerald-600" />
            Kit Delivery
          </CardTitle>
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wider",
              statusChip,
            )}
          >
            {shippingStatus === "Delivered" ? (
              <CheckCircle2 className="h-3.5 w-3.5" />
            ) : null}
            {shippingStatus}
          </span>
        </div>
      </CardHeader>

      <CardContent className="p-6">
        {/* Journey rail — three evenly spaced milestones */}
        <div className="relative">
          <div className="absolute left-0 right-0 top-5 h-1 rounded-full bg-slate-100" />
          <div
            className="journey-bar-anim absolute left-0 top-5 h-1 rounded-full bg-gradient-to-r from-emerald-400 to-emerald-500 transition-all duration-500"
            style={{ width: `${Math.max(0, railProgress)}%` }}
          />

          <ol className="relative grid grid-cols-3 gap-2">
            {steps.map((step, idx) => {
              const Icon = step.icon;
              return (
                <li
                  key={idx}
                  className={cn(
                    "flex flex-col items-center text-center",
                    idx === 0 && "items-start text-left",
                    idx === steps.length - 1 && "items-end text-right",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-11 w-11 items-center justify-center rounded-full ring-4 ring-white transition-colors",
                      step.done
                        ? "bg-emerald-500 text-white shadow-sm"
                        : "bg-slate-100 text-slate-400",
                    )}
                  >
                    <Icon className="h-5 w-5" />
                  </span>
                  <p
                    className={cn(
                      "mt-3 text-xs font-semibold leading-tight sm:text-sm",
                      step.done ? "text-slate-900" : "text-slate-500",
                    )}
                  >
                    {step.label}
                  </p>
                  <p className="mt-0.5 text-[11px] leading-tight text-slate-500">
                    {step.detail}
                  </p>
                </li>
              );
            })}
          </ol>
        </div>

        {shippingInfo ? (
          <div className="mt-7 space-y-5 border-t border-slate-100 pt-6">
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
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
                <p className="font-mono text-sm font-semibold text-slate-900">
                  {shippingInfo.tracking_number}
                </p>
              </div>
            </div>

            {trackingUrl ? (
              <a
                href={trackingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="group inline-flex w-fit items-center justify-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-5 py-2.5 text-sm font-semibold text-emerald-700 transition-all duration-200 hover:border-emerald-300 hover:bg-emerald-100 active:scale-[0.98]"
              >
                <Truck className="h-4 w-4" />
                Track your package
                <ExternalLink className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
              </a>
            ) : null}
          </div>
        ) : (
          <div className="mt-7 rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 p-5 text-center">
            <p className="text-sm font-semibold text-slate-900">
              Your kit is being prepared
            </p>
            <p className="mt-1 text-sm leading-relaxed text-slate-500">
              Tracking details will appear here the moment your package is
              dispatched. Nothing for you to do right now.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
