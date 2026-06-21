import { createAdminClient } from "@/lib/supabase/admin";
import { notFound } from "next/navigation";
import FranchiseDetailClient from "./FranchiseDetailClient";
import PincodeConflictSection from "./PincodeConflictSection";
import type { FranchiseWithPincodes } from "@/types/franchise";

export const revalidate = 0;

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function FranchiseDetailPage({ params }: PageProps) {
  const { id } = await params;
  const adminClient = createAdminClient();

  const { data: franchise } = await adminClient
    .from("franchises")
    .select("*")
    .eq("id", id)
    .single();

  if (!franchise) return notFound();

  const { data: pincodes } = await adminClient
    .from("franchise_pincodes")
    .select("*")
    .eq("franchise_id", id)
    .order("pincode");

  const franchiseWithPincodes: FranchiseWithPincodes = {
    ...franchise,
    pincodes: pincodes ?? [],
  };

  return (
    <div className="space-y-6">
      <FranchiseDetailClient franchise={franchiseWithPincodes} />
      <PincodeConflictSection
        franchiseId={id}
        pincodeCount={franchiseWithPincodes.pincodes.length}
      />
    </div>
  );
}
