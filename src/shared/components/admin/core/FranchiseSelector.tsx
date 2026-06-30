"use client";

import { useState, useEffect } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Building2 } from "lucide-react";
import { listAllFranchisesForAdmin } from "@/actions/admin-actions/franchisePincodeActions";

interface FranchiseSelectorProps {
  value: string; // "core" | franchise_id | "all"
  onChange: (value: string) => void;
  showAllOption?: boolean;
}

interface FranchiseOption {
  id: string;
  name: string;
  status: string;
}

/**
 * Franchise Selector — allows admin to switch view between
 * Core Business data, a specific franchise, or All data.
 */
export function FranchiseSelector({ value, onChange, showAllOption = true }: FranchiseSelectorProps) {
  const [franchises, setFranchises] = useState<FranchiseOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const result = await listAllFranchisesForAdmin();
      if (result.success) {
        setFranchises(
          result.data
            .filter((f: any) => f.status === "active")
            .map((f: any) => ({ id: f.id, name: f.name, status: f.status }))
        );
      }
      setLoading(false);
    }
    load();
  }, []);

  return (
    <div className="flex items-center gap-2">
      <Building2 className="h-4 w-4 text-slate-400" />
      <Select value={value} onValueChange={onChange} disabled={loading}>
        <SelectTrigger className="w-[200px] h-8 text-sm">
          <SelectValue placeholder={loading ? "Loading..." : "Select scope"} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="core">Core Business</SelectItem>
          {showAllOption && (
            <SelectItem value="all">All (Core + Franchises)</SelectItem>
          )}
          {franchises.map((f) => (
            <SelectItem key={f.id} value={f.id}>
              {f.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
