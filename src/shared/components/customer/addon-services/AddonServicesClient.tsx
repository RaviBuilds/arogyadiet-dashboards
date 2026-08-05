"use client";

// src/shared/components/customer/addon-services/AddonServicesClient.tsx
//
// Client interactive component for the Add-on Services page. Renders a
// responsive grid of requestable wellness services and the customer's
// previously submitted requests with status badges.
//
// Requirements: 11.1, 11.2, 11.3, 11.4, 15.5

import { useMemo, useState, useTransition } from "react";
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
  X,
  BedDouble,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/components/ui/alert-dialog";
import {
  requestAddonServiceAction,
  cancelAddonServiceRequestAction,
} from "@/actions/addonServiceActions";
import { cn } from "@/lib/utils";
import {
  OPEN_ADDON_SERVICE_STATUSES,
  type AddonServiceRequest,
  type AddonServiceStatus,
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
  CANCELLED: "border-slate-200 bg-slate-50 text-slate-600",
};

function isOpenStatus(status: AddonServiceStatus): boolean {
  return OPEN_ADDON_SERVICE_STATUSES.includes(status);
}

interface AddonServicesClientProps {
  customerProfileId: string | null;
  initialRequests: AddonServiceRequest[];
  /** False once the stay has ended (checked out / no-show) — add-on
   *  services are only offered during an active stay. */
  hasActiveStay: boolean;
}

export function AddonServicesClient({
  customerProfileId,
  initialRequests,
  hasActiveStay,
}: AddonServicesClientProps) {
  const [requests, setRequests] =
    useState<AddonServiceRequest[]>(initialRequests);
  const [selectedService, setSelectedService] =
    useState<AvailableService | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<AddonServiceRequest | null>(
    null
  );
  const [isCancelling, startCancel] = useTransition();

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

  // The open (PENDING/CONFIRMED) request per service type, if any. Gating is
  // per service, NOT global: a pending Therapy Session locks only the Therapy
  // card, leaving Massage and Yoga freely requestable. This is what stops the
  // duplicate-request bug (clicking one card repeatedly used to create several
  // PENDING rows for the same service) without blocking the other services.
  const openRequestByService = useMemo(() => {
    const map = new Map<string, AddonServiceRequest>();
    for (const request of sortedRequests) {
      if (isOpenStatus(request.status) && !map.has(request.serviceType)) {
        map.set(request.serviceType, request);
      }
    }
    return map;
  }, [sortedRequests]);

  /** Every service the customer currently has an open request for. */
  const openRequests = useMemo(
    () => [...openRequestByService.values()],
    [openRequestByService]
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

  function handleCancelConfirmed() {
    if (!cancelTarget) return;
    const target = cancelTarget;

    startCancel(async () => {
      const result = await cancelAddonServiceRequestAction(target.id);

      if ("success" in result && result.success) {
        toast.success("Request cancelled.");
        setRequests((prev) =>
          prev.map((r) =>
            r.id === target.id ? { ...r, status: "CANCELLED" } : r
          )
        );
        setCancelTarget(null);
      } else {
        const message =
          "error" in result ? result.error : "Failed to cancel request.";
        toast.error(message);
      }
    });
  }

  return (
    <div className="space-y-6 sm:space-y-8">
      {!hasActiveStay && (
        <div
          className="reveal-rise flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4"
          style={{ ["--reveal-delay" as string]: "200ms" }}
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-200 text-slate-500">
            <BedDouble className="h-[18px] w-[18px]" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-700">
              Add-on services aren&apos;t available right now
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
              These wellness services can only be requested during an active
              stay. Once your stay has ended, new requests can&apos;t be
              placed.
            </p>
          </div>
        </div>
      )}

      {hasActiveStay && openRequests.length > 0 && (
        <div
          className="reveal-rise flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4"
          style={{ ["--reveal-delay" as string]: "200ms" }}
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-600">
            <ListChecks className="h-[18px] w-[18px]" />
          </div>
          <div>
            <p className="text-sm font-semibold text-amber-800">
              {openRequests.length === 1
                ? "You have a request in progress"
                : `You have ${openRequests.length} requests in progress`}
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-amber-700">
              {openRequests
                .map(
                  (r) =>
                    `${
                      AVAILABLE_SERVICES.find((s) => s.type === r.serviceType)
                        ?.name ?? r.serviceType
                    } (${r.status.toLowerCase()})`
                )
                .join(", ")}
              . Each of these can be requested again once it is completed or
              cancelled — the other services stay available.
            </p>
          </div>
        </div>
      )}

      <div
        className="reveal-rise grid grid-cols-1 gap-4 sm:gap-5 md:grid-cols-3"
        style={{ ["--reveal-delay" as string]: "300ms" }}
      >
        {AVAILABLE_SERVICES.map((service) => {
          const Icon = service.icon;
          const tone = TONE_STYLES[service.tone];
          const isSelectedSubmitting =
            submitting && selectedService?.type === service.type;
          // Only THIS service's own open request locks THIS card.
          const openForThisService = openRequestByService.get(service.type);

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
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-base font-semibold text-slate-900">
                      {service.name}
                    </h3>
                    {/* Surfaces the live status right on the card that has
                        the open request, so the customer doesn't need to
                        scroll down to "Your Requests" to know where it stands. */}
                    {openForThisService && (
                      <Badge
                        variant="outline"
                        className={cn(
                          "shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                          STATUS_BADGE_STYLES[openForThisService.status],
                        )}
                      >
                        {openForThisService.status}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1.5 text-sm leading-relaxed text-slate-500">
                    {service.description}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleRequest(service)}
                  disabled={
                    submitting ||
                    !customerProfileId ||
                    !hasActiveStay ||
                    !!openForThisService
                  }
                  title={
                    !hasActiveStay
                      ? "Available only during an active stay"
                      : openForThisService
                        ? `Your ${service.name} request is ${openForThisService.status.toLowerCase()} — you can request it again once it's completed or cancelled`
                        : undefined
                  }
                  className="group mt-1 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-all duration-200 hover:shadow-md hover:brightness-105 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
                >
                  {isSelectedSubmitting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : openForThisService ? (
                    "Request Submitted"
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
                const canCancel = isOpenStatus(request.status);

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
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge
                        variant="outline"
                        className={cn(
                          "rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider",
                          STATUS_BADGE_STYLES[request.status],
                        )}
                      >
                        {request.status}
                      </Badge>
                      {canCancel && (
                        <button
                          type="button"
                          onClick={() => setCancelTarget(request)}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
                          aria-label={`Cancel ${serviceMeta?.name ?? request.serviceType} request`}
                          title="Cancel request"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </div>

      <AlertDialog
        open={!!cancelTarget}
        onOpenChange={(open) => !open && setCancelTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this request?</AlertDialogTitle>
            <AlertDialogDescription>
              {cancelTarget &&
                `Your ${
                  AVAILABLE_SERVICES.find(
                    (s) => s.type === cancelTarget.serviceType
                  )?.name ?? cancelTarget.serviceType
                } request will be withdrawn. You can submit a new request right after.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isCancelling}>
              Keep Request
            </AlertDialogCancel>
            {/* A plain Button, not AlertDialogAction — same pattern as the
                address-delete dialog. AlertDialogAction closes the dialog on
                click, which would tear it down before a failed cancel could
                surface; this keeps it open until the action actually
                succeeds. */}
            <Button
              variant="destructive"
              onClick={handleCancelConfirmed}
              disabled={isCancelling}
            >
              {isCancelling ? "Cancelling..." : "Yes, cancel request"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
