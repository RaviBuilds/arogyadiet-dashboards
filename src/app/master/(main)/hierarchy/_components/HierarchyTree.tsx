"use client";

// src/app/master/(main)/hierarchy/_components/HierarchyTree.tsx
// Master Hierarchy tree (multi-tenant-franchise — Task 13, Req 12.1/12.2/12.3).
//
// Client Component that renders the franchise structure as an expandable tree:
//   Business(Franchise) → City → Group ( + its single Kitchen, NO geo ) →
//   Franchise ( + status badge ) → wired Clinics ( WITH geo ).
//
// Task 13 final wiring: the previously DISABLED placeholder buttons at each
// mount point are now replaced with the real dialog leaves
// (CityFormDialog, GroupFormDialog, FranchiseFormDialog, FranchiseStatusControls,
// InterGroupMoveDialog, ClinicWiringDialog, AgreementDocsPanel) plus a small
// AlertDialog-based delete-confirm for City/Group. Each dialog renders its own
// trigger (matching the prior look) unless noted; ClinicWiringDialog is fully
// controlled, so it is wrapped with a local open-state trigger here.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Building2,
  MapPin,
  ChefHat,
  Store,
  Hospital,
  ChevronRight,
  Plus,
  Pencil,
  Trash2,
  FileText,
  Navigation,
} from "lucide-react";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader } from "@/shared/components/ui/card";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/shared/components/ui/alert-dialog";
import type { ActionResult, FranchiseStatus } from "@/types/franchise";
import { deleteFranchiseCity } from "@/actions/master-actions/cityActions";
import { deleteGroup } from "@/actions/master-actions/groupActions";

import BusinessFormDialog from "./BusinessFormDialog";
import CityFormDialog from "./CityFormDialog";
import GroupFormDialog from "./GroupFormDialog";
import FranchiseFormDialog from "./FranchiseFormDialog";
import FranchiseStatusControls from "./FranchiseStatusControls";
import InterGroupMoveDialog, {
  type InterGroupMoveGroupOption,
} from "./InterGroupMoveDialog";
import { ClinicWiringDialog } from "./ClinicWiringDialog";
import { AgreementDocsPanel } from "./AgreementDocsPanel";

// ───────────────────────────────────────────────────────────────────────────
// Tree node shapes assembled by the Server Component (page.tsx) and passed in.
// Kitchen carries NO geo (Req 2.5); geo lives ONLY on the Clinic (Req 6.1).
// ───────────────────────────────────────────────────────────────────────────

export interface HierarchyClinicNode {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  pincodes: string[];
}

export interface HierarchyFranchiseNode {
  id: string;
  name: string;
  status: FranchiseStatus;
  /** The owning Group id — threaded for the franchise edit dialog. */
  groupId: string;
  /** The single FRANCHISE_ADMIN owner — threaded for the franchise edit dialog. */
  ownerUserId: string;
  clinics: HierarchyClinicNode[];
}

/** The single Kitchen a Group owns. Intentionally has NO address/lat/lng. */
export interface HierarchyKitchenNode {
  id: string;
  name: string;
}

export interface HierarchyGroupNode {
  id: string;
  name: string;
  /** The owning City id — threaded for the group edit dialog. */
  cityId: string;
  kitchen: HierarchyKitchenNode | null;
  franchises: HierarchyFranchiseNode[];
}

export interface HierarchyCityNode {
  id: string;
  name: string;
  /** The owning Franchise Business id — threaded for the city edit dialog. */
  businessId: string;
  groups: HierarchyGroupNode[];
}

export interface HierarchyBusinessNode {
  id: string;
  name: string;
  cities: HierarchyCityNode[];
}

interface HierarchyTreeProps {
  businesses: HierarchyBusinessNode[];
}

const STATUS_VARIANT: Record<
  FranchiseStatus,
  { className: string; label: string }
