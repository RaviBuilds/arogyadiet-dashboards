import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDisputesByFranchise } from "@/repositories/disputeRepository";
import DisputesClient from "./DisputesClient";

export const revalidate = 0;

export default async function FranchiseDisputesPage() {
  const cookieStore = await cookies();
  const franchiseId = cookieStore.get("x-franchise-id")?.value ?? "";

  if (!franchiseId) {
    redirect("/login");
  }

  const disputes = await getDisputesByFranchise(franchiseId);

  return <DisputesClient disputes={disputes} />;
}
