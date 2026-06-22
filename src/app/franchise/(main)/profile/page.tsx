import { createClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { Badge } from "@/shared/components/ui/badge";
import { Building2, MapPin, User } from "lucide-react";

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

  let franchise = null;
  let pincodes: string[] = [];

  if (franchiseId) {
    const { data: f } = await supabase
      .from("franchises")
      .select("name, status, created_at")
      .eq("id", franchiseId)
      .single();
    franchise = f;

    const { data: p } = await supabase
      .from("franchise_pincodes")
      .select("pincode")
      .eq("franchise_id", franchiseId)
      .order("pincode");
    pincodes = (p ?? []).map((r) => r.pincode);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          Profile & Settings
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Your account and franchise information.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Account Info */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <User className="h-4 w-4" />
              Account
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500">Name</span>
              <span className="font-medium text-slate-700">
                {userProfile?.full_name ?? "—"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Email</span>
              <span className="text-slate-700">{userProfile?.email ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Mobile</span>
              <span className="text-slate-700">{userProfile?.mobile ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Role</span>
              <Badge variant="outline" className="text-primary border-primary/30">
                Franchise Admin
              </Badge>
            </div>
          </CardContent>
        </Card>

        {/* Franchise Info */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              Franchise
            </CardTitle>
            <CardDescription>
              Read-only franchise information. Contact Master Admin for changes.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500">Name</span>
              <span className="font-medium text-slate-700">
                {franchise?.name ?? "—"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Status</span>
              <Badge
                variant="outline"
                className={
                  franchise?.status === "active"
                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                    : "text-slate-500"
                }
              >
                {franchise?.status ?? "—"}
              </Badge>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Since</span>
              <span className="text-slate-700">
                {franchise?.created_at
                  ? new Date(franchise.created_at).toLocaleDateString()
                  : "—"}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Service Pincodes */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <MapPin className="h-4 w-4" />
            Service Area Pincodes
          </CardTitle>
          <CardDescription>
            {pincodes.length} pincode{pincodes.length !== 1 ? "s" : ""} assigned to your franchise.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {pincodes.length === 0 ? (
            <p className="text-sm text-slate-400">No pincodes assigned yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {pincodes.map((p) => (
                <Badge key={p} variant="secondary" className="font-mono">
                  {p}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
