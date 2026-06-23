import { Suspense } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { MasterPageHeader } from "@/shared/components/master/MasterPageHeader";
import FranchiseListClient from "./FranchiseListClient";
import type { Franchise } from "@/types/franchise";

export const revalidate = 0;

async function getFranchises(): Promise<Franchise[]> {
  const adminClient = createAdminClient();
  const { data } = await adminClient
    .from("franchises")
    .select("*")
    .order("created_at", { ascending: false });
  return (data as Franchise[]) ?? [];
}

export default async function FranchisesPage() {
  const franchises = await getFranchises();

  return (
    <div className="space-y-6">
      <MasterPageHeader
        title="Franchise Network"
        description="Onboard new franchise locations, manage lifecycle, and monitor network health."
      />
      <Suspense fallback={<FranchisesSkeleton />}>
        <FranchiseListClient franchises={franchises} />
      </Suspense>
    </div>
  );
}

function FranchisesSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-10 w-64 rounded-lg bg-slate-100" />
        <div className="h-10 w-36 rounded-lg bg-slate-100" />
      </div>
      <div className="grid grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-24 rounded-2xl bg-slate-100 border border-slate-200" />
        ))}
      </div>
      <div className="h-48 rounded-2xl bg-slate-100 border border-slate-200" />
    </div>
  );
}
