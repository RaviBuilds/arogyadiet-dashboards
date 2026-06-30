// src/app/master/(main)/core-clinics/page.tsx
// Master-portal "Core Clinic Management" route (core-clinic-architecture,
// Task 11.1). Server Component: fetches the City → Kitchen → Clinic hierarchy
// through the clinic repositories and hands the lists to client leaf components
// that host the React Hook Form + Zod create/edit/delete forms wired to the
// master Server Actions (Req 14.1–14.7).

import { MasterPageHeader } from "@/shared/components/master/MasterPageHeader";
import { BackToSystem } from "@/shared/components/master/BackToSystem";
import { CityManager } from "@/shared/components/master/core-clinics/CityManager";
import { KitchenManager } from "@/shared/components/master/core-clinics/KitchenManager";
import { ClinicManager } from "@/shared/components/master/core-clinics/ClinicManager";
import {
  listBusinesses,
  listCities,
  listKitchens,
  listClinics,
} from "@/repositories/clinic";

export const revalidate = 0;

export default async function CoreClinicsPage() {
  const [businesses, cities, kitchens, clinics] = await Promise.all([
    listBusinesses(),
    listCities(),
    listKitchens(),
    listClinics(),
  ]);

  return (
    <div className="space-y-6">
      <MasterPageHeader
        title="Core Clinic Management"
        description="Manage the City → Kitchen → Clinic hierarchy — create, edit, and delete cities, kitchens, and clinics."
        action={<BackToSystem />}
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <CityManager cities={cities} businesses={businesses} />
        <KitchenManager
          kitchens={kitchens}
          businesses={businesses}
          cities={cities}
        />
        <ClinicManager clinics={clinics} kitchens={kitchens} />
      </div>
    </div>
  );
}
