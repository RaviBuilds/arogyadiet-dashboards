// this page src/app/master/(main)/hierarchy/page.tsx
// Master Hierarchy tree page (multi-tenant-franchise — Task 13.1,
// Req 12.1/12.2/12.3/12.6). Server Component that loads the
// Business(Franchise) → City → Group → Kitchen → Franchise → Clinic hierarchy
// and hands the assembled tree to the client <HierarchyTree>.
//
// GATING (defense in depth): 
//   1. The parent layout (`(main)/layout.tsx`) already redirects any non
//      MASTER_ADMIN to /unauthorized.
//   2. This page ALSO re-resolves the caller's role and short-circuits BEFORE
//      loading any franchise data, so a non-MASTER_ADMIN viewer is exposed NO
//      franchise structure data whatsoever (Req 12.6).
//   3. The whole feature is gated behind FRANCHISE_FEATURES_ENABLED; while the
//      flag is off, no franchise table is read and a simple disabled-state is
//      rendered instead of erroring (additive-safety).

import { createClient } from "@/lib/supabase/server";
import { MasterPageHeader } from "@/shared/components/master/MasterPageHeader";
import { BackToSystem } from "@/shared/components/master/BackToSystem";
import { FRANCHISE_FEATURES_ENABLED } from "@/lib/franchise/constants";
import {
  listCitiesByBusiness,
} from "@/repositories/franchise/cityRepository";
import { listGroupsByCity } from "@/repositories/franchise/groupRepository";
import { listFranchises } from "@/repositories/franchise/franchiseRepository";
import { listClinicsByFranchise } from "@/repositories/franchise/franchiseClinicRepository";
import { listBusinesses, getKitchenById } from "@/repositories/clinic";
import { listServiceAreasByClinic } from "@/repositories/clinic/serviceAreaRepository";
import HierarchyTree, {
  type HierarchyBusinessNode,
} from "./_components/HierarchyTree";

export const revalidate = 0;

/**
 * Re-resolve the caller's role at the page level. Returns `true` only for a
 * MASTER_ADMIN. Mirrors the gating performed in `(main)/layout.tsx`.
 */
async function isMasterAdmin(): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;

  const { data } = await supabase
    .from("users")
    .select("roles(code)")
    .eq("auth_user_id", user.id)
    .single();

  const roles = data?.roles as
    | { code: string }[]
    | { code: string }
    | null
    | undefined;
  const roleCode = Array.isArray(roles) ? roles[0]?.code : roles?.code;
  return roleCode === "MASTER_ADMIN";
}

/**
 * Assemble the full franchise hierarchy tree for every Franchise Business.
 * Only invoked AFTER the MASTER_ADMIN + feature-flag checks pass, so franchise
 * data is never read for an unauthorized viewer (Req 12.6).
 */
async function loadHierarchy(): Promise<HierarchyBusinessNode[]> {
  const businesses = await listBusinesses();
  const franchiseBusinesses = businesses.filter((b) => b.type === "Franchise");

  return Promise.all(
    franchiseBusinesses.map(async (business) => {
      const cities = await listCitiesByBusiness(business.id);

      const cityNodes = await Promise.all(
        cities.map(async (city) => {
          const groups = await listGroupsByCity(city.id);

          const groupNodes = await Promise.all(
            groups.map(async (group) => {
              // A Group owns EXACTLY ONE Kitchen, resolved via group.kitchen_id.
              // Kitchen carries NO geo (Req 2.5).
              const [kitchen, franchises] = await Promise.all([
                getKitchenById(group.kitchen_id),
                listFranchises(group.id),
              ]);

              const franchiseNodes = await Promise.all(
                franchises.map(async (franchise) => {
                  const clinics = await listClinicsByFranchise(franchise.id);
                  const clinicNodes = await Promise.all(
                    clinics.map(async (c) => {
                      const serviceAreas = await listServiceAreasByClinic(c.id);
                      return {
                        id: c.id,
                        name: c.name,
                        address: c.address,
                        latitude: c.latitude,
                        longitude: c.longitude,
                        pincodes: serviceAreas.map((sa) => sa.pincode),
                      };
                    })
                  );
                  return {
                    id: franchise.id,
                    name: franchise.name,
                    status: franchise.status,
                    // Threaded for FranchiseFormDialog (edit) — the dialog's
                    // FranchiseFormTarget needs the owning Group + owner.
                    groupId: group.id,
                    ownerUserId: franchise.owner_user_id,
                    clinics: clinicNodes,
                  };
                })
              );

              return {
                id: group.id,
                name: group.name,
                cityId: city.id,
                kitchen: kitchen
                  ? { id: kitchen.id, name: kitchen.name }
                  : null,
                franchises: franchiseNodes,
              };
            })
          );

          return {
            id: city.id,
            name: city.name,
            businessId: business.id,
            groups: groupNodes,
          };
        })
      );

      return {
        id: business.id,
        name: business.name,
        cities: cityNodes,
      };
    })
  );
}

export default async function HierarchyPage() {
  // (1) Feature flag — render a calm disabled state, never error (additive-safe).
  if (!FRANCHISE_FEATURES_ENABLED) {
    return (
      <div className="space-y-6">
        <MasterPageHeader
          title="Franchise Hierarchy"
          description="City → Group → Kitchen → Franchise → Clinic management."
          action={<BackToSystem />}
        />
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white/50 py-16 text-center">
          <p className="text-sm font-medium text-slate-500">
            Franchise features are disabled.
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Enable the franchise feature flag to manage the hierarchy.
          </p>
        </div>
      </div>
    );
  }

  // (2) MASTER_ADMIN gate BEFORE any franchise data is read (Req 12.6).
  if (!(await isMasterAdmin())) {
    return (
      <div className="space-y-6">
        <MasterPageHeader
          title="Franchise Hierarchy"
          description="City → Group → Kitchen → Franchise → Clinic management."
        />
        <div className="rounded-2xl border border-dashed border-red-200 bg-red-50/40 py-16 text-center">
          <p className="text-sm font-medium text-red-600">Access denied</p>
          <p className="mt-1 text-xs text-slate-500">
            Only Master Admins can view the franchise hierarchy.
          </p>
        </div>
      </div>
    );
  }

  // (3) Authorized — assemble and render the tree.
  const businesses = await loadHierarchy();

  return (
    <div className="space-y-6">
      <MasterPageHeader
        title="Franchise Hierarchy"
        description="Manage the full City → Group → Kitchen → Franchise → Clinic structure. Expand a city to drill into its groups, kitchens, franchises, and wired clinics."
        action={<BackToSystem />}
      />
      <HierarchyTree businesses={businesses} />
    </div>
  );
}
