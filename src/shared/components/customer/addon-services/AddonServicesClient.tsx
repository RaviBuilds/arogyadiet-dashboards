"use client";

// src/shared/components/customer/addon-services/AddonServicesClient.tsx
//
// Client interactive component for the Add-on Services page. Renders a
// responsive grid of requestable wellness services and the customer's
// previously submitted requests with status badges.
//
// Requirements: 11.1, 11.2, 11.3, 11.4, 15.5

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";
import {
  Loader2,
  HeartPulse,
  Sparkles,
  Activity,
  ClipboardList,
  ListChecks,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/shared/components/ui/button";
import { Badge } from "@/shared/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/shared/components/ui/card";
import { requestAddonServiceAction } from "@/actions/addonServiceActions";
import type {
  AddonServiceRequest,
  AddonServiceStatus,
} from "@/types/accommodation";

interface AvailableService {
  type: string;
  name: string;
  description: string; // max 150 chars (Req 11.1)
  icon: LucideIcon;
}

const AVAILABLE_SERVICES: AvailableService[] = [
  {
    type: "THERAPY",
    name: "Therapy Session",
    description:
      "One-on-one wellness therapy session with our certified therapist.",
    icon: HeartPulse,
  },
  {
    type: "MASSAGE",
    name: "Ayurvedic Massage",
    description:
      "Traditional Ayurvedic massage for relaxation and rejuvenation.",
    icon: Sparkles,
  },
  {
    type: "YOGA",
    name: "Private Yoga Session",
    description:
      "Personalized yoga session tailored to your wellness goals.",
    icon: Activity,
  },
  {
    type: "CONSULTATION",
    name: "Nutrition Consultation",
    description: "One-on-one consultation with our nutrition expert.",
    icon: ClipboardList,
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
    <div className="space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {AVAILABLE_SERVICES.map((service) => {
          const Icon = service.icon;
          const isSelectedSubmitting =
            submitting && selectedService?.type === service.type;

          return (
            <Card key={service.type} className="flex flex-col">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="rounded-full bg-primary/10 p-2 text-primary shrink-0">
                    <Icon className="size-5" />
                  </div>
                  <CardTitle className="text-base">{service.name}</CardTitle>
                </div>
                <CardDescription>{service.description}</CardDescription>
              </CardHeader>
              <CardContent className="mt-auto">
                <Button
                  onClick={() => handleRequest(service)}
                  disabled={submitting || !customerProfileId}
                  className="min-h-11 w-full"
                >
                  {isSelectedSubmitting && (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  )}
                  Request
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ListChecks className="size-5 text-primary" />
            Your Requests
          </CardTitle>
          <CardDescription>
            Previously submitted service requests, most recent first.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sortedRequests.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No service requests submitted yet.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {sortedRequests.map((request) => {
                const serviceMeta = AVAILABLE_SERVICES.find(
                  (s) => s.type === request.serviceType
                );

                return (
                  <li
                    key={request.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0 last:pb-0"
                  >
                    <div>
                      <p className="text-sm font-medium">
                        {serviceMeta?.name ?? request.serviceType}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {format(
                          parseISO(request.requestedAt),
                          "dd MMM yyyy, hh:mm a"
                        )}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider ${
                        STATUS_BADGE_STYLES[request.status]
                      }`}
                    >
                      {request.status}
                    </Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