> = {
  onboarding: {
    className: "bg-amber-50 text-amber-700 border-amber-200",
    label: "Onboarding",
  },
  active: {
    className: "bg-emerald-50 text-emerald-700 border-emerald-200",
    label: "Active",
  },
  suspended: {
    className: "bg-red-50 text-red-700 border-red-200",
    label: "Suspended",
  },
};

export default function HierarchyTree({ businesses }: HierarchyTreeProps) {
  // Expansion state — a Set of node keys that are currently expanded.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const isExpanded = (key: string) => expanded.has(key);
  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  if (businesses.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-white/50 py-16 text-center">
        <Building2 className="mx-auto mb-3 h-12 w-12 text-slate-200" />
        <p className="text-sm font-medium text-slate-500">
          No Franchise Businesses yet
        </p>
        <p className="mt-1 mb-5 text-xs text-slate-400">
          Create a Franchise Business and its cities to start building the
          hierarchy.
        </p>
        {/* Top-level entry point: create the first Franchise Business. */}
        <BusinessFormDialog mode="create" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top-level action: add another Franchise Business. */}
      <div className="flex justify-end">
        <BusinessFormDialog mode="create" />
      </div>
      {businesses.map((business) => (
        <Card key={business.id} className="gap-0 py-0">
          <CardHeader className="flex flex-row items-center justify-between gap-3 border-b py-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100">
                <Building2 className="h-4 w-4 text-slate-700" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-800">
                  {business.name}
                </p>
                <p className="text-[11px] text-slate-400">
                  Franchise Business · {business.cities.length}{" "}
                  {business.cities.length === 1 ? "city" : "cities"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {/* Rename this Franchise Business. */}
              <BusinessFormDialog
                mode="edit"
                business={{ id: business.id, name: business.name }}
              />
              {/* Task 13.2: City create — dialog renders its own "Add City" trigger. */}
              <CityFormDialog mode="create" businessId={business.id} />
            </div>
          </CardHeader>

          <CardContent className="py-3">
            {business.cities.length === 0 ? (
              <p className="px-2 py-4 text-xs text-slate-400">
                No cities in this business yet.
              </p>
            ) : (
              <ul className="space-y-1">
                {business.cities.map((city) => {
                  const cityKey = `city:${city.id}`;
                  const cityOpen = isExpanded(cityKey);
                  return (
                    <li key={city.id}>
                      <CityRow
                        city={city}
                        expanded={cityOpen}
                        onToggle={() => toggle(cityKey)}
                      />
                      {cityOpen && (
                        <GroupList
                          city={city}
                          isExpanded={isExpanded}
                          toggle={toggle}
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ── shared delete-confirm (City / Group) ─────────────────────────────────────

function DeleteConfirmButton({
  ariaLabel,
  title,
  description,
  action,
  successMessage,
}: {
  ariaLabel: string;
  title: string;
  description: string;
  /** Dependency-guarded delete action (cityActions / groupActions). */
  action: () => Promise<ActionResult>;
  successMessage: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const onConfirm = () => {
    startTransition(async () => {
      const result = await action();
      if (result.success) {
        toast.success(successMessage);
        setOpen(false);
        router.refresh();
      } else {
        // Surface the dependency-guard message verbatim (Req 1.4–1.6 / 2.7–2.8).
        toast.error(result.error);
      }
    });
  };

  return (
    <AlertDialog open={open} onOpenChange={(next) => !isPending && setOpen(next)}>
      <AlertDialogTrigger asChild>
        <Button type="button" size="icon-sm" variant="ghost" aria-label={ariaLabel}>
          <Trash2 className="h-3.5 w-3.5 text-slate-400" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            onClick={onConfirm}
            disabled={isPending}
          >
            {isPending ? "Deleting..." : "Delete"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ── City ────────────────────────────────────────────────────────────────────

function CityRow({
  city,
  expanded,
  onToggle,
}: {
  city: HierarchyCityNode;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg px-2 py-2 hover:bg-slate-50">
      <button
        type="button"
        onClick={onToggle}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <ExpandToggleInline expanded={expanded} />
        <MapPin className="h-4 w-4 shrink-0 text-blue-600" />
        <span className="truncate text-sm font-semibold text-slate-800">
          {city.name}
        </span>
        <span className="text-[11px] text-slate-400">
          {city.groups.length} {city.groups.length === 1 ? "group" : "groups"}
        </span>
      </button>
      <div className="flex shrink-0 items-center gap-1">
        {/* Task 13.2: City edit — dialog renders its own pencil trigger. */}
        <CityFormDialog
          mode="edit"
          city={{ id: city.id, name: city.name, business_id: city.businessId }}
        />
        {/* Task 13.2: City delete (dependency-guarded → cityActions). */}
        <DeleteConfirmButton
          ariaLabel="Delete city"
          title={`Delete "${city.name}"?`}
          description="This permanently deletes the city. It is blocked if the city still has groups."
          action={() => deleteFranchiseCity(city.id)}
          successMessage="City deleted."
        />
        {/* Task 13.2: Group create (Group + its Kitchen) — dialog renders its own trigger. */}
        <GroupFormDialog mode="create" cityId={city.id} />
      </div>
    </div>
  );
}

// ── Group (+ its single Kitchen, NO geo) ─────────────────────────────────────

function GroupList({
  city,
  isExpanded,
  toggle,
}: {
  city: HierarchyCityNode;
  isExpanded: (key: string) => boolean;
  toggle: (key: string) => void;
}) {
  if (city.groups.length === 0) {
    return (
      <p className="ml-9 py-2 pl-2 text-xs text-slate-400">
        No groups in this city yet.
      </p>
    );
  }

  // Same-city group options for the inter-group move dialog (Req 5.2). Each
  // carries its Kitchen name so the move dialog can preview the re-resolved
  // Kitchen (Req 5.4). InterGroupMoveDialog defensively excludes the current group.
  const sameCityGroups: InterGroupMoveGroupOption[] = city.groups.map((g) => ({
    id: g.id,
    name: g.name,
    kitchenName: g.kitchen?.name,
  }));

  return (
    <ul className="ml-6 space-y-1 border-l border-slate-100 pl-3">
      {city.groups.map((group) => {
        const groupKey = `group:${group.id}`;
        const groupOpen = isExpanded(groupKey);
        return (
          <li key={group.id}>
            <GroupRow
              group={group}
              cityId={city.id}
              expanded={groupOpen}
              onToggle={() => toggle(groupKey)}
            />
            {groupOpen && (
              <div className="ml-6 space-y-2 border-l border-slate-100 pl-3 pt-1">
                {/* Group's single Kitchen — shown WITHOUT geo fields (Req 2.5) */}
                <KitchenRow kitchen={group.kitchen} />
                <FranchiseList
                  group={group}
                  sameCityGroups={sameCityGroups}
                  isExpanded={isExpanded}
                  toggle={toggle}
                />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function GroupRow({
  group,
  cityId,
  expanded,
  onToggle,
}: {
  group: HierarchyGroupNode;
  cityId: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-slate-50">
      <button
        type="button"
        onClick={onToggle}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <ExpandToggleInline expanded={expanded} />
        <Store className="h-4 w-4 shrink-0 text-violet-600" />
        <span className="truncate text-sm font-medium text-slate-700">
          {group.name}
        </span>
        <span className="text-[11px] text-slate-400">
          {group.franchises.length}{" "}
          {group.franchises.length === 1 ? "franchise" : "franchises"}
        </span>
      </button>
      <div className="flex shrink-0 items-center gap-1">
        {/* Task 13.2: Group edit (rename only) — dialog renders its own pencil trigger. */}
        <GroupFormDialog
          mode="edit"
          group={{ id: group.id, name: group.name, city_id: cityId }}
        />
        {/* Task 13.2: Group delete (deletes Group + its Kitchen → groupActions). */}
        <DeleteConfirmButton
          ariaLabel="Delete group"
          title={`Delete "${group.name}"?`}
          description="This permanently deletes the group and its kitchen. It is blocked if the group still has franchises."
          action={() => deleteGroup(group.id)}
          successMessage="Group deleted."
        />
        {/* Task 13.3: Franchise create — dialog renders its own trigger. */}
        <FranchiseFormDialog mode="create" groupId={group.id} />
      </div>
    </div>
  );
}

function KitchenRow({ kitchen }: { kitchen: HierarchyKitchenNode | null }) {
  if (!kitchen) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-amber-50/60 px-2 py-1.5">
        <ChefHat className="h-4 w-4 shrink-0 text-amber-500" />
        <span className="text-xs text-amber-700">
          Kitchen not resolved for this group.
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 rounded-lg bg-slate-50/70 px-2 py-1.5">
      <ChefHat className="h-4 w-4 shrink-0 text-orange-600" />
      <span className="text-sm font-medium text-slate-700">{kitchen.name}</span>
      <Badge variant="outline" className="border-slate-200 text-[10px] text-slate-500">
        Kitchen
      </Badge>
      {/* NOTE: Kitchen intentionally shows NO address / lat / lng (Req 2.5). */}
    </div>
  );
}

// ── Franchise (+ status badge) ───────────────────────────────────────────────

function FranchiseList({
  group,
  sameCityGroups,
  isExpanded,
  toggle,
}: {
  group: HierarchyGroupNode;
  sameCityGroups: InterGroupMoveGroupOption[];
  isExpanded: (key: string) => boolean;
  toggle: (key: string) => void;
}) {
  if (group.franchises.length === 0) {
    return (
      <p className="py-1.5 pl-2 text-xs text-slate-400">
        No franchises in this group yet.
      </p>
    );
  }
  return (
    <ul className="space-y-1">
      {group.franchises.map((franchise) => {
        const franchiseKey = `franchise:${franchise.id}`;
        const franchiseOpen = isExpanded(franchiseKey);
        return (
          <li key={franchise.id}>
            <FranchiseRow
              franchise={franchise}
              currentGroupId={group.id}
              sameCityGroups={sameCityGroups}
              expanded={franchiseOpen}
              onToggle={() => toggle(franchiseKey)}
            />
            {franchiseOpen && <ClinicList franchise={franchise} />}
          </li>
        );
      })}
    </ul>
  );
}

function FranchiseRow({
  franchise,
  currentGroupId,
  sameCityGroups,
  expanded,
  onToggle,
}: {
  franchise: HierarchyFranchiseNode;
  currentGroupId: string;
  sameCityGroups: InterGroupMoveGroupOption[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const status = STATUS_VARIANT[franchise.status];
  return (
    <div className="flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-slate-50">
      <button
        type="button"
        onClick={onToggle}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <ExpandToggleInline expanded={expanded} />
        <Building2 className="h-4 w-4 shrink-0 text-slate-600" />
        <span className="truncate text-sm font-medium text-slate-700">
          {franchise.name}
        </span>
        <Badge variant="outline" className={status.className}>
          {status.label}
        </Badge>
        <span className="text-[11px] text-slate-400">
          {franchise.clinics.length}{" "}
          {franchise.clinics.length === 1 ? "clinic" : "clinics"}
        </span>
      </button>
      <div className="flex shrink-0 items-center gap-1">
        {/* Task 13.3: Franchise edit (+ assign owner) — dialog renders its own trigger. */}
        <FranchiseFormDialog
          mode="edit"
          franchise={{
            id: franchise.id,
            name: franchise.name,
            group_id: franchise.groupId,
            owner_user_id: franchise.ownerUserId,
            status: franchise.status,
          }}
        />
        {/* Task 13.3: Franchise lifecycle status controls (activate/suspend/reactivate). */}
        <FranchiseStatusControls
          franchise={{ id: franchise.id, status: franchise.status }}
        />
        {/* Task 13.4: Inter-group move (same-City groups only) — dialog renders its own trigger. */}
        <InterGroupMoveDialog
          franchise={{ id: franchise.id, name: franchise.name }}
          currentGroupId={currentGroupId}
          sameCityGroups={sameCityGroups}
        />
        {/* Task 13.6: Agreement documents (upload/list/replace). */}
        <AgreementDocsPanel
          franchiseId={franchise.id}
          trigger={
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label="Agreement documents"
            >
              <FileText className="h-3.5 w-3.5 text-slate-400" />
            </Button>
          }
        />
        {/* Task 13.5: Wire a new Clinic to this franchise (controlled dialog).
            Franchise business allows max 1 clinic per franchise — hide when one exists. */}
        {franchise.clinics.length === 0 && (
          <WireClinicButton franchiseId={franchise.id} />
        )}
      </div>
    </div>
  );
}

// ── Clinic (WITH geo) ────────────────────────────────────────────────────────

function ClinicList({ franchise }: { franchise: HierarchyFranchiseNode }) {
  if (franchise.clinics.length === 0) {
    return (
      <p className="ml-9 py-1.5 pl-2 text-xs text-slate-400">
        No wired clinics for this franchise yet.
      </p>
    );
  }
  return (
    <ul className="ml-6 space-y-1 border-l border-slate-100 pl-3">
      {franchise.clinics.map((clinic) => (
        <li
          key={clinic.id}
          className="flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-slate-50"
        >
          <div className="flex min-w-0 flex-1 items-start gap-2">
            <Hospital className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-700">
                {clinic.name}
              </p>
              {/* Geo lives ONLY on the Clinic (Req 6.1). */}
              <p className="truncate text-[11px] text-slate-400">
                {clinic.address}
              </p>
              <p className="flex items-center gap-1 text-[10px] text-slate-400">
                <Navigation className="h-3 w-3" />
                {clinic.latitude.toFixed(5)}, {clinic.longitude.toFixed(5)}
              </p>
              {/* Served pincodes display */}
              {clinic.pincodes.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {clinic.pincodes.map((pin) => (
                    <span
                      key={pin}
                      className="inline-flex items-center rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700"
                    >
                      {pin}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
          {/* Task 13.5: Edit clinic geo + served pincodes (controlled dialog). */}
          <EditClinicButton clinic={clinic} franchiseId={franchise.id} />
        </li>
      ))}
    </ul>
  );
}

// ── controlled ClinicWiringDialog wrappers ───────────────────────────────────
// ClinicWiringDialog is a fully controlled dialog that renders NO trigger of its
// own, so each mount point owns its open state and renders a matching trigger.

function WireClinicButton({ franchiseId }: { franchiseId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="gap-1.5"
        onClick={() => setOpen(true)}
      >
        <Plus className="h-3.5 w-3.5" />
        Wire Clinic
      </Button>
      <ClinicWiringDialog
        mode="create"
        franchiseId={franchiseId}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}

function EditClinicButton({
  clinic,
  franchiseId,
}: {
  clinic: HierarchyClinicNode;
  franchiseId: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label="Edit clinic wiring"
        onClick={() => setOpen(true)}
      >
        <Pencil className="h-3.5 w-3.5 text-slate-400" />
      </Button>
      <ClinicWiringDialog
        mode="edit"
        clinic={{
          id: clinic.id,
          name: clinic.name,
          address: clinic.address,
          latitude: clinic.latitude,
          longitude: clinic.longitude,
          franchise_id: franchiseId,
        }}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}

// ── shared inline chevron ─────────────────────────────────────────────────────

function ExpandToggleInline({ expanded }: { expanded: boolean }) {
  return (
    <ChevronRight
      className={`h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200 ${
        expanded ? "rotate-90" : ""
      }`}
    />
  );
}
