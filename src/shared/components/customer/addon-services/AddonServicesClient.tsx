"use client";

// src/shared/components/customer/addon-services/AddonServicesClient.tsx
//
// Client interactive component for the Add-on Services page. Renders a
// responsive grid of requestable wellness services and the customer's
// previously submitted requests with status badges.
//
// Requirements: 11.1, 11.2, 11.3, 11.4, 15.5

import { useMemo, useState } from "react";
import Image from "next/image";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";
import {
  Loader2,
  HeartPulse,
  Sparkles,
  Activity,
  ListChecks,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/shared/components/ui/badge";
import { Card, CardContent } from "@/shared/components/ui/card";
import { requestAddonServiceAction } from "@/actions/addonServiceActions";
import { cn } from "@/lib/utils";
import type {
  AddonServiceRequest,
  AddonServiceStatus,
} from "@/types/accommodation";

interface AvailableService {
  type: string;
  name: string;
  description: string; // max 150 chars (Req 11.1)
  icon: LucideIcon;
  /** Visual tone — mirrors the dashboard's colour-coded quick-link cards
   *  (blue/purple/amber) so each service reads distinctly at a glance
   *  instead of every card looking identical. */
  tone: "coral" | "purple" | "green";
  /** Real photography shown full-clarity in its own band at the top of the
   *  card (not smeared behind text — see TONE_STYLES comment below). */
  bgImage: string;
}

const TONE_STYLES: Record<
  AvailableService["tone"],
  { chipBg: string; chipText: string; ring: string }
> = {
  coral: {
    chipBg: "bg-primary/10",
    chipText: "text-primary",
    ring: "hover:border-primary/30",
  },
  purple: {
    chipBg: "bg-purple-100",
    chipText: "text-purple-600",
    ring: "hover:border-purple-200",
  },
  green: {
    chipBg: "bg-emerald-100",
    chipText: "text-emerald-600",
    ring: "hover:border-emerald-200",
  },
};

/** Real photography deserves a zone of its own — a photo faded down to a
 *  smear behind text never reads as premium, it reads as a rendering
 *  glitch. Same lesson TodayFocusCard already applies to meal photography:
 *  full-clarity image in its own band, gradient only where it meets the
 *  content below. */

const AVAILABLE_SERVICES: AvailableService[] = [
  {
    type: "THERAPY",
    name: "Therapy Session",
    description:
      "One-on-one wellness therapy session with our certified therapist.",
    icon: HeartPulse,
    tone: "coral",
    bgImage: "/Therapy%20Session.jpg",
  },
  {
    type: "MASSAGE",
    name: "Ayurvedic Massage",
    description:
      "Traditional Ayurvedic massage for relaxation and rejuvenation.",
    icon: Sparkles,
    tone: "purple",
    bgImage: "/Ayurvedic%20massage.jpg",
  },
  {
    type: "YOGA",
    name: "Private Yoga Session",
    description:
      "Personalized yoga session tailored to your wellness goals.",
    icon: Activity,
    tone: "green",
    bgImage: "/Private%20Yoga%20Session.jpg",
  },
];

const STATUS_BADGE_STYLES: Record<AddonServiceStatus, string> = {
  PENDING: "border-amber-200 bg-amber-50 text-amber-700",
  CONFIRMED: "border-blue-200 bg-blue-50 text-blue-700",
  COMPLETED: "border-emerald-200 bg-emerald-50 text-emerald-700",
};

interface AddonServicesClientProps {
  customerProfileId: string | null;
  initialRequests: AddonServiceRequest[];
}

export function AddonServicesClient({
  customerProfileId,
  initialRequests,
}: AddonServicesClientProps) {
  const [requests, setRequests] =
    useState<AddonServiceRequest[]>(initialRequests);
  const [selectedService, setSelectedService] =
    useState<AvailableService | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Requests are already sorted desc by the repository, but re-sort
  // defensively so any locally-appended entry lands in the right spot.
  const sortedRequests = useMemo(
    () =>
      [...requests].sort(
        (a, b) =>
          new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime()
      ),
    [requests]
  );

  async function handleRequest(service: AvailableService) {
    setSelectedService(service);
    setSubmitting(true);

    const result = await requestAddonServiceAction({
      serviceType: service.type,
    });

    if ("success" in result && result.success) {
      toast.success("Request submitted successfully.");
      setRequests((prev) => [
        {
          id: result.data.requestId,
          customerProfileId: customerProfileId ?? "",
          stayEntryId: "",
          serviceType: service.type,
          status: "PENDING",
          requestedAt: new Date().toISOString(),
        },
        ...prev,
      ]);
      // Clear selection only on success — on failure we keep it so the
      // customer can retry without re-selecting (Req 11.4).
      setSelectedService(null);
    } else {
      const message =
        "error" in result ? result.error : "Failed to submit service request.";
      toast.error(message);
    }

    setSubmitting(false);
  }

  return (
    <div className="space-y-6 sm:space-y-8">
      <div
        className="reveal-rise grid grid-cols-1 gap-4 sm:gap-5 md:grid-cols-3"
        style={{ ["--reveal-delay" as string]: "300ms" }}
      >
        {AVAILABLE_SERVICES.map((service) => {
          const Icon = service.icon;
          const tone = TONE_STYLES[service.tone];
          const isSelectedSubmitting =
            submitting && selectedService?.type === service.type;

          return (
            <Card
              key={service.type}
              className={cn(
                "group relative flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white py-0 shadow-sm transition-all duration-200 hover:-translate-y-1 hover:shadow-lg",
                tone.ring,
              )}
            >
              {/* Full-clarity photo band — its own zone, not smeared behind
                  text. The icon chip overlaps the photo/content seam so the
                  transition feels designed rather than accidental. */}
              <div className="relative h-44 w-full overflow-hidden">
                <Image
                  src={service.bgImage}
                  alt={service.name}
                  fill
                  sizes="(max-width: 768px) 100vw, 33vw"
                  className="object-cover transition-transform duration-300 group-hover:scale-105"
                />
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-white via-white/0 to-black/10" />
              </div>

              <CardContent className="relative flex flex-1 flex-col gap-3 p-5 pt-0 sm:p-6 sm:pt-0">
                <div
                  className={cn(
                    "-mt-7 flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border-4 border-white shadow-sm",
                    tone.chipBg,
                    tone.chipText,
                  )}
                >
                  <Icon className="h-6 w-6" />
                </div>
                <div className="flex-1">
                  <h3 className="text-base font-semibold text-slate-900">
                    {service.name}
                  </h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-slate-500">
                    {service.description}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleRequest(service)}
                  disabled={submitting || !customerProfileId}
                  className="group mt-1 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-all duration-200 hover:shadow-md hover:brightness-105 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
                >
                  {isSelectedSubmitting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      Request
                      <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                    </>
                  )}
                </button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div
        className="reveal-rise space-y-4"
        style={{ ["--reveal-delay" as string]: "550ms" }}
      >
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold tracking-tight text-slate-900">
            Your Requests
          </h2>
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
            {sortedRequests.length}
          </span>
        </div>

        {sortedRequests.length === 0 ? (
          <Card className="rounded-2xl border border-dashed border-slate-200 bg-white shadow-sm">
            <CardContent className="flex flex-col items-center gap-3 px-6 py-12 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                <ListChecks className="h-7 w-7" />
              </div>
              <p className="text-sm font-medium text-slate-600">
                No service requests submitted yet.
              </p>
              <p className="max-w-xs text-xs leading-relaxed text-slate-400">
                Pick a service above and it will show up here once requested.
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <ul className="divide-y divide-slate-100">
              {sortedRequests.map((request) => {
                const serviceMeta = AVAILABLE_SERVICES.find(
                  (s) => s.type === request.serviceType
                );
                const tone = serviceMeta
                  ? TONE_STYLES[serviceMeta.tone]
                  : TONE_STYLES.green;
                const Icon = serviceMeta?.icon ?? ListChecks;

                return (
                  <li
                    key={request.id}
                    className="flex items-center gap-3 px-5 py-4 transition-colors hover:bg-slate-50/60 sm:px-6"
                  >
                    <div
                      className={cn(
                        "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
                        tone.chipBg,
                        tone.chipText,
                      )}
                    >
                      <Icon className="h-[18px] w-[18px]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-900">
                        {serviceMeta?.name ?? request.serviceType}
                      </p>
                      <p className="text-xs text-slate-500">
                        {format(
                          parseISO(request.requestedAt),
                          "dd MMM yyyy, hh:mm a"
                        )}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider ${
                        STATUS_BADGE_STYLES[request.status]
                      }`}
                    >
                      {request.status}
                    </Badge>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}
