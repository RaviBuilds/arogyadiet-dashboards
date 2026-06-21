"use client";

import { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { Badge } from "@/shared/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { Truck, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { FranchiseRole } from "@/types/franchise";

interface FranchiseRidersProps {
  role: FranchiseRole;
  franchiseId: string;
}

interface RiderRow {
  id: string;
  employee_code: string | null;
  is_active: boolean;
  is_online: boolean;
  users: { full_name: string; email: string; mobile: string | null } | null;
}

/**
 * Franchise-scoped rider list component.
 * Shows riders belonging to the given franchise_id.
 */
export default function FranchiseRiders({ role, franchiseId }: FranchiseRidersProps) {
  const [riders, setRiders] = useState<RiderRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data } = await supabase
        .from("rider_profiles")
        .select("id, employee_code, is_active, is_online, users(full_name, email, mobile)")
        .eq("franchise_id", franchiseId)
        .order("created_at", { ascending: false });
      setRiders((data as RiderRow[]) ?? []);
      setLoading(false);
    }
    load();
  }, [franchiseId]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Truck className="h-4 w-4" />
          Riders
        </CardTitle>
        <CardDescription>
          {loading ? "Loading..." : `${riders.length} rider(s) in this franchise.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
          </div>
        ) : riders.length === 0 ? (
          <p className="text-sm text-slate-400 py-4 text-center">No riders assigned yet.</p>
        ) : (
          <div className="rounded-lg border border-slate-200">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Online</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {riders.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">
                      {r.users?.full_name ?? "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.employee_code ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={r.is_active ? "text-emerald-700 border-emerald-200" : "text-slate-500"}>
                        {r.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className={`inline-block h-2 w-2 rounded-full ${r.is_online ? "bg-emerald-500" : "bg-slate-300"}`} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
