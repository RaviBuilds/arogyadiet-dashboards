"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/shared/components/ui/button";
import { TrackingHero } from "@/shared/components/customer/tracking/TrackingHero";
import { TrackingMapPanel } from "@/shared/components/customer/tracking/TrackingMapPanel";
import { RiderProfileCard } from "@/shared/components/customer/tracking/RiderProfileCard";
import { DeliveryAddressCard } from "@/shared/components/customer/tracking/DeliveryAddressCard";
import { TrackingJourneyProgress } from "@/shared/components/customer/tracking/TrackingJourneyProgress";
import {
  BreakfastPreviewCard,
  type AddonProductLine,
} from "@/shared/components/customer/tracking/BreakfastPreviewCard";

type DeliveryOrder = {
  id: string;
  status: string;
  assigned_rider_id: string | null;
};

// A rider ping older than this is treated as "stale" for the live pulse /
// freshness copy — purely a UI signal, the underlying realtime subscription
// in LiveTrackingMap keeps running regardless.
const FRESH_WINDOW_MS = 45_000;

function formatSecondsAgo(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `Updated ${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  return `Updated ${minutes}m ago`;
}

function formatStatus(status: string) {
  if (status === "OUT_FOR_DELIVERY") return "Out for delivery";
  if (status === "REACHING_TO_LOCATION") return "Rider is arriving";
  if (status === "ASSIGNED") return "Rider assigned";
  if (status === "DELIVERED") return "Delivered";
  return "Preparing...";
}

export default function LiveTrackingClient({
  order,
  riderName,
  riderPhone,
  riderAvatar,
  addressString,
  addressTag,
  customerName,
  customerLat,
  customerLng,
  mealName,
  addons,
}: {
  order: DeliveryOrder;
  riderName: string;
  riderPhone: string | null;
  riderAvatar: string | null;
  addressString: string;
  addressTag: string | null;
  customerName: string | null;
  customerLat?: number;
  customerLng?: number;
  mealName: string | null;
  addons: AddonProductLine[];
}) {
  const [etaText, setEtaText] = useState<string | null>(null);
  const [distanceText, setDistanceText] = useState<string | null>(null);
  const [lastUpdateAt, setLastUpdateAt] = useState<number | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());

  // Tick every few seconds so "Updated Xs ago" stays fresh without needing
  // a new location ping — purely a display clock.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 3000);
    return () => clearInterval(id);
  }, []);

  const handleLocationUpdate = useCallback(() => {
    setLastUpdateAt(Date.now());
  }, []);

  const ageMs = lastUpdateAt != null ? now - lastUpdateAt : null;
  const isLocationFresh = ageMs != null && ageMs < FRESH_WINDOW_MS;
  const freshnessText = lastUpdateAt != null ? formatSecondsAgo(ageMs!) : null;

  const canTrack =
    order.status === "OUT_FOR_DELIVERY" || order.status === "REACHING_TO_LOCATION";

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-24 sm:space-y-6 lg:pb-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button asChild variant="outline" size="icon" className="shrink-0 rounded-full">
          <Link href="/meals">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <h1 className="text-lg font-semibold text-slate-900 sm:text-xl">Live Tracking</h1>
      </div>

      <TrackingHero
        status={order.status}
        hasRiderAssigned={Boolean(order.assigned_rider_id)}
        isLocationFresh={isLocationFresh}
        freshnessText={freshnessText}
      />

      {/* Mobile: map first. Desktop: map is the wide right column. */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_1.7fr] lg:gap-6 lg:items-start">
        {/* Map — first in DOM so it's first on mobile; reordered on desktop */}
        <div className="order-1 lg:order-2">
          <TrackingMapPanel
            riderId={order.assigned_rider_id}
            orderStatus={order.status}
            customerLat={customerLat}
            customerLng={customerLng}
            etaText={etaText}
            distanceText={distanceText}
            isLocationFresh={isLocationFresh}
            onEtaChange={setEtaText}
            onDistanceChange={setDistanceText}
            onLocationUpdate={handleLocationUpdate}
          />
        </div>

        {/* Info cards */}
        <div className="order-2 space-y-4 lg:order-1">
          {/* Rider card hidden on mobile inside this column — it reappears as
              the sticky bottom action bar instead (thumb-friendly, always
              visible Call button per the mobile spec). */}
          <div className="hidden sm:block">
            <RiderProfileCard
              riderName={riderName}
              riderPhone={riderPhone}
              riderAvatar={riderAvatar}
              statusLabel={formatStatus(order.status)}
              isLocationFresh={isLocationFresh}
              showLiveBadge={canTrack}
            />
          </div>

          <BreakfastPreviewCard mealName={mealName} addons={addons} />

          <DeliveryAddressCard
            addressTag={addressTag}
            customerName={customerName}
            addressString={addressString}
          />

          <TrackingJourneyProgress status={order.status} />
        </div>
      </div>

      {/* Mobile sticky bottom action bar — rider identity + large Call CTA,
          always reachable with a thumb regardless of scroll position. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 p-3 shadow-[0_-8px_30px_-12px_rgba(15,23,42,0.15)] backdrop-blur-md sm:hidden">
        <MobileRiderBar
          riderName={riderName}
          riderPhone={riderPhone}
          riderAvatar={riderAvatar}
          statusLabel={formatStatus(order.status)}
          isLocationFresh={isLocationFresh}
          showLiveBadge={canTrack}
        />
      </div>
    </div>
  );
}

function MobileRiderBar({
  riderName,
  riderPhone,
  riderAvatar,
  statusLabel,
  isLocationFresh,
  showLiveBadge,
}: {
  riderName: string;
  riderPhone: string | null;
  riderAvatar: string | null;
  statusLabel: string;
  isLocationFresh: boolean;
  showLiveBadge: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-full border-2 border-emerald-100 bg-emerald-50">
        {riderAvatar ? (
          <Image src={riderAvatar} alt={riderName} fill sizes="44px" className="object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-emerald-500">
            <RiderGlyph />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-slate-900">{riderName}</p>
        <div className="flex items-center gap-1.5 text-xs text-slate-500">
          <span className="relative flex h-1.5 w-1.5 shrink-0">
            <span
              className={
                showLiveBadge && isLocationFresh
                  ? "absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"
                  : undefined
              }
            />
            <span
              className={`relative inline-flex h-1.5 w-1.5 rounded-full ${
                showLiveBadge && isLocationFresh ? "bg-emerald-500" : "bg-slate-300"
              }`}
            />
          </span>
          <span className="truncate">{statusLabel}</span>
        </div>
      </div>
      {riderPhone ? (
        <a
          href={`tel:${riderPhone}`}
          className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground shadow-sm active:scale-[0.98]"
        >
          <PhoneGlyph /> Call
        </a>
      ) : (
        <span className="inline-flex h-12 shrink-0 cursor-not-allowed items-center justify-center gap-2 rounded-xl bg-slate-100 px-5 text-sm font-bold text-slate-400">
          <PhoneGlyph /> Call
        </span>
      )}
    </div>
  );
}

function RiderGlyph() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8" />
    </svg>
  );
}

function PhoneGlyph() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.362 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}
