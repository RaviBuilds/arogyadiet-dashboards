"use client";

import { useState, useTransition } from "react";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Badge } from "@/shared/components/ui/badge";
import {
  Dialog,
  DialogContent,
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
  Map,
  MapPin,
  Edit,
  Trash2,
  Plus,
  X,
  Loader2,
  Lock,
  Unlock,
} from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import {
  upsertServiceArea,
  deleteServiceArea,
  updateAreaAssignment,
} from "@/actions/admin-actions/riderActions";
import { SectionHeader } from "../core/SectionHeader";
import { ExportButton } from "../core/ActionButtons";
import { ConfirmDeleteModal } from "../core/ConfirmDeleteModal";

export default function ServiceAreaManager({
  riders,
  allAreas,
}: {
  riders: any[];
  allAreas: any[];
}) {
  const [isPending, startTransition] = useTransition();
  const [isAreaModalOpen, setIsAreaModalOpen] = useState(false);
  const [activeArea, setActiveArea] = useState<any | null>(null);
  const [form, setForm] = useState({ name: "", pincode: "" });

  // New UI States
  const [isUnlockMode, setIsUnlockMode] = useState(false);
  const [filterRiderId, setFilterRiderId] = useState<string>("ALL");
  const [deleteModalState, setDeleteModalState] = useState({
    isOpen: false,
    areaId: "",
  });

  const unassignedAreas = allAreas.filter((a) => !a.rider_id);

  // Filter logic for Master List
  const filteredAreas = allAreas.filter((a) => {
    if (filterRiderId === "ALL") return true;
    if (filterRiderId === "UNASSIGNED") return !a.rider_id;
    return a.rider_id === filterRiderId;
  });

  const getRiderEmpCode = (riderId: string) => {
    const r = riders.find((r) => r.id === riderId);
    return r ? r.employee_code : null;
  };

  const handleExportAreas = () => {
    if (filteredAreas.length === 0) return;
    const exportData = filteredAreas.map((a) => ({
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

  const openAddModal = () => {
    setActiveArea(null);
    setForm({ name: "", pincode: "" });
    setIsAreaModalOpen(true);
  };

  const openEditModal = (area: any) => {
    setActiveArea(area);
    setForm({ name: area.area_name, pincode: area.pincode });
    setIsAreaModalOpen(true);
  };

  const handleSaveArea = () => {
    if (!form.name || !form.pincode) {
      toast.error("Area Name and Pincode are required.");
      return;
    }

    startTransition(async () => {
      const res = await upsertServiceArea(
        activeArea?.id || null,
        form.name,
        form.pincode,
      );
      if (res.success) {
        toast.success(
          activeArea
            ? "Service area updated successfully!"
            : "New service area added!",
        );
        setIsAreaModalOpen(false);
      } else {
        toast.error(res.error);
      }
    });
  };

  const confirmDelete = (id: string) =>
    setDeleteModalState({ isOpen: true, areaId: id });

  const executeDeleteArea = () => {
    if (!deleteModalState.areaId) return;
    startTransition(async () => {
      const res = await deleteServiceArea(deleteModalState.areaId);
      if (res.success) {
        toast.success("Service area deleted successfully.");
        setDeleteModalState({ isOpen: false, areaId: "" });
      } else {
        toast.error(res.error);
      }
    });
  };

  const handleAssign = (areaId: string, riderId: string) => {
    startTransition(async () => {
      const res = await updateAreaAssignment(areaId, riderId);
      if (res.success) toast.success("Pincode mapped to rider successfully!");
      else toast.error(res.error);
    });
  };

  const handleUnassign = (areaId: string) => {
    startTransition(async () => {
      const res = await updateAreaAssignment(areaId, null);
      if (res.success) toast.success("Pincode removed from rider.");
      else toast.error(res.error);
    });
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* SECTION 1: MASTER LIST */}
      <Card className="border-border shadow-sm">
        <div className="p-4 md:p-6 border-b flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4">
          {/* UPDATED ALIGNMENT: Stacked vertically with left padding to match text indent */}
          <div className="flex flex-col items-start gap-1">
            <SectionHeader
              title="Service Areas Database"
              icon={Map}
              className="mb-0"
            />
            <div className="pl-8">
              <Badge
                variant="secondary"
                className="bg-primary/10 text-primary hover:bg-primary/20"
              >
                {allAreas.length} Total Areas
              </Badge>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 w-full xl:w-auto">
            {/* Filter Dropdown */}
            <Select value={filterRiderId} onValueChange={setFilterRiderId}>
              <SelectTrigger className="w-[200px] bg-background">
                <SelectValue placeholder="Filter by Rider" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Service Areas</SelectItem>
                <SelectItem value="UNASSIGNED">Unassigned Only</SelectItem>
                {riders.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.fullName} ({r.employee_code})
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
              disabled={filteredAreas.length === 0}
            />
            <Button
              onClick={openAddModal}
              className="bg-primary text-primary-foreground shadow-sm"
            >
              <Plus className="h-4 w-4 md:mr-2" />{" "}
              <span className="hidden md:inline">Add Service Area</span>
            </Button>
          </div>
        </div>

        <CardContent className="p-4 md:p-6 bg-muted/5">
          {filteredAreas.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground bg-card border rounded-md shadow-sm">
              No service areas found for this filter.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7 gap-3">
              {filteredAreas.map((area) => (
                <div
                  key={area.id}
                  className="bg-card border rounded-lg p-3 flex flex-col justify-between shadow-sm relative group overflow-hidden transition-all hover:border-primary/40 hover:shadow-md"
                >
                  {/* Absolute positioned Action Buttons (Only visible if Unlocked) */}
                  {isUnlockMode && (
                    <div className="absolute top-1 right-1 flex bg-card/90 backdrop-blur-sm rounded-md shadow-sm border border-border/50">
                      <button
                        onClick={() => openEditModal(area)}
                        className="p-1.5 text-muted-foreground hover:text-primary transition-colors"
                      >
                        <Edit className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => confirmDelete(area.id)}
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
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* SECTION 2: RIDER MAPPING */}
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
                          Assign new pincode...
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="w-[280px]">
                        {unassignedAreas.length === 0 ? (
                          <DropdownMenuItem
                            disabled
                            className="text-muted-foreground"
                          >
                            No unassigned areas available
                          </DropdownMenuItem>
                        ) : (
                          unassignedAreas.map((a) => (
                            <DropdownMenuItem
                              key={a.id}
                              onClick={() => handleAssign(a.id, rider.id)}
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
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* --- ADD/EDIT MODAL --- */}
      <Dialog open={isAreaModalOpen} onOpenChange={setIsAreaModalOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>
              {activeArea ? "Edit Service Area" : "Add Service Area"}
            </DialogTitle>
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
              <Input
                placeholder="e.g. 500033"
                type="number"
                maxLength={6}
                value={form.pincode}
                onChange={(e) => setForm({ ...form, pincode: e.target.value })}
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
              Save Area
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* --- REUSABLE DELETE CONFIRMATION MODAL --- */}
      <ConfirmDeleteModal
        isOpen={deleteModalState.isOpen}
        onClose={() => setDeleteModalState({ isOpen: false, areaId: "" })}
        onConfirm={executeDeleteArea}
        title="Delete Service Area"
        description="Are you sure you want to delete this service area permanently? If this area is mapped to a rider, it will be unassigned."
        isPending={isPending}
      />
    </div>
  );
}
