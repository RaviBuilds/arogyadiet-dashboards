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
import { Users, Loader2 } from "lucide-react";
import { HideFromFranchise } from "@/shared/components/shared/RBACGate";
import { createClient } from "@/lib/supabase/client";
import type { FranchiseRole } from "@/types/franchise";

interface FranchiseCustomersProps {
  role: FranchiseRole;
  franchiseId: string;
}

interface CustomerRow {
  id: string;
  customer_code: string | null;
  is_active: boolean;
  users: { full_name: string; email: string; mobile: string | null } | null;
}

/**
 * Franchise-scoped customer list component.
 * Shows customers belonging to the given franchise_id.
 * RBAC: FRANCHISE_ADMIN sees only their data; master controls hidden.
 */
export default function FranchiseCustomers({ role, franchiseId }: FranchiseCustomersProps) {
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data } = await supabase
        .from("customer_profiles")
        .select("id, customer_code, is_active, users(full_name, email, mobile)")
        .eq("franchise_id", franchiseId)
        .order("created_at", { ascending: false })
        .limit(50);
      setCustomers((data as CustomerRow[]) ?? []);
      setLoading(false);
    }
    load();
  }, [franchiseId]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="h-4 w-4" />
          Customers
        </CardTitle>
        <CardDescription>
          {loading ? "Loading..." : `${customers.length} customer(s) in this franchise.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
          </div>
        ) : customers.length === 0 ? (
          <p className="text-sm text-slate-400 py-4 text-center">No customers yet.</p>
        ) : (
          <div className="rounded-lg border border-slate-200">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customers.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">
                      {c.users?.full_name ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm text-slate-500">
                      {c.users?.email ?? "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {c.customer_code ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={c.is_active ? "text-emerald-700 border-emerald-200" : "text-slate-500"}>
                        {c.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <HideFromFranchise role={role}>
          <p className="mt-3 text-xs text-slate-400">
            Master-level actions: bulk operations, export, account management.
          </p>
        </HideFromFranchise>
      </CardContent>
    </Card>
  );
}
