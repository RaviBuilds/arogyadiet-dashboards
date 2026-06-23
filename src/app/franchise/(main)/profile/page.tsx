import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cookies } from "next/headers";
import { Badge } from "@/shared/components/ui/badge";
import { Building2, User } from "lucide-react";
import { PageHeader } from "@/shared/components/franchise/ui/PageHeader";
import { SectionCard } from "@/shared/components/franchise/ui/GlassCard";
import FranchiseServiceAreaCard from "./FranchiseServiceAreaCard";
import type { FranchisePincodeRequest } from "@/types/franchise";

export const revalidate = 0;

export default async function FranchiseProfilePage() {
  const supabase = await createClient();
  const cookieStore = await cookies();
  const franchiseId = cookieStore.get("x-franchise-id")?.value;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: userProfile } = await supabase
    .from("users")
    .select("full_name, email, mobile")
    .eq("auth_user_id", user?.id ?? "")
    .single();

  let franchise: { name: string; status: string; created_at: string } | null = null;
  let pincodes: string[] = [];
  let requests: FranchisePincodeRequest[] = [];

  // Franchise + pincode records are protected by RLS and not readable by the
  // FRANCHISE_ADMIN role directly, so read them with the service-role client
  // scoped strictly to the franchiseId from the verified httpOnly cookie
  // (consistent with the rest of the franchise portal pages).
  if (franchiseId) {
    const admin = createAdminClient();

    const { data: f } = await admin
      .from("franchises")
      .select("name, status, created_at")
      .eq("id", franchiseId)
      .single();
    franchise = f;

    const { data: p } = await admin
      .from("franchise_pincodes")
      .select("pincode")
      .eq("franchise_id", franchiseId)
      .order("pincode");
    pincodes = (p ?? []).map((r) => r.pincode);

    const { data: reqs } = await admin
      .from("franchise_pincode_requests")
      .select("*")
      .eq("franchise_id", franchiseId)
      .order("created_at", { ascending: false });
    requests = (reqs ?? []) as FranchisePincodeRequest[];
  }

  return (
    <div className="flex flex-col gap-8 animate-in fade-in duration-500">
      <PageHeader
        title="Profile & Settings"
        subtitle="Your account and franchise information."
        icon={User}
      />

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* Account Info */}
        <SectionCard icon={User} title="Account" subtitle="Login details">
          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-xs uppercase tracking-wider text-slate-400">Name</span>
              <span className="font-medium text-slate-700">
                {userProfile?.full_name ?? "—"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-xs uppercase tracking-wider text-slate-400">Email</span>
              <span className="text-slate-700">{userProfile?.email ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-xs uppercase tracking-wider text-slate-400">Mobile</span>
              <span className="text-slate-700">{userProfile?.mobile ?? "—"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wider text-slate-400">Role</span>
              <Badge variant="outline" className="rounded-lg text-primary border-primary/30">
                Franchise Admin
              </Badge>
            </div>
          </div>
        </SectionCard>

        {/* Franchise Info */}
        <SectionCard
          icon={Building2}
          title="Franchise"
          subtitle="Read-only — contact Master Admin"
        >
          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-xs uppercase tracking-wider text-slate-400">Name</span>
              <span className="font-medium text-slate-700">
                {franchise?.name ?? "—"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wider text-slate-400">Status</span>
              <Badge
                variant="outline"
                className={
                  franchise?.status === "active"
                    ? "rounded-lg bg-emerald-50 text-emerald-700 border-emerald-200"
                    : "rounded-lg text-slate-500"
                }
              >
                {franchise?.status ?? "—"}
              </Badge>
            </div>
            <div className="flex justify-between">
              <span className="text-xs uppercase tracking-wider text-slate-400">Since</span>
              <span className="text-slate-700">
                {franchise?.created_at
                  ? new Date(franchise.created_at).toLocaleDateString()
                  : "—"}
              </span>
            </div>
          </div>
        </SectionCard>
      </div>

      {/* Service Pincodes — view active + request new */}
      <FranchiseServiceAreaCard approvedPincodes={pincodes} requests={requests} />
    </div>
  );
}
