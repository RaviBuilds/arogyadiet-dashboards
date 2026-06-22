import { cookies } from "next/headers";
import FranchiseDashboardClient from "./FranchiseDashboardClient";

export const revalidate = 0;

export default async function FranchiseDashboardPage() {
  const cookieStore = await cookies();
  const franchiseId = cookieStore.get("x-franchise-id")?.value ?? "";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          Dashboard
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Your franchise operations at a glance.
        </p>
      </div>
      <FranchiseDashboardClient franchiseId={franchiseId} />
    </div>
  );
}
