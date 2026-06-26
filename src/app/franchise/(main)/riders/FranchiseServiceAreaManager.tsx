"use client";

import { useState, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/shared/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import {
  Map,
  MapPin,
  Edit,
  Trash2,
  Plus,
  X,
  Loader2,
  Lock,
  Unlock,
  Info,
} from "lucide-react";
import { toast } from "sonner";
import { SectionCard } from "@/shared/components/franchise/ui/GlassCard";
import {
  franchiseUpsertServiceArea,
  franchiseDeleteServiceArea,
  franchiseUpdateAreaAssignment,
} from "@/actions/franchise-actions/franchiseServiceAreaActions";

interface RiderLite {
  id: string;
  fullName: string;
  employeeCode: string;
  isOnline: boolean;
}

interface ServiceArea {
  id: string;
  area_name: string;
  pincode: string;
  rider_id: string | null;
}

interface Props {
  riders: RiderLite[];
  allAreas: ServiceArea[];
  approvedPincodes: string[];
}

export default function FranchiseServiceAreaManager({
  riders,
  allAreas,
  approvedPincodes,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [isAreaModalOpen, setIsAreaModalOpen] = useState(false);
  const [activeArea, setActiveArea] = useState<ServiceArea | null>(null);
  const [form, setForm] = useState({ name: "", pincode: "" });

  const [isUnlockMode, setIsUnlockMode] = useState(false);
  const [filterRiderId, setFilterRiderId] = useState<string>("ALL");
  const [deleteState, setDeleteState] = useState({ isOpen: false, areaId: "" });

  const unassignedAreas = allAreas.filter((a) => !a.rider_id);

  // Approved pincodes that are not yet registered as a service area —
  // these are the only pincodes a new service area can use.
  const usedPincodes = useMemo(
    () => new Set(allAreas.map((a) => a.pincode)),
    [allAreas],
  );
  const availablePincodes = approvedPincodes.filter((p) => !usedPincodes.has(p));

  const filteredAreas = allAreas.filter((a) => {
    if (filterRiderId === "ALL") return true;
    if (filterRiderId === "UNASSIGNED") return !a.rider_id;
    return a.rider_id === filterRiderId;
  });

  const getRiderEmpCode = (riderId: string | null) => {
    if (!riderId) return null;
    const r = riders.find((r) => r.id === riderId);
    return r ? r.employeeCode : null;
  };

  const openAddModal = () => {
    setActiveArea(null);
    setForm({ name: "", pincode: availablePincodes[0] ?? "" });
    setIsAreaModalOpen(true);
  };

  const openEditModal = (area: ServiceArea) => {
    setActiveArea(area);
    setForm({ name: area.area_name, pincode: area.pincode });
    setIsAreaModalOpen(true);
  };

  const handleSaveArea = () => {
    if (!form.name.trim() || !form.pincode) {
      toast.error("Area name and pincode are required.");
      return;
    }
    startTransition(async () => {
      const res = await franchiseUpsertServiceArea(
        activeArea?.id ?? null,
        form.name,
        form.pincode,
      );
      if (res.success) {
        toast.success(activeArea ? "Service area updated." : "Service area added.");
        setIsAreaModalOpen(false);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  const executeDelete = () => {
    if (!deleteState.areaId) return;
    startTransition(async () => {
      const res = await franchiseDeleteServiceArea(deleteState.areaId);
      if (res.success) {
        toast.success("Service area deleted.");
        setDeleteState({ isOpen: false, areaId: "" });
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  const handleAssign = (areaId: string, riderId: string) => {
    startTransition(async () => {
      const res = await franchiseUpdateAreaAssignment(areaId, riderId);
      if (res.success) {
        toast.success("Pincode mapped to rider.");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  const handleUnassign = (areaId: string) => {
    startTransition(async () => {
      const res = await franchiseUpdateAreaAssignment(areaId, null);
      if (res.success) {
        toast.success("Pincode removed from rider.");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  // Pincode options for the modal: available approved pincodes plus,
  // when editing, the area's current pincode.
  const modalPincodeOptions = useMemo(() => {
    const opts = new Set(availablePincodes);
    if (activeArea) opts.add(activeArea.pincode);
    return Array.from(opts).sort();
  }, [availablePincodes, activeArea]);

  return (
    <div className="space-y-8">
      {/* SECTION 1: Service Areas Database */}
      <SectionCard
        icon={Map}
        title="Service Areas Database"
        subtitle={`${allAreas.length} total areas`}
        note={
          <p className="flex items-center gap-1.5 text-xs text-slate-400">
            <Info className="h-3.5 w-3.5 shrink-0" />
            Service areas can only use pincodes from your approved territory.
            Request new pincodes from the Profile page.
          </p>
        }
        actions={
          <>
            <Select value={filterRiderId} onValueChange={setFilterRiderId}>
              <SelectTrigger className="h-9 w-[190px] rounded-xl border-slate-200/80 bg-white/60 text-sm shadow-sm">
                <SelectValue placeholder="Filter by rider" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Service Areas</SelectItem>
                <SelectItem value="UNASSIGNED">Unassigned Only</SelectItem>
                {riders.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.fullName} ({r.employeeCode})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex items-center gap-2 rounded-xl border border-slate-200/80 bg-white/60 px-3 py-1.5 shadow-sm">
              {isUnlockMode ? (
                <Unlock className="h-4 w-4 text-rose-500" />
              ) : (
                <Lock className="h-4 w-4 text-slate-400" />
              )}
              <button
                role="switch"
                aria-checked={isUnlockMode}
                onClick={() => setIsUnlockMode(!isUnlockMode)}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors ${
                  isUnlockMode ? "bg-rose-500" : "bg-slate-200"
                }`}
              >
                <span
                  className={`pointer-events-none block h-4 w-4 rounded-full bg-white shadow-lg ring-0 transition-transform ${
                    isUnlockMode ? "translate-x-4" : "translate-x-0"
                  }`}
                />
              </button>
            </div>

            <Button
              size="sm"
              className="h-9 rounded-xl shadow-sm"
              onClick={openAddModal}
              disabled={availablePincodes.length === 0}
              title={
                availablePincodes.length === 0
                  ? "All approved pincodes are already added. Request more from Profile."
                  : "Add a service area"
              }
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" /> Add Service Area
            </Button>
          </>
        }
      >
        {filteredAreas.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-400">
            No service areas found for this filter.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {filteredAreas.map((area) => (
              <div
                key={area.id}
                className="group relative flex flex-col justify-between overflow-hidden rounded-xl bg-white/70 p-3 shadow-sm ring-1 ring-inset ring-slate-100 transition-all hover:ring-primary/30"
              >
                {isUnlockMode && (
                  <div className="absolute right-1 top-1 flex rounded-md bg-white/90 shadow-sm ring-1 ring-slate-100 backdrop-blur-sm">
                    <button
                      onClick={() => openEditModal(area)}
                      className="p-1.5 text-slate-400 transition-colors hover:text-primary"
                    >
                      <Edit className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => setDeleteState({ isOpen: true, areaId: area.id })}
                      className="p-1.5 text-slate-400 transition-colors hover:text-rose-500"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}

                <div>
                  <h3
                    className="truncate pr-10 text-sm font-semibold text-slate-800"
                    title={area.area_name}
                  >
                    {area.area_name}
                  </h3>
                  <div className="mt-1 flex items-center font-mono text-xs text-slate-400">
                    <MapPin className="mr-1 h-3 w-3" /> {area.pincode}
                  </div>
                </div>

                <div className="mt-3">
                  {area.rider_id ? (
                    <Badge
                      variant="outline"
                      className="h-5 rounded-md border-primary/20 bg-primary/5 px-1.5 text-[10px] text-primary"
                    >
                      {getRiderEmpCode(area.rider_id) || "Assigned"}
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className="h-5 rounded-md border-slate-200 bg-slate-50 px-1.5 text-[10px] text-slate-400"
                    >
                      Unassigned
                    </Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* SECTION 2: Rider Territory Mapping */}
      <SectionCard
        icon={MapPin}
        title="Rider Territory Mapping"
        subtitle={`${riders.length} riders`}
      >
        {riders.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-400">
            No riders to map. Onboard a rider first.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
            {riders.map((rider) => {
              const riderAreas = allAreas.filter((a) => a.rider_id === rider.id);
              return (
                <div
                  key={rider.id}
                  className="flex h-full flex-col rounded-xl bg-white/70 p-5 shadow-sm ring-1 ring-inset ring-slate-100"
                >
                  <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-3">
                    <div>
                      <h3 className="font-semibold text-slate-800">{rider.fullName}</h3>
                      <span className="font-mono text-xs text-slate-400">
                        {rider.employeeCode}
                      </span>
                    </div>
                    <Badge
                      variant="outline"
                      className={`rounded-lg text-[10px] ${
                        rider.isOnline
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "text-slate-500"
                      }`}
                    >
                      {rider.isOnline ? "Online" : "Offline"}
                    </Badge>
                  </div>

                  <div className="flex-1">
                    <p className="mb-3 text-xs font-medium uppercase tracking-wider text-slate-400">
                      Assigned Territories
                    </p>
                    <div className="mb-6 flex flex-wrap gap-2">
                      {riderAreas.length === 0 ? (
                        <span className="text-sm italic text-slate-400">
                          No areas assigned
                        </span>
                      ) : null}
                      {riderAreas.map((area) => (
                        <Badge
                          key={area.id}
                          variant="secondary"
                          className="flex items-center gap-1.5 rounded-lg border-primary/20 bg-primary/5 py-1 pl-3 pr-1 text-primary shadow-none hover:bg-primary/10"
                        >
                          <span>
                            {area.area_name}{" "}
                            <span className="opacity-70">({area.pincode})</span>
                          </span>
                          <button
                            onClick={() => handleUnassign(area.id)}
                            disabled={isPending}
                            className="rounded-full p-0.5 text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  </div>

                  <div className="mt-auto pt-2">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="outline"
                          disabled={isPending}
                          className="w-full justify-start rounded-xl border-dashed border-slate-200 bg-white/60 text-slate-500 shadow-sm hover:border-primary/40"
                        >
                          {isPending ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <Plus className="mr-2 h-4 w-4" />
                          )}
                          Assign new pincode...
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="w-[280px]">
                        {unassignedAreas.length === 0 ? (
                          <DropdownMenuItem disabled className="text-slate-400">
                            No unassigned areas available
                          </DropdownMenuItem>
                        ) : (
                          unassignedAreas.map((a) => (
                            <DropdownMenuItem
                              key={a.id}
                              onClick={() => handleAssign(a.id, rider.id)}
                              className="cursor-pointer font-medium"
                            >
                              <MapPin className="mr-2 h-4 w-4 text-slate-400" />
                              {a.area_name}{" "}
                              <span className="ml-1 font-mono text-xs text-slate-400">
                                ({a.pincode})
                              </span>
                            </DropdownMenuItem>
                          ))
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>

      {/* ADD / EDIT MODAL */}
      <Dialog open={isAreaModalOpen} onOpenChange={setIsAreaModalOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>
              {activeArea ? "Edit Service Area" : "Add Service Area"}
            </DialogTitle>
            <DialogDescription>
              Pincodes are limited to your approved service territory.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <label className="text-sm font-medium">Area Name</label>
              <Input
                placeholder="e.g. Jubilee Hills"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium">Pincode</label>
              {modalPincodeOptions.length === 0 ? (
                <p className="text-sm text-slate-400">
                  No approved pincodes available. Request one from the Profile page.
                </p>
              ) : (
                <Select
                  value={form.pincode}
                  onValueChange={(v) => setForm({ ...form, pincode: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select an approved pincode" />
                  </SelectTrigger>
                  <SelectContent>
                    {modalPincodeOptions.map((p) => (
                      <SelectItem key={p} value={p} className="font-mono">
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAreaModalOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveArea}
              disabled={isPending || !form.pincode || !form.name.trim()}
            >
              {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save Area
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DELETE CONFIRM MODAL */}
      <Dialog
        open={deleteState.isOpen}
        onOpenChange={(open) => !open && setDeleteState({ isOpen: false, areaId: "" })}
      >
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-rose-600">
              <Trash2 className="h-5 w-5" /> Delete Service Area
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this service area? If it is mapped to a
              rider, it will be unassigned. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteState({ isOpen: false, areaId: "" })}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={executeDelete} disabled={isPending}>
              {isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-2 h-4 w-4" />
              )}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
