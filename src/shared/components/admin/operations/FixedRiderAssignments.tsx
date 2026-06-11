"use client";

import { useState, useEffect, useTransition, useCallback } from "react";
import {
  Pin,
  Loader2,
  Plus,
  Trash2,
  Search,
  UserRound,
  Bike,
  Info,
} from "lucide-react";
import { toast } from "sonner";

import {
  getFixedAssignments,
  getAssignableRiders,
  searchCustomersForFixedAssignment,
  upsertFixedAssignment,
  removeFixedAssignment,
  type FixedAssignmentRow,
  type AssignableRider,
  type AssignableCustomer,
} from "@/actions/admin-actions/fixedAssignmentActions";
import { SectionHeader } from "../core/SectionHeader";
import { DataTableCard } from "../core/DataTableCard";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { Button } from "@/shared/components/ui/button";
import { Badge } from "@/shared/components/ui/badge";
import { Input } from "@/shared/components/ui/input";
import { Textarea } from "@/shared/components/ui/textarea";
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
  DialogDescription,
  DialogFooter,
} from "@/shared/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/components/ui/alert-dialog";

export default function FixedRiderAssignments({
  onChanged,
}: {
  onChanged?: () => void;
} = {}) {
  const [rows, setRows] = useState<FixedAssignmentRow[]>([]);
  const [riders, setRiders] = useState<AssignableRider[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isPending, startTransition] = useTransition();

  // Add/Edit dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerResults, setCustomerResults] = useState<AssignableCustomer[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedCustomer, setSelectedCustomer] =
    useState<AssignableCustomer | null>(null);
  const [selectedRiderId, setSelectedRiderId] = useState("");
  const [note, setNote] = useState("");

  // Delete confirmation
  const [pendingDelete, setPendingDelete] = useState<FixedAssignmentRow | null>(
    null,
  );

  const loadData = useCallback(async () => {
    setIsLoading(true);
    const [assignments, riderList] = await Promise.all([
      getFixedAssignments(),
      getAssignableRiders(),
    ]);
    setRows(assignments);
    setRiders(riderList);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Debounced customer search
  useEffect(() => {
    if (!dialogOpen) return;
    const q = customerQuery.trim();
    if (q.length < 2) {
      setCustomerResults([]);
      return;
    }
    setIsSearching(true);
    const timer = setTimeout(async () => {
      const results = await searchCustomersForFixedAssignment(q);
      // Hide customers that are already pinned (unless it's the one being edited)
      const pinnedIds = new Set(
        rows
          .filter((r) => r.customerProfileId !== selectedCustomer?.customerProfileId)
          .map((r) => r.customerProfileId),
      );
      setCustomerResults(results.filter((c) => !pinnedIds.has(c.customerProfileId)));
      setIsSearching(false);
    }, 350);
    return () => clearTimeout(timer);
  }, [customerQuery, dialogOpen, rows, selectedCustomer]);

  const openAddDialog = () => {
    setSelectedCustomer(null);
    setSelectedRiderId("");
    setNote("");
    setCustomerQuery("");
    setCustomerResults([]);
    setDialogOpen(true);
  };

  const openEditDialog = (row: FixedAssignmentRow) => {
    setSelectedCustomer({
      customerProfileId: row.customerProfileId,
      name: row.customerName,
      mobile: row.customerMobile,
      email: "",
      pincodes: [],
    });
    setSelectedRiderId(row.riderId);
    setNote(row.note ?? "");
    setCustomerQuery("");
    setCustomerResults([]);
    setDialogOpen(true);
  };

  const handleSave = () => {
    if (!selectedCustomer) {
      toast.error("Please select a customer.");
      return;
    }
    if (!selectedRiderId) {
      toast.error("Please select a rider.");
      return;
    }

    startTransition(async () => {
      const res = await upsertFixedAssignment(
        selectedCustomer.customerProfileId,
        selectedRiderId,
        note,
      );
      if (res.success) {
        toast.success(
          `${selectedCustomer.name} is now permanently assigned to the selected rider.`,
        );
        setDialogOpen(false);
        await loadData();
        onChanged?.();
      } else {
        toast.error(res.error || "Failed to save assignment.");
      }
    });
  };

  const handleDelete = () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    startTransition(async () => {
      const res = await removeFixedAssignment(target.id);
      if (res.success) {
        toast.success(
          `Removed fixed assignment for ${target.customerName}. Future routing reverts to pincode rules.`,
        );
        setPendingDelete(null);
        await loadData();
        onChanged?.();
      } else {
        toast.error(res.error || "Failed to remove assignment.");
      }
    });
  };

  const selectedRider = riders.find((r) => r.id === selectedRiderId);
  const pincodeMismatch =
    selectedCustomer &&
    selectedRider &&
    selectedCustomer.pincodes.length > 0 &&
    !selectedCustomer.pincodes.some((p) => selectedRider.pincodes.includes(p));

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-4">
      <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50/50 p-4 text-sm text-blue-800">
        <Info className="h-4 w-4 mt-0.5 shrink-0" />
        <p>
          Fixed assignments permanently pin a customer to a specific rider. Every
          daily routing run will route that customer to the pinned rider,
          <strong> even if the delivery pincode is outside the rider&apos;s service
          area</strong>. This stays in effect until you remove it here.
        </p>
      </div>

      <DataTableCard
        header={<SectionHeader title="Fixed Rider Assignments" icon={Pin} />}
        controls={
          <Button onClick={openAddDialog} className="bg-primary shadow-sm">
            <Plus className="h-4 w-4 mr-2" /> Add Assignment
          </Button>
        }
      >
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="h-7 w-7 animate-spin mb-3 text-primary" />
            <p>Loading fixed assignments...</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>Mobile</TableHead>
                <TableHead>Pinned Rider</TableHead>
                <TableHead>Note</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="text-center py-12 text-muted-foreground"
                  >
                    No fixed assignments yet. Use &quot;Add Assignment&quot; to pin
                    a customer to a rider.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">
                      {row.customerName}
                    </TableCell>
                    <TableCell className="font-mono text-muted-foreground">
                      {row.customerMobile}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Bike className="h-4 w-4 text-primary" />
                        <span>{row.riderName}</span>
                        <Badge variant="secondary" className="font-mono text-[10px]">
                          {row.riderCode}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-muted-foreground">
                      {row.note || "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openEditDialog(row)}
                        >
                          Change Rider
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => setPendingDelete(row)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </DataTableCard>

      {/* Add / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pin className="h-5 w-5 text-primary" />
              {selectedCustomer && customerResults.length === 0 && !customerQuery
                ? "Fixed Assignment"
                : "Add Fixed Assignment"}
            </DialogTitle>
            <DialogDescription>
              Pin a customer to a rider. This overrides daily pincode-based routing
              for that customer.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Customer selection */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Customer</label>
              {selectedCustomer ? (
                <div className="flex items-center justify-between rounded-lg border bg-muted/30 p-3">
                  <div className="flex items-center gap-2">
                    <UserRound className="h-4 w-4 text-primary" />
                    <div>
                      <p className="text-sm font-medium">{selectedCustomer.name}</p>
                      <p className="text-xs text-muted-foreground font-mono">
                        {selectedCustomer.mobile}
                        {selectedCustomer.pincodes.length > 0 &&
                          ` · ${selectedCustomer.pincodes.join(", ")}`}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSelectedCustomer(null);
                      setCustomerQuery("");
                    }}
                  >
                    Change
                  </Button>
                </div>
              ) : (
                <>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      autoFocus
                      placeholder="Search by name, mobile or email..."
                      value={customerQuery}
                      onChange={(e) => setCustomerQuery(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                  <div className="max-h-48 overflow-y-auto rounded-lg border divide-y">
                    {isSearching ? (
                      <div className="flex items-center justify-center py-6 text-muted-foreground text-sm">
                        <Loader2 className="h-4 w-4 animate-spin mr-2" /> Searching...
                      </div>
                    ) : customerQuery.trim().length < 2 ? (
                      <p className="py-6 text-center text-sm text-muted-foreground">
                        Type at least 2 characters to search.
                      </p>
                    ) : customerResults.length === 0 ? (
                      <p className="py-6 text-center text-sm text-muted-foreground">
                        No matching customers found.
                      </p>
                    ) : (
                      customerResults.map((c) => (
                        <button
                          key={c.customerProfileId}
                          type="button"
                          onClick={() => {
                            setSelectedCustomer(c);
                            setCustomerResults([]);
                          }}
                          className="w-full text-left px-3 py-2 hover:bg-muted/50 transition-colors"
                        >
                          <p className="text-sm font-medium">{c.name}</p>
                          <p className="text-xs text-muted-foreground font-mono">
                            {c.mobile}
                            {c.pincodes.length > 0 && ` · ${c.pincodes.join(", ")}`}
                          </p>
                        </button>
                      ))
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Rider selection */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Pinned Rider</label>
              <Select value={selectedRiderId} onValueChange={setSelectedRiderId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a rider..." />
                </SelectTrigger>
                <SelectContent>
                  {riders.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name} ({r.employeeCode})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {pincodeMismatch && (
                <p className="flex items-start gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                  <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  This rider does not service the customer&apos;s pincode. The
                  override will still force-assign them — this is allowed and
                  intentional.
                </p>
              )}
            </div>

            {/* Note */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Note (optional)</label>
              <Textarea
                placeholder="Why is this customer pinned to this rider?"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isPending}>
              {isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Pin className="mr-2 h-4 w-4" />
              )}
              Save Assignment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove fixed assignment?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.customerName} will no longer be force-assigned to{" "}
              {pendingDelete?.riderName}. Future daily routing runs will assign this
              customer based on their address pincode again. This does not change
              today&apos;s already-created routes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleDelete();
              }}
              disabled={isPending}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
