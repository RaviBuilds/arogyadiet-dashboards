import { cookies } from "next/headers";
import FranchiseRiders from "@/shared/components/franchise/FranchiseRiders";

export const revalidate = 0;

export default async function FranchiseRidersPage() {
  const cookieStore = await cookies();
  const franchiseId = cookieStore.get("x-franchise-id")?.value ?? "";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          Riders
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          View and manage your delivery riders.
        </p>
      </div>
      <FranchiseRiders role="FRANCHISE_ADMIN" franchiseId={franchiseId} />
    </div>
  );
}
