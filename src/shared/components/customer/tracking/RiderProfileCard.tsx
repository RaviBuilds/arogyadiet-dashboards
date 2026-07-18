"use client";

import Image from "next/image";
import { Bike, Phone, User } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * RiderProfileCard — the premium "who's bringing my breakfast" card.
 *
 * Only renders fields backed by real data already fetched by the page
 * (name, phone, avatar, status). Rating / completed-deliveries-today /
 * vehicle are NOT rendered — those fields don't exist on rider_profiles /
 * users today (verified against the schema), so per "never invent fake
 * data" they're simply omitted rather than faked. Message button is a
 * disabled placeholder for a future feature, exactly as requested.
 */
export function RiderProfileCard({
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
    <div className="reveal-rise rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
        Your Delivery Partner
      </p>

      <div className="mt-4 flex items-center gap-4">
        <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-full border-2 border-emerald-100 bg-emerald-50 shadow-sm">
          {riderAvatar ? (
            <Image src={riderAvatar} alt={riderName} fill className="object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <User className="h-7 w-7 text-emerald-500" />
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="truncate text-lg font-bold leading-tight text-slate-900">
            {riderName}
          </h3>
          <div className="mt-1 flex items-center gap-1.5 text-sm font-medium text-slate-500">
            {showLiveBadge ? (
              <span className="relative flex h-2 w-2 shrink-0">
                <span
                  className={cn(
                    "absolute inline-flex h-full w-full rounded-full opacity-75",
                    isLocationFresh && "animate-ping bg-emerald-400",
                  )}
                />
                <span
                  className={cn(
                    "relative inline-flex h-2 w-2 rounded-full",
                    isLocationFresh ? "bg-emerald-500" : "bg-slate-300",
                  )}
                />
              </span>
            ) : (
              <Bike className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            )}
            <span className="truncate">{statusLabel}</span>
          </div>
        </div>
      </div>

      <div className="mt-5 flex gap-2.5">
        {riderPhone ? (
          <a
            href={`tel:${riderPhone}`}
            className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-primary text-sm font-bold text-primary-foreground shadow-sm transition-all duration-200 hover:shadow-md hover:brightness-105 active:scale-[0.98]"
          >
            <Phone className="h-4 w-4" /> Call Rider
          </a>
        ) : (
          <span className="inline-flex h-12 flex-1 cursor-not-allowed items-center justify-center gap-2 rounded-xl bg-slate-100 text-sm font-bold text-slate-400">
            <Phone className="h-4 w-4" /> Call Rider
          </span>
        )}

        {/* Future placeholder — messaging isn't implemented yet. */}
        <button
          type="button"
          disabled
          title="Coming soon"
          className="inline-flex h-12 w-12 shrink-0 cursor-not-allowed items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-300"
        >
          <MessageGlyph />
        </button>
      </div>
    </div>
  );
}

function MessageGlyph() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}
