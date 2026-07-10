"use client";

import React, { useEffect, useState } from "react";
import { format, isValid } from "date-fns";
import { getActiveStayAction, getStayHistoryAction } from "@/actions/stayActions";
import type { StayEntry } from "@/types/accommodation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { Plus, Home, Calendar, Users, Clock, CalendarPlus } from "lucide-react";
import { AdminHealthLogForm } from "./AdminHealthLogForm";
import { StayExtensionDialog } from "./StayExtensionDialog";
import { NewStayDialog } from "./NewStayDialog";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getStatusBadgeClasses(status: string): string {
  switch (status) {
    case "ACTIVE":
      return "border-emerald-500 text-emerald-600 bg-emerald-50";
    case "PENDING":
      return "border-amber-500 text-amber-600 bg-amber-50";
    case "FINISHED":
      return "border-slate-300 text-slate-600 bg-slate-50";
    case "EXPIRED":
      return "border-red-400 text-red-600 bg-red-50";
    default:
      return "border-slate-300 text-slate-600 bg-slate-50";
  }
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return isValid(date) ? format(date, "dd MMM yyyy") : "N/A";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface AccommodationTabProps {
  customerProfileId: string;
}

export function AccommodationTab({ customerProfileId }: AccommodationTabProps) {
  const [activeStay, setActiveStay] = useState<StayEntry | null>(null);
  const [stayHistory, setStayHistory] = useState<StayEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Dialog state
  const [showExtendDialog, setShowExtendDialog] = useState(false);
  const [showNewStayDialog, setShowNewStayDialog] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [activeRes, historyRes] = await Promise.all([
        getActiveStayAction(customerProfileId),
        getStayHistoryAction(customerProfileId),
      ]);

      if ("error" in activeRes) {
        setError(activeRes.error);
      } else {
        setActiveStay(activeRes.data);
      }

      if ("error" in historyRes) {
        setError(historyRes.error);
      } else {
        setStayHistory(historyRes.data);
      }
    } catch {
      setError("Failed to load accommodation data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerProfileId]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-start gap-3">
                  <Skeleton className="h-5 w-5 rounded" />
                  <div className="space-y-1.5 w-full">
                    <Skeleton className="h-3.5 w-20" />
                    <Skeleton className="h-4 w-24" />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        <Skeleton className="h-48 w-full rounded-lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-destructive">{error}</p>
      </div>
    );
  }

  // Determine if "Add New Stay" is allowed (no ACTIVE or PENDING stay)
  const canAddNewStay = !activeStay || (activeStay.status !== "ACTIVE" && activeStay.status !== "PENDING");

  return (
    <div className="space-y-8">
      {/* ─── Active Stay Overview ─── */}
      <div>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold tracking-tight">Current Stay</h2>
            <p className="text-sm text-muted-foreground">
              Active or upcoming stay details for this customer.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {activeStay?.status === "ACTIVE" && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowExtendDialog(true)}
              >
                <CalendarPlus className="h-4 w-4 mr-2" />
                Extend Stay
              </Button>
            )}
            {canAddNewStay && (
              <Button
                variant="default"
                size="sm"
                onClick={() => setShowNewStayDialog(true)}
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Stay
              </Button>
            )}
          </div>
        </div>
      </div>

      {activeStay ? (
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">Active Stay Overview</CardTitle>
              <Badge variant="outline" className={getStatusBadgeClasses(activeStay.status)}>
                {activeStay.status}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="flex items-start gap-3">
                <Home className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Stay Type</p>
                  <p className="font-semibold">{activeStay.stayType}</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Users className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Occupancy</p>
                  <p className="font-semibold">{activeStay.occupancyType}</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Calendar className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Start Date</p>
                  <p className="font-semibold">{formatDate(activeStay.startDate)}</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Calendar className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-muted-foreground">End Date</p>
                  <p className="font-semibold">{formatDate(activeStay.endDate)}</p>
                </div>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  {activeStay.totalNights} night{activeStay.totalNights !== 1 ? "s" : ""}
                </span>
              </div>
              {activeStay.mealPreference && (
                <Badge variant="secondary">{activeStay.mealPreference}</Badge>
              )}
              {activeStay.paymentHostProfileId && (
                <Badge variant="secondary" className="bg-blue-50 text-blue-700 border-blue-200">
                  Shared Payment
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Home className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <p className="text-muted-foreground text-center mb-4">No current stay</p>
            <Button variant="default" size="sm" onClick={() => setShowNewStayDialog(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Stay
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ─── Health Logs Section (Req 13.5, 13.6) ─── */}
      {activeStay?.status === "ACTIVE" && (
        <AdminHealthLogForm stayId={activeStay.id} />
      )}

      {/* ─── Stay History ─── */}
      <div>
        <h2 className="text-xl font-bold tracking-tight">Stay History</h2>
        <p className="text-sm text-muted-foreground">
          All past stays for this customer.
        </p>
      </div>

      {stayHistory.length > 0 ? (
        <div className="space-y-3">
          {stayHistory.map((stay) => (
            <Card key={stay.id}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-4 flex-wrap">
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Dates</p>
                      <p className="text-sm font-semibold">
                        {formatDate(stay.startDate)} — {formatDate(stay.endDate)}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Nights</p>
                      <p className="text-sm font-semibold">{stay.totalNights}</p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Type</p>
                      <p className="text-sm font-semibold">{stay.stayType}</p>
                    </div>
                  </div>
                  <Badge variant="outline" className={getStatusBadgeClasses(stay.status)}>
                    {stay.status}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground">No past stay records available.</p>
          </CardContent>
        </Card>
      )}

      {/* ─── Dialogs ─── */}
      {activeStay?.status === "ACTIVE" && (
        <StayExtensionDialog
          stayId={activeStay.id}
          open={showExtendDialog}
          onOpenChange={setShowExtendDialog}
          onSuccess={fetchData}
        />
      )}

      <NewStayDialog
        customerProfileId={customerProfileId}
        open={showNewStayDialog}
        onOpenChange={setShowNewStayDialog}
        onSuccess={fetchData}
      />
    </div>
  );
}
