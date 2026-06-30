// src/shared/components/master/core-business/CoreBusinessSection.tsx
// Server Component for the additive master-portal "Core Business" section
// (core-clinic-architecture, Task 14.1). Rendered BELOW the existing, untouched
// "Core Clinic Management" card on the master /system page (Req 21.2, 21.7).
//
// Scope (Req 21.3): the Core business only. This RSC fetches the full
// Business → Kitchen → Clinic hierarchy through the clinic repositories and
// narrows it to the Core scope before handing the lists to the client leaf
// managers:
//   - businesses of type "Core"
//   - kitchens owned by those Core businesses
//   - Core Clinics (franchise_id IS NULL) served by those Core kitchens
//
// The client leaves host the React Hook Form + Zod create/edit/delete forms
// wired to businessActions / kitchenActions / clinicActions. Kitchen forms carry
// NO geo fields (Req 21.4); Core Clinic forms carry full address + lat + lng
// (Req 21.5). A clinic-to-kitchen reassignment control is included
// (Req 2.13, 2.14).

import { Hospital } from "lucide-react";

import {
  listBusinesses,
  listKitchens,
  listClinics,
  listCities,
} from "@/repositories/clinic";
import { selectCoreBusinessScope } from "@/lib/clinic/core-business-scope";

import { BusinessManager } from "./BusinessManager";
import { CoreKitchenManager } from "./CoreKitchenManager";
import { CoreClinicManager } from "./CoreClinicManager";

export async function CoreBusinessSection() {
  const [businesses, kitchens, clinics, cities] = await Promise.all([
    listBusinesses(),
    listKitchens(),
    listClinics(),
    listCities(),
  ]);

  // Narrow to the Core scope (Req 21.3) via the pure, unit-tested helper.
  const { coreBusinesses, coreKitchens, coreClinics } = selectCoreBusinessScope(
    businesses,
    kitchens,
    clinics
  );

  return (
    <section className="space-y-4" aria-labelledby="core-business-heading">
      <div className="flex items-center gap-2 border-t border-slate-200 pt-6">
        <Hospital className="h-5 w-5 text-emerald-600" />
        <div>
          <h2
            id="core-business-heading"
            className="text-base font-semibold text-slate-800"
          >
            Core Business
          </h2>
          <p className="text-xs text-slate-500">
            Manage the core business, its kitchens (no geo), and its core clinics
            (full address + coordinates).
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <BusinessManager businesses={coreBusinesses} />
        <CoreKitchenManager
          kitchens={coreKitchens}
          businesses={coreBusinesses}
          cities={cities}
        />
        <CoreClinicManager clinics={coreClinics} kitchens={coreKitchens} />
      </div>
    </section>
  );
}
