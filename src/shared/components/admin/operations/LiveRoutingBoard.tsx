"use client";

import { useState, useEffect, useTransition } from "react";
import { Button } from "@/shared/components/ui/button";
import { Badge } from "@/shared/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/shared/components/ui/dialog";
import {
  AlertTriangle,
  MapPin,
  GripVertical,
  Loader2,
  Save,
  Undo2,
  Route,
  Pin,
} from "lucide-react";
import { toast } from "sonner";
import {
  commitRouteChanges,
  getRoutingData,
} from "@/actions/admin-actions/routingActions";
import { SectionHeader } from "../core/SectionHeader";
import FixedRiderAssignments from "./FixedRiderAssignments";
import { ridersForSelectedClinic } from "@/lib/clinic/visibility";
import {
  ClinicSelectControl,
  SelectClinicPrompt,
  useClinicSelector,
  type GetClinics,
} from "./clinicSelector";

const getISTDateString = (offsetDays = 0) => {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
};

const getDayLabel = (deliveryDate: string) => {
  if (deliveryDate === getISTDateString()) return "Today";
  if (deliveryDate === getISTDateString(1)) return "Tomorrow";
  return deliveryDate;
};

const pickDefaultRiders = (orders: RoutingOrder[], riders: RoutingRider[]) => {
  const riderOrderCounts = new Map<string, number>();
  orders.forEach((order) => {
    if (!order.assigned_rider_id) return;
    riderOrderCounts.set(
      order.assigned_rider_id,
      (riderOrderCounts.get(order.assigned_rider_id) || 0) + 1,
    );
  });

  const sortedRiderIds = [...riderOrderCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([riderId]) => riderId);

  const riderOne = sortedRiderIds[0] || riders[0]?.id || "";
  const riderTwo =
    sortedRiderIds.find((id) => id !== riderOne) ||
    riders.find((rider) => rider.id !== riderOne)?.id ||
    "";

  return { riderOne, riderTwo };
};

export interface RoutingOrder {
  id: string;
  customerName: string;
  pincode: string;
  mealType: string;
  status: string;
  deliveryDate: string;
  assigned_rider_id: string;
  isPinned?: boolean;
  pinnedRiderId?: string | null;
}

export interface RoutingRider {
  id: string;
  fullName: string;
  employeeCode: string;
  assignedPincodes: string[];
  /** Rider's linked Clinic — drives clinic-selector-first gating (Req 17). */
  clinic_id: string | null;
  /**
   * Delivery dates this rider has already picked up (batch left PENDING).
   * A rider is frozen for those dates: no re-assignment or re-sequencing.
   */
  pickedUpDates?: string[];
}

