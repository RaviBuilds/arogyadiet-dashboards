"use client";

import { useMemo, useState, useTransition } from "react";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Badge } from "@/shared/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
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
  Map as MapIcon,
  MapPin,
  Edit,
  Trash2,
  Plus,
  X,
  Loader2,
  Lock,
  Unlock,
  ArrowRightLeft,
  Building2,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import {
  addPincodeToClinic,
  editPincode,
  deletePincode,
  movePincode,
  assignClinicToPincode,
  refreshClinicMappingAction,
} from "@/actions/admin-actions/serviceAreaActions";
import {
  assignServiceAreaToRider,
} from "@/actions/admin-actions/riderClinicActions";
import { updateAreaAssignment, revalidateRidersPage } from "@/actions/admin-actions/riderActions";
import { SectionHeader } from "../core/SectionHeader";
import { ExportButton } from "../core/ActionButtons";
import { ConfirmDeleteModal } from "../core/ConfirmDeleteModal";

const NO_CLINIC = "__none__";

/** Clinic option for the clinic-aware selectors and grouping. */
type ClinicOption = { id: string; name: string };

export default function ServiceAreaManager({
  riders,
  allAreas,
  clinics,
}: {
  riders: any[];
  allAreas: any[];
  clinics: ClinicOption[];
}) {
  const [isPending, startTransition] = useTransition();

  // Add/edit pincode modal
  const [isAreaModalOpen, setIsAreaModalOpen] = useState(false);
  const [activeArea, setActiveArea] = useState<any | null>(null);
  const [form, setForm] = useState({ name: "", pincode: "", clinicId: "" });

  // Move pincode modal
  const [moveState, setMoveState] = useState<{
    open: boolean;
    area: any | null;
    toClinicId: string;
  }>({ open: false, area: null, toClinicId: "" });

  // Assign-clinic modal (for clinic-less / legacy pincodes)
  const [assignState, setAssignState] = useState<{
    open: boolean;
    area: any | null;
    clinicId: string;
  }>({ open: false, area: null, clinicId: "" });

  // UI states
  const [isUnlockMode, setIsUnlockMode] = useState(false);
  const [filterClinicId, setFilterClinicId] = useState<string>("ALL");
  const [deleteModalState, setDeleteModalState] = useState({
    isOpen: false,
    areaId: "",
  });

  const clinicNameById = useMemo(() => {
    const map = new Map<string, string>();
    clinics.forEach((c) => map.set(c.id, c.name));
    return map;
  }, [clinics]);

  const clinicLabel = (clinicId: string | null | undefined) =>
    clinicId ? clinicNameById.get(clinicId) || "Unknown Clinic" : "No Clinic";

  const getRiderEmpCode = (riderId: string) => {
    const r = riders.find((r) => r.id === riderId);
    return r ? r.employee_code : null;
  };

  // Group areas by clinic id (null clinic areas grouped under NO_CLINIC).
  const groupedAreas = useMemo(() => {
    const groups = new Map<string, any[]>();
    allAreas.forEach((a) => {
      const key = a.clinic_id || NO_CLINIC;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(a);
    });
    // Order: known clinics (alpha), then "No Clinic" last.
    const ordered: { clinicId: string; areas: any[] }[] = [];
    clinics
      .filter((c) => groups.has(c.id))
      .forEach((c) => ordered.push({ clinicId: c.id, areas: groups.get(c.id)! }));
    // Any clinic ids present in areas but not in the clinics prop.
    groups.forEach((areas, key) => {
      if (key === NO_CLINIC) return;
      if (!clinics.some((c) => c.id === key)) {
        ordered.push({ clinicId: key, areas });
      }
    });
    if (groups.has(NO_CLINIC)) {
      ordered.push({ clinicId: NO_CLINIC, areas: groups.get(NO_CLINIC)! });
    }
    return ordered;
  }, [allAreas, clinics]);

  const visibleGroups = useMemo(() => {
    if (filterClinicId === "ALL") return groupedAreas;
    return groupedAreas.filter((g) => g.clinicId === filterClinicId);
  }, [groupedAreas, filterClinicId]);

  const handleExportAreas = () => {
    if (allAreas.length === 0) return;
    const exportData = allAreas.map((a) => ({
      Clinic: clinicLabel(a.clinic_id),
      "Area Name": a.area_name,
      Pincode: a.pincode,
      "Assigned Rider": getRiderEmpCode(a.rider_id) || "Unassigned",
    }));
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Service Areas");
    XLSX.writeFile(
      wb,
      `Service_Areas_${new Date().toISOString().split("T")[0]}.xlsx`,
    );
  };

  const handleExportMapping = () => {
    if (riders.length === 0) return;
    const exportData = riders.map((r) => {
      const areas = allAreas.filter((a) => a.rider_id === r.id);
      return {
        "Rider Name": r.fullName,
        "Employee Code": r.employee_code,
        Clinic: clinicLabel(r.clinic_id),
        "Assigned Areas":
          areas.map((a) => a.area_name).join(", ") || "Unassigned",
        "Assigned Pincodes":
          areas.map((a) => a.pincode).join(", ") || "Unassigned",
      };
    });
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Rider Mapping");
    XLSX.writeFile(
      wb,
      `Rider_Area_Mapping_${new Date().toISOString().split("T")[0]}.xlsx`,
    );
  };

  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefreshClinicMapping = () => {
    setIsRefreshing(true);
    startTransition(async () => {
      try {
        const res = await refreshClinicMappingAction();
        if (res.success) {
          const { customersFixed, addressesFixed, ordersFixed } = res.data;
          if (customersFixed === 0 && addressesFixed === 0 && ordersFixed === 0) {
            toast.info("All customers are already mapped to their correct clinic.");
          } else {
            toast.success(
              `Clinic mapping refreshed: ${customersFixed} customer${customersFixed === 1 ? "" : "s"}, ${addressesFixed} address${addressesFixed === 1 ? "" : "es"}, ${ordersFixed} order${ordersFixed === 1 ? "" : "s"} fixed.`,
              { duration: 8000 },
            );
          }
          revalidateRidersPage();
        } else {
          toast.error(res.error);
        }
      } finally {
        setIsRefreshing(false);
      }
    });
  };

  const openAddModal = () => {
    setActiveArea(null);
    setForm({
      name: "",
      pincode: "",
      clinicId: filterClinicId !== "ALL" ? filterClinicId : "",
    });
    setIsAreaModalOpen(true);
  };

  const openEditModal = (area: any) => {
    setActiveArea(area);
    setForm({
      name: area.area_name || "",
      pincode: area.pincode,
      clinicId: area.clinic_id || "",
    });
    setIsAreaModalOpen(true);
  };

  const handleSaveArea = () => {
    if (!form.pincode) {
      toast.error("Pincode is required.");
      return;
    }

    startTransition(async () => {
      if (activeArea) {
        // Edit only changes the pincode value (clinic move is a separate flow).
        const res = await editPincode(activeArea.id, form.pincode);
        if (res.success) {
          toast.success("Pincode updated successfully!");
          setIsAreaModalOpen(false);
          revalidateRidersPage();
        } else {
          toast.error(res.error);
        }
      } else {
        if (!form.clinicId) {
          toast.error("Please select a clinic for this pincode.");
          return;
        }
        const res = await addPincodeToClinic(
          form.clinicId,
          form.pincode,
          form.name || undefined,
        );
        if (res.success) {
          toast.success("Pincode added to clinic!");
          setIsAreaModalOpen(false);
          revalidateRidersPage();
        } else {
          toast.error(res.error);
        }
      }
    });
  };

  const confirmDelete = (id: string) =>
    setDeleteModalState({ isOpen: true, areaId: id });

  const executeDeleteArea = () => {
    if (!deleteModalState.areaId) return;
    startTransition(async () => {
      const res = await deletePincode(deleteModalState.areaId);
      if (res.success) {
        toast.success("Pincode deleted successfully.");
        setDeleteModalState({ isOpen: false, areaId: "" });
        revalidateRidersPage();
      } else {
        toast.error(res.error);
      }
    });
  };

  const openMoveModal = (area: any) =>
    setMoveState({ open: true, area, toClinicId: "" });

  const handleMovePincode = () => {
    const { area, toClinicId } = moveState;
    if (!area || !toClinicId) {
      toast.error("Please select a destination clinic.");
      return;
    }
    if (toClinicId === area.clinic_id) {
      toast.error("Pincode already belongs to this clinic.");
      return;
    }
    startTransition(async () => {
      const res = await movePincode(area.pincode, area.clinic_id, toClinicId);
      if (res.success) {
        const { reassignedCount, riderWarnings } = res.data;
        toast.success(
          `Pincode moved. ${reassignedCount} customer${
            reassignedCount === 1 ? "" : "s"
          } reassigned.`,
        );
        riderWarnings.forEach((w) =>
          toast.warning(w.message, { duration: 8000 }),
        );
        setMoveState({ open: false, area: null, toClinicId: "" });
        revalidateRidersPage();
      } else {
        toast.error(res.error);
      }
    });
  };

  const openAssignClinicModal = (area: any) =>
    setAssignState({ open: true, area, clinicId: "" });

  const handleAssignClinic = () => {
    const { area, clinicId } = assignState;
    if (!area || !clinicId) {
      toast.error("Please select a clinic.");
      return;
    }
    startTransition(async () => {
      const res = await assignClinicToPincode(area.id, clinicId);
      if (res.success) {
        const { reassignedCount, riderWarnings } = res.data;
        toast.success(
          `Pincode assigned to clinic. ${reassignedCount} customer${
            reassignedCount === 1 ? "" : "s"
          } reassigned.`,
        );
        riderWarnings.forEach((w) =>
          toast.warning(w.message, { duration: 8000 }),
        );
        setAssignState({ open: false, area: null, clinicId: "" });
        revalidateRidersPage();
      } else {
        toast.error(res.error);
      }
    });
  };

  // Territory mapping: assign a clinic-owned, unassigned pincode to a rider.
  const handleAssignToRider = (rider: any, pincode: string) => {    startTransition(async () => {
      const res = await assignServiceAreaToRider(rider.id, pincode);
      if (res.success) {
        toast.success("Pincode mapped to rider successfully!");
        revalidateRidersPage();
      } else {
        toast.error(res.error);
      }
    });
  };

  const handleUnassign = (areaId: string) => {
    startTransition(async () => {
      const res = await updateAreaAssignment(areaId, null);
      if (res.success) {
        toast.success("Pincode removed from rider.");
        revalidateRidersPage();
      } else toast.error(res.error);
    });
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* SECTION 1: CLINIC-GROUPED SERVICE AREAS */}
      <Card className="border-border shadow-sm">
        <div className="p-4 md:p-6 border-b flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4">
          <div className="flex flex-col items-start gap-1">
            <SectionHeader
              title="Service Areas by Clinic"
              icon={MapIcon}
              className="mb-0"
            />
            <div className="pl-8">
              <Badge
                variant="secondary"
                className="bg-primary/10 text-primary hover:bg-primary/20"
              >
                {allAreas.length} Total Pincodes
              </Badge>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 w-full xl:w-auto">
            <Select value={filterClinicId} onValueChange={setFilterClinicId}>
              <SelectTrigger className="w-[220px] bg-background">
                <SelectValue placeholder="Filter by Clinic" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Clinics</SelectItem>
                {clinics.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Lock/Unlock Toggle */}
            <div className="flex items-center gap-2 px-3 py-1.5 border rounded-md bg-background">
              {isUnlockMode ? (
                <Unlock className="h-4 w-4 text-destructive" />
              ) : (
                <Lock className="h-4 w-4 text-muted-foreground" />
              )}
              <button
                role="switch"
                aria-checked={isUnlockMode}
                onClick={() => setIsUnlockMode(!isUnlockMode)}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${isUnlockMode ? "bg-destructive" : "bg-input"}`}
              >
                <span
                  className={`pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform ${isUnlockMode ? "translate-x-4" : "translate-x-0"}`}
                />
              </button>
            </div>

            <ExportButton
              onClick={handleExportAreas}
              disabled={allAreas.length === 0}
            />
            <Button
              onClick={handleRefreshClinicMapping}
              disabled={isRefreshing || isPending}
              variant="outline"
              className="border-primary/30 text-primary hover:bg-primary/5"
              title="Re-map customers with missing clinic assignment based on pincode"
            >
              {isRefreshing ? (
                <Loader2 className="h-4 w-4 md:mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 md:mr-2" />
              )}
              <span className="hidden md:inline">Refresh Mapping</span>
            </Button>
            <Button
              onClick={openAddModal}
              disabled={clinics.length === 0}
              className="bg-primary text-primary-foreground shadow-sm"
            >
              <Plus className="h-4 w-4 md:mr-2" />{" "}
              <span className="hidden md:inline">Add Pincode</span>
            </Button>
          </div>
        </div>

        <CardContent className="p-4 md:p-6 bg-muted/5 space-y-6">
          {visibleGroups.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground bg-card border rounded-md shadow-sm">
              {clinics.length === 0
                ? "No clinics available. Create a clinic first to add service areas."
                : "No service areas found for this filter."}
            </div>
          ) : (
            visibleGroups.map((group) => {
              const isNoClinic = group.clinicId === NO_CLINIC;
              return (
                <div
                  key={group.clinicId}
                  className="rounded-lg border bg-card shadow-sm"
                >
                  <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Building2
                        className={`h-4 w-4 ${isNoClinic ? "text-muted-foreground" : "text-primary"}`}
                      />
                      <span
                        className={`font-semibold ${isNoClinic ? "italic text-muted-foreground" : "text-foreground"}`}
                      >
                        {isNoClinic
                          ? "Unassigned to any Clinic"
                          : clinicLabel(group.clinicId)}
                      </span>
                    </div>
                    <Badge variant="outline" className="text-xs">
                      {group.areas.length} pincode
                      {group.areas.length === 1 ? "" : "s"}
                    </Badge>
                  </div>

                  <div className="p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7 gap-3">
                    {group.areas.map((area: any) => (
                      <div
                        key={area.id}
                        className="bg-card border rounded-lg p-3 flex flex-col justify-between shadow-sm relative group overflow-hidden transition-all hover:border-primary/40 hover:shadow-md"
                      >
                        {isUnlockMode && (
                          <div className="absolute top-1 right-1 flex bg-card/90 backdrop-blur-sm rounded-md shadow-sm border border-border/50">
                            {!isNoClinic && clinics.length > 1 && (
                              <button
                                onClick={() => openMoveModal(area)}
                                title="Move to another clinic"
                                className="p-1.5 text-muted-foreground hover:text-primary transition-colors"
                              >
                                <ArrowRightLeft className="h-3.5 w-3.5" />
                              </button>
                            )}
                            <button
                              onClick={() => openEditModal(area)}
                              title="Edit pincode"
                              className="p-1.5 text-muted-foreground hover:text-primary transition-colors"
                            >
                              <Edit className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => confirmDelete(area.id)}
                              title="Delete pincode"
                              className="p-1.5 text-muted-foreground hover:text-destructive transition-colors"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )}

                        <div>
                          <h3
                            className="font-semibold text-foreground text-sm truncate pr-10"
                            title={area.area_name}
                          >
                            {area.area_name}
                          </h3>
                          <div className="flex items-center text-xs text-muted-foreground mt-1 font-mono">
                            <MapPin className="h-3 w-3 mr-1" /> {area.pincode}
                          </div>
                        </div>

                        <div className="mt-3">
                          {area.rider_id ? (
                            <Badge
                              variant="outline"
                              className="text-[10px] h-5 px-1.5 bg-primary/5 text-primary border-primary/20"
                              title="Assigned Rider"
                            >
                              {getRiderEmpCode(area.rider_id) || "Assigned"}
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="text-[10px] h-5 px-1.5 text-muted-foreground border-border bg-muted/30"
                            >
                              Unassigned
                            </Badge>
                          )}
                        </div>

                        {isNoClinic && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={clinics.length === 0}
                            onClick={() => openAssignClinicModal(area)}
                            className="mt-3 h-7 w-full border-primary/30 text-primary hover:bg-primary/5 text-xs"
                          >
                            <Building2 className="mr-1.5 h-3.5 w-3.5" />
                            Assign to clinic
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      {/* SECTION 2: RIDER TERRITORY MAPPING (clinic-constrained) */}
      <Card className="border-border shadow-sm">
        <div className="p-4 md:p-6 border-b flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <SectionHeader
            title="Rider Territory Mapping"
            icon={MapPin}
            className="mb-0"
          />
          <ExportButton
            onClick={handleExportMapping}
            disabled={riders.length === 0}
            label="Export Mapping"
          />
        </div>
        <CardContent className="p-4 md:p-6 bg-muted/5">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {riders.map((rider) => {
              const riderAreas = allAreas.filter(
                (a) => a.rider_id === rider.id,
              );
              // Only the rider's own clinic pincodes that are still unassigned
              // are selectable (Req 9.2/9.3). Backend re-validates the boundary.
              const assignable = rider.clinic_id
                ? allAreas.filter(
                    (a) => a.clinic_id === rider.clinic_id && !a.rider_id,
                  )
                : [];
              return (
                <div
                  key={rider.id}
                  className="bg-card border rounded-xl p-5 shadow-sm flex flex-col h-full hover:shadow-md transition-shadow"
                >
                  <div className="flex items-center justify-between mb-4 pb-3 border-b">
                    <div>
                      <h3 className="font-bold text-foreground">
                        {rider.fullName}
                      </h3>
                      <span className="text-xs font-mono text-muted-foreground">
                        {rider.employee_code}
                      </span>
                      <div className="mt-1 flex items-center gap-1 text-xs">
                        <Building2 className="h-3 w-3 text-muted-foreground" />
                        <span
                          className={
                            rider.clinic_id
                              ? "text-foreground"
                              : "italic text-muted-foreground"
                          }
                        >
                          {clinicLabel(rider.clinic_id)}
                        </span>
                      </div>
                    </div>
                    <Badge
                      variant={rider.is_online ? "default" : "secondary"}
                      className={
                        rider.is_online
                          ? "bg-emerald-500 hover:bg-emerald-600"
                          : ""
                      }
                    >
                      {rider.is_online ? "Online" : "Offline"}
                    </Badge>
                  </div>

                  <div className="flex-1">
                    <p className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wider">
                      Assigned Territories
                    </p>
                    <div className="flex flex-wrap gap-2 mb-6">
                      {riderAreas.length === 0 ? (
                        <span className="text-sm text-muted-foreground/70 italic">
                          No areas assigned
                        </span>
                      ) : null}
                      {riderAreas.map((area) => (
                        <Badge
                          key={area.id}
                          variant="secondary"
                          className="pl-3 pr-1 py-1 flex items-center gap-1.5 border-primary/20 bg-primary/5 text-primary shadow-none hover:bg-primary/10 transition-colors"
                        >
                          <span>
                            {area.area_name}{" "}
                            <span className="opacity-70">({area.pincode})</span>
                          </span>
                          <button
                            onClick={() => handleUnassign(area.id)}
                            disabled={isPending}
                            className="hover:bg-primary/20 rounded-full p-0.5 transition-colors text-primary disabled:opacity-50"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  </div>

                  <div className="mt-auto pt-2">
                    {!rider.clinic_id ? (
                      <div className="text-xs text-muted-foreground italic border border-dashed rounded-md px-3 py-2 bg-muted/20">
                        Link this rider to a clinic before assigning pincodes.
                      </div>
                    ) : (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="outline"
                            disabled={isPending}
                            className="w-full border-dashed border-border hover:border-primary/50 text-muted-foreground justify-start bg-background shadow-sm"
                          >
                            {isPending ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <Plus className="mr-2 h-4 w-4" />
                            )}
                            Assign clinic pincode...
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent className="w-[280px]">
                          {assignable.length === 0 ? (
                            <DropdownMenuItem
                              disabled
                              className="text-muted-foreground"
                            >
                              No unassigned pincodes in this clinic
                            </DropdownMenuItem>
                          ) : (
                            assignable.map((a) => (
                              <DropdownMenuItem
                                key={a.id}
                                onClick={() =>
                                  handleAssignToRider(rider, a.pincode)
                                }
                                className="cursor-pointer font-medium"
                              >
                                <MapPin className="mr-2 h-4 w-4 text-muted-foreground" />
                                {a.area_name}{" "}
                                <span className="ml-1 text-muted-foreground font-mono text-xs">
                                  ({a.pincode})
                                </span>
                              </DropdownMenuItem>
                            ))
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* --- ADD / EDIT PINCODE MODAL --- */}
      <Dialog open={isAreaModalOpen} onOpenChange={setIsAreaModalOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>
              {activeArea ? "Edit Pincode" : "Add Pincode to Clinic"}
            </DialogTitle>
            <DialogDescription>
              {activeArea
                ? "Update the 6-digit pincode for this service area."
                : "Add a 6-digit pincode and assign it to a clinic. Each pincode belongs to exactly one clinic."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            {!activeArea && (
              <div className="grid gap-2">
                <label className="text-sm font-medium">Clinic</label>
                <Select
                  value={form.clinicId}
                  onValueChange={(val) => setForm({ ...form, clinicId: val })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a clinic" />
                  </SelectTrigger>
                  <SelectContent>
                    {clinics.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {!activeArea && (
              <div className="grid gap-2">
                <label className="text-sm font-medium">
                  Area Name{" "}
                  <span className="text-muted-foreground font-normal">
                    (optional)
                  </span>
                </label>
                <Input
                  placeholder="e.g. Jubilee Hills"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
            )}
            <div className="grid gap-2">
              <label className="text-sm font-medium">Pincode</label>
              <Input
                placeholder="e.g. 500033"
                inputMode="numeric"
                maxLength={6}
                value={form.pincode}
                onChange={(e) =>
                  setForm({
                    ...form,
                    pincode: e.target.value.replace(/\D/g, "").slice(0, 6),
                  })
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAreaModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveArea} disabled={isPending}>
              {isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}{" "}
              {activeArea ? "Save Pincode" : "Add Pincode"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* --- MOVE PINCODE MODAL --- */}
      <Dialog
        open={moveState.open}
        onOpenChange={(open) =>
          setMoveState((prev) => ({ ...prev, open }))
        }
      >
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowRightLeft className="h-5 w-5 text-primary" />
              Move Pincode to Another Clinic
            </DialogTitle>
            <DialogDescription asChild>
              <div className="text-sm text-muted-foreground mt-1.5">
                Moving pincode{" "}
                <span className="font-mono font-semibold text-foreground">
                  {moveState.area?.pincode}
                </span>{" "}
                from{" "}
                <span className="font-medium text-foreground">
                  {clinicLabel(moveState.area?.clinic_id)}
                </span>{" "}
                reassigns every customer on that pincode to the destination
                clinic. This runs in a single transaction.
              </div>
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-4">
            <label className="text-sm font-medium">Destination Clinic</label>
            <Select
              value={moveState.toClinicId}
              onValueChange={(val) =>
                setMoveState((prev) => ({ ...prev, toClinicId: val }))
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select destination clinic" />
              </SelectTrigger>
              <SelectContent>
                {clinics
                  .filter((c) => c.id !== moveState.area?.clinic_id)
                  .map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() =>
                setMoveState({ open: false, area: null, toClinicId: "" })
              }
            >
              Cancel
            </Button>
            <Button onClick={handleMovePincode} disabled={isPending}>
              {isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Move Pincode
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* --- ASSIGN CLINIC MODAL (for clinic-less / legacy pincodes) --- */}
      <Dialog
        open={assignState.open}
        onOpenChange={(open) => setAssignState((prev) => ({ ...prev, open }))}
      >
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" />
              Assign Pincode to a Clinic
            </DialogTitle>
            <DialogDescription asChild>
              <div className="text-sm text-muted-foreground mt-1.5">
                Assign pincode{" "}
                <span className="font-mono font-semibold text-foreground">
                  {assignState.area?.pincode}
                </span>{" "}
                to a clinic. Customers whose primary address is on this pincode
                will be stamped to the selected clinic in a single transaction.
              </div>
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-4">
            <label className="text-sm font-medium">Clinic</label>
            <Select
              value={assignState.clinicId}
              onValueChange={(val) =>
                setAssignState((prev) => ({ ...prev, clinicId: val }))
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a clinic" />
              </SelectTrigger>
              <SelectContent>
                {clinics.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() =>
                setAssignState({ open: false, area: null, clinicId: "" })
              }
            >
              Cancel
            </Button>
            <Button onClick={handleAssignClinic} disabled={isPending}>
              {isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Assign Clinic
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* --- REUSABLE DELETE CONFIRMATION MODAL --- */}
      <ConfirmDeleteModal
        isOpen={deleteModalState.isOpen}
        onClose={() => setDeleteModalState({ isOpen: false, areaId: "" })}
        onConfirm={executeDeleteArea}
        title="Delete Pincode"
        description="Are you sure you want to delete this pincode permanently? If it is mapped to a rider, the mapping will be removed."
        isPending={isPending}
      />
    </div>
  );
}
