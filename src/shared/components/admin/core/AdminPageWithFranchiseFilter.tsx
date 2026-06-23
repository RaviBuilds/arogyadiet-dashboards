"use client";

import { useState, useMemo, type ReactNode } from "react";
import { FranchiseSelector } from "./FranchiseSelector";

interface Props {
  children: (selectedScope: string) => ReactNode;
}

/**
 * Wrapper component that adds a franchise scope selector above page content.
 * Passes the selected scope to children for filtering.
 * Scope values: "all" | "core" | franchise_id
 */
export function AdminPageWithFranchiseFilter({ children }: Props) {
  const [scope, setScope] = useState("core");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50/50 px-4 py-2.5">
        <span className="text-xs text-slate-500 font-medium">Data Scope:</span>
        <FranchiseSelector value={scope} onChange={setScope} showAllOption={true} />
      </div>
      {children(scope)}
    </div>
  );
}
