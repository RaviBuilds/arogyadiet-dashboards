import { Suspense } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
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
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          Franchise Network
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Manage franchise registry, lifecycle, and onboarding.
        </p>
      </div>
      <Suspense fallback={<FranchisesSkeleton />}>
        <FranchiseListClient franchises={franchises} />
      </Suspense>
    </div>
  );
}

function FranchisesSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-10 w-48 rounded-lg bg-slate-100" />
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 rounded-lg bg-slate-100 border border-slate-200" />
        ))}
      </div>
    </div>
  );
}
