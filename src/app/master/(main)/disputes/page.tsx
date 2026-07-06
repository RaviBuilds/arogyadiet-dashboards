import { getAllDisputes, getFranchisesWithDisputes } from "@/repositories/disputeRepository";
import DisputesClient from "./DisputesClient";

export const revalidate = 0;

export default async function MasterDisputesPage() {
  const [disputes, franchisesWithDisputes] = await Promise.all([
    getAllDisputes(),
    getFranchisesWithDisputes(),
  ]);

  return (
    <DisputesClient
      disputes={disputes}
      franchises={franchisesWithDisputes}
    />
  );
}