type FixedAssignmentsInjectedProps = {
  getAssignments?: () => Promise<any[]>;
  getRiders?: () => Promise<any[]>;
  searchCustomers?: (query: string) => Promise<any[]>;
  upsert?: (
    customerProfileId: string,
    riderId: string,
    note?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  remove?: (id: string) => Promise<{ success: boolean; error?: string }>;
};

interface LiveRoutingBoardProps {
  /** Operations scope ("core" | "all" | franchise uuid) passed to admin fetches. */
  scope?: string;
  /** Injectable data fetch + commit so the franchise portal can scope to itself. */
  getData?: (
    scope?: string,
  ) => Promise<{ orders: RoutingOrder[]; riders: RoutingRider[] }>;
  commit?: (
    moves: { orderId: string; newRiderId: string | null }[],
    scope?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  /** Injected actions for the nested Fixed Rider Assignments panel. */
  fixedAssignmentsProps?: FixedAssignmentsInjectedProps;
  /**
   * When provided, enables clinic-selector-first mode (Req 17): no order/rider
   * data is fetched or rendered until a clinic is selected, then only that
   * clinic's riders are shown. Omitted by the franchise portal.
   */
  getClinics?: GetClinics;
}

export default function LiveRoutingBoard({
  scope,
  getData = getRoutingData,
  commit = commitRouteChanges,
  fixedAssignmentsProps,
  getClinics,
}: LiveRoutingBoardProps = {}) {
  const {
    selectorFirst,
    clinicOptions,
    clinicsLoading,
    selectedClinicId,
    setSelectedClinicId,
  } = useClinicSelector(getClinics);

  const [initialOrders, setInitialOrders] = useState<RoutingOrder[]>([]);
  const [orders, setOrders] = useState<RoutingOrder[]>([]);
  const [riders, setRiders] = useState<RoutingRider[]>([]);

  const [riderOneId, setRiderOneId] = useState<string>("");
  const [riderTwoId, setRiderTwoId] = useState<string>("");

  const [isLoading, setIsLoading] = useState(!selectorFirst);
  const [isPending, startTransition] = useTransition();
  const [draggedOrderId, setDraggedOrderId] = useState<string | null>(null);

  // NEW: Confirmation Modal State
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);

  const fetchBoardData = async () => {
    // Selector-first gating: fetch nothing until a clinic is chosen
    // (Req 17.1, 17.3, 17.5).
    if (selectorFirst && !selectedClinicId) return;

    setIsLoading(true);
    const res = await getData(scope);
    setInitialOrders(res.orders);
    setOrders(res.orders);
    setRiders(res.riders);

    // Default-rider selection is drawn from the clinic-scoped riders so the
    // board opens on the selected clinic's riders (Req 17.2, 17.4, 17.6).
    const riderSet = selectorFirst
      ? ridersForSelectedClinic(selectedClinicId || null, res.riders)
      : res.riders;
    const { riderOne, riderTwo } = pickDefaultRiders(res.orders, riderSet);
    setRiderOneId(riderOne);
    setRiderTwoId(riderTwo);

    setIsLoading(false);
  };

  useEffect(() => {
    fetchBoardData();
    // Re-fetch when the operations scope or selected clinic changes. Changing
    // the clinic re-derives the board purely from the new selection so no stale
    // riders/orders remain (Req 17.7).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, selectedClinicId]);

  // Riders actually shown: only the selected clinic's riders in selector-first
  // mode (Req 17.2, 17.4, 17.6); empty until a clinic is chosen (Req 17.1).
  const displayedRiders = selectorFirst
    ? ridersForSelectedClinic(selectedClinicId || null, riders)
    : riders;

  // Changing the clinic discards any prior rider selection so nothing stale
  // remains (Req 17.7). The board reloads via the effect above.
  const handleClinicChange = (clinicId: string) => {
    setSelectedClinicId(clinicId);
    setRiderOneId("");
    setRiderTwoId("");
  };

  const unsavedChanges = orders.filter((o) => {
    const original = initialOrders.find((io) => io.id === o.id);
    return original && original.assigned_rider_id !== o.assigned_rider_id;
  });

  const handleDragStart = (e: React.DragEvent, orderId: string) => {
    setDraggedOrderId(orderId);
    e.dataTransfer.effectAllowed = "move";
    setTimeout(() => {
      if (e.target instanceof HTMLElement) e.target.style.opacity = "0.5";
    }, 0);
  };

  const handleDragEnd = (e: React.DragEvent) => {
    setDraggedOrderId(null);
    if (e.target instanceof HTMLElement) e.target.style.opacity = "1";
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (e: React.DragEvent, targetRiderId: string) => {
    e.preventDefault();
    if (!draggedOrderId) return;

    const draggedOrder = orders.find((o) => o.id === draggedOrderId);
    if (!draggedOrder) return;

    // Guard: block reassigning any order to a rider who has already picked up
    // their batch for that delivery date (frozen route). Mirrors the
    // server-side enforcement in commitRouteChanges.
    const targetRider = riders.find((r) => r.id === targetRiderId);
    if (
      targetRider?.pickedUpDates?.includes(draggedOrder.deliveryDate) &&
      draggedOrder.assigned_rider_id !== targetRiderId
    ) {
      toast.error(
        `${targetRider.fullName} has already picked up ${getDayLabel(
          draggedOrder.deliveryDate,
        ).toLowerCase()}'s batch. Their route is locked and can't take new orders.`,
      );
      return;
    }

    // Guard: block pulling an order away from a rider who is already out for
    // delivery on that date.
    const sourceRider = riders.find(
      (r) => r.id === draggedOrder.assigned_rider_id,
    );
    if (
      sourceRider?.pickedUpDates?.includes(draggedOrder.deliveryDate) &&
      draggedOrder.assigned_rider_id !== targetRiderId
    ) {
      toast.error(
        `${sourceRider.fullName} is already out for delivery. Their existing route is locked.`,
      );
      return;
    }

    setOrders((prev) =>
      prev.map((order) =>
        order.id === draggedOrderId
          ? { ...order, assigned_rider_id: targetRiderId }
          : order,
      ),
    );
  };

  const executeCommit = () => {
    if (unsavedChanges.length === 0) return;

    const moves = unsavedChanges.map((o) => ({
      orderId: o.id,
      newRiderId: o.assigned_rider_id === "" ? null : o.assigned_rider_id,
    }));

    startTransition(async () => {
      const res = await commit(moves, scope);
      if (res.success) {
        toast.success(`Successfully re-routed ${moves.length} deliveries.`);
        setIsConfirmModalOpen(false);
        await fetchBoardData();
      } else {
        toast.error(res.error);
        setIsConfirmModalOpen(false);
      }
    });
  };

  const handleRevert = () => {
    setOrders(initialOrders);
    toast.info("Reverted all unsaved routing changes.");
  };

  // Selector-first gate: render only the selector + prompt until a clinic is
  // selected (Req 17.1, 17.3, 17.5).
  const gatePending = selectorFirst && !selectedClinicId;
  // Selected clinic with zero riders → empty state (Req 17.8).
  const noClinicRiders =
    selectorFirst && !isLoading && displayedRiders.length === 0;
  const showBoard = !gatePending && !isLoading && !noClinicRiders;

  const unassignedOrders = orders.filter((o) => o.assigned_rider_id === "");

  const renderRiderColumn = (
    currentRiderId: string,
    setRiderFn: (id: string) => void,
    placeholder: string,
  ) => {
    const rider = displayedRiders.find((r) => r.id === currentRiderId);
    const riderOrders = rider
      ? orders.filter((o) => o.assigned_rider_id === rider.id)
      : [];

    return (
      <div
        className="flex-1 min-w-[300px] bg-card border rounded-xl shadow-sm p-3 flex flex-col h-[700px]"
        onDragOver={handleDragOver}
        onDrop={(e) => (rider ? handleDrop(e, rider.id) : e.preventDefault())}
      >
        <div className="mb-3 px-1 border-b pb-3">
          <Select value={currentRiderId} onValueChange={setRiderFn}>
            <SelectTrigger className="w-full font-bold text-[15px] bg-muted/30 border-primary/20 hover:bg-muted/50 transition-colors h-12 shadow-sm">
              <SelectValue placeholder={placeholder} />
            </SelectTrigger>
            <SelectContent>
              {displayedRiders.map((r) => (
                <SelectItem
                  key={r.id}
                  value={r.id}
                  disabled={
                    (r.id === riderOneId && placeholder.includes("Two")) ||
                    (r.id === riderTwoId && placeholder.includes("One"))
                  }
                >
                  {r.fullName} ({r.employeeCode})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {rider && (
            <div className="flex justify-between items-center mt-3 px-2">
              <span className="text-xs font-mono text-muted-foreground">
                {rider.employeeCode}
              </span>
              <div className="flex items-center gap-2">
                {rider.pickedUpDates && rider.pickedUpDates.length > 0 && (
                  <Badge
                    variant="secondary"
                    className="bg-amber-100 text-amber-700 border-amber-200 gap-1"
                    title={`Batch picked up for: ${rider.pickedUpDates
                      .map(getDayLabel)
                      .join(", ")}. Route locked for those days.`}
                  >
                    <Pin className="h-3 w-3" />
                    Locked ({rider.pickedUpDates.map(getDayLabel).join(", ")})
                  </Badge>
                )}
                <Badge variant="secondary" className="bg-primary/10 text-primary">
                  {riderOrders.length} Orders
                </Badge>
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3 h-full overflow-y-auto pr-1 pb-4">
          {!rider ? (
            <div className="h-full flex items-center justify-center text-muted-foreground/50 text-sm italic">
              Select a rider above to view or assign routes.
            </div>
          ) : riderOrders.length === 0 ? (
            <div className="h-full flex items-center justify-center border-2 border-dashed border-border/50 rounded-lg text-muted-foreground text-sm italic opacity-50">
              Drop deliveries here
            </div>
          ) : (
            riderOrders.map((order) => {
              const isWarning = !rider.assignedPincodes.includes(order.pincode);
              return (
                <OrderCard
                  key={order.id}
                  order={order}
                  isWarning={isWarning}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                />
              );
            })
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Top Control Bar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-card p-4 md:px-6 rounded-xl border shadow-sm">
        <div>
          <SectionHeader
            title="Live Routing Board"
            icon={Route}
            className="mb-0"
          />
          <p className="text-sm text-muted-foreground mt-1 ml-8">
            Compare two riders to drag and drop deliveries between them. Showing
            today and tomorrow&apos;s routes.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mt-4 sm:mt-0 w-full sm:w-auto">
          {selectorFirst && (
            <ClinicSelectControl
              clinicOptions={clinicOptions}
              clinicsLoading={clinicsLoading}
              selectedClinicId={selectedClinicId}
              onSelect={handleClinicChange}
              className="min-w-[220px]"
            />
          )}

          {showBoard && (
            <div className="flex items-center gap-3">
              {unsavedChanges.length > 0 && (
                <Badge
                  variant="destructive"
                  className="animate-pulse bg-amber-500 hover:bg-amber-600"
                >
                  {unsavedChanges.length} Unsaved Changes
                </Badge>
              )}
              <Button
                variant="outline"
                onClick={handleRevert}
                disabled={unsavedChanges.length === 0 || isPending}
              >
                <Undo2 className="h-4 w-4 mr-2" /> Revert
              </Button>

              {/* Changed onClick to open the modal instead of committing directly */}
              <Button
                onClick={() => setIsConfirmModalOpen(true)}
                disabled={unsavedChanges.length === 0 || isPending}
                className="bg-primary shadow-sm"
              >
                {isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                Confirm Re-Routes
              </Button>
            </div>
          )}
        </div>
      </div>

      {gatePending && (
        <SelectClinicPrompt message="Select a clinic to view and re-route its riders' deliveries." />
      )}

      {!gatePending && isLoading && (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground border rounded-xl bg-card shadow-sm">
          <Loader2 className="h-8 w-8 animate-spin mb-4 text-primary" />
          <p>Loading routing board data...</p>
        </div>
      )}

      {noClinicRiders && (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">
          <Route className="mx-auto mb-3 h-10 w-10 opacity-40" />
          <p className="font-medium">No riders for this clinic</p>
          <p className="mt-1 text-sm">
            This clinic has no active riders to route. Assign riders to this
            clinic to begin.
          </p>
        </div>
      )}

      {showBoard && (
        <>
          {/* 3-Column Kanban Layout */}
          <div className="flex flex-col lg:flex-row gap-4">
            {/* Column 1: Unassigned (Narrow) */}
            <div
              className="w-full lg:w-[280px] flex-shrink-0 bg-muted/20 border border-dashed border-border rounded-xl p-3 flex flex-col h-[700px]"
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, "")}
            >
              <div className="mb-3 px-2 flex justify-between items-center pb-2 border-b border-border/50">
                <h3 className="font-semibold text-muted-foreground flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" /> Unassigned
                </h3>
                <Badge variant="secondary">{unassignedOrders.length}</Badge>
              </div>
              <div className="flex flex-col gap-3 h-full overflow-y-auto pr-1 pb-4">
                {unassignedOrders.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-muted-foreground/50 text-sm italic">
                    All orders assigned!
                  </div>
                ) : (
                  unassignedOrders.map((order) => (
                    <OrderCard
                      key={order.id}
                      order={order}
                      onDragStart={handleDragStart}
                      onDragEnd={handleDragEnd}
                    />
                  ))
                )}
              </div>
            </div>

            {/* Column 2: Selected Rider 1 */}
            {renderRiderColumn(riderOneId, setRiderOneId, "Select Rider One...")}

            {/* Column 3: Selected Rider 2 */}
            {renderRiderColumn(riderTwoId, setRiderTwoId, "Select Rider Two...")}
          </div>

          {/* Permanent customer -> rider overrides, managed inline below the board */}
          <div className="pt-2 border-t border-dashed border-border/60">
            <FixedRiderAssignments
              onChanged={fetchBoardData}
              {...fixedAssignmentsProps}
            />
          </div>
        </>
      )}

      {/* NEW: Confirmation Modal */}
      <Dialog open={isConfirmModalOpen} onOpenChange={setIsConfirmModalOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Route className="h-5 w-5 text-primary" />
              Confirm Route Changes
            </DialogTitle>
            <DialogDescription asChild>
              <div className="text-sm text-muted-foreground mt-2">
                You are about to modify <strong>{unsavedChanges.length}</strong>{" "}
                delivery assignments.
                <br />
                <br />
                This will automatically update the route sequences, recalculate
                estimated payouts, and create or delete delivery batches as
                needed. The affected riders will see these changes immediately.
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4">
            <Button
              variant="outline"
              onClick={() => setIsConfirmModalOpen(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button onClick={executeCommit} disabled={isPending}>
              {isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Yes, Update Routes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Sub-component for the draggable card
function OrderCard({
  order,
  isWarning = false,
  onDragStart,
  onDragEnd,
}: {
  order: RoutingOrder;
  isWarning?: boolean;
  onDragStart: (e: React.DragEvent, id: string) => void;
  onDragEnd: (e: React.DragEvent) => void;
}) {
  const dayLabel = getDayLabel(order.deliveryDate);

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, order.id)}
      onDragEnd={onDragEnd}
      className={`relative bg-background border rounded-lg p-3 shadow-sm cursor-grab active:cursor-grabbing hover:border-primary/50 transition-colors ${
        isWarning ? "border-amber-500/50 bg-amber-50/20" : "border-border"
      }`}
    >
      <div className="flex items-start gap-2">
        <div className="mt-1 text-muted-foreground/30 hover:text-muted-foreground transition-colors">
          <GripVertical className="h-4 w-4" />
        </div>
        <div className="flex-1 overflow-hidden">
          <div className="flex justify-between items-start mb-1.5 gap-2">
            <h4
              className="font-semibold text-sm truncate pr-2 flex items-center gap-1.5"
              title={order.customerName}
            >
              {order.isPinned && (
                <Pin
                  className="h-3 w-3 shrink-0 text-primary fill-primary/20"
                  aria-label="Permanently pinned to this rider"
                />
              )}
              <span className="truncate">{order.customerName}</span>
            </h4>
            <div className="flex flex-col items-end gap-1 shrink-0">
              <Badge
                variant="outline"
                className={`text-[10px] h-5 whitespace-nowrap ${
                  dayLabel === "Today"
                    ? "border-primary/30 bg-primary/5 text-primary"
                    : "border-blue-500/30 bg-blue-500/5 text-blue-600"
                }`}
              >
                {dayLabel}
              </Badge>
              <Badge
                variant="outline"
                className={`text-[10px] h-5 whitespace-nowrap ${order.mealType.toUpperCase().includes("VEG") && !order.mealType.toUpperCase().includes("NON") ? "text-green-600 border-green-200 bg-green-50" : "text-red-600 border-red-200 bg-red-50"}`}
              >
                {order.mealType.toUpperCase().includes("VEG") &&
                !order.mealType.toUpperCase().includes("NON")
                  ? "VEG"
                  : "NON-VEG"}
              </Badge>
            </div>
          </div>

          <div className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground mt-1">
            <MapPin className="h-3 w-3" />
            <span className={isWarning ? "text-amber-600 font-bold" : ""}>
              {order.pincode}
            </span>
          </div>

          {isWarning && (
            <div className="mt-2 flex items-start gap-1.5 text-[10px] text-amber-700 bg-amber-100/50 p-1.5 rounded border border-amber-200/50">
              <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
              <span>
                Warning: This pincode is outside the rider's mapped territory.
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
