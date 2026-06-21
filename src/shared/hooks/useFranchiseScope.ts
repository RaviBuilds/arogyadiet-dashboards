"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import type { FranchiseContext, FranchiseRole } from "@/types/franchise";

/**
 * Client-side hook that resolves the current user's franchise scope.
 *
 * Returns:
 * - role: user's role code
 * - franchiseId: franchise_id (null for core/global access)
 * - franchiseName: franchise name (if franchise-scoped)
 * - isFranchiseScoped: true if the user is limited to a franchise
 * - isLoading: true while resolving
 * - error: error message if resolution fails
 */
export function useFranchiseScope() {
  const [context, setContext] = useState<FranchiseContext | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function resolve() {
      try {
        const supabase = createClient();

        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          setError("Not authenticated");
          setIsLoading(false);
          return;
        }

        const { data: userRecord } = await supabase
          .from("users")
          .select("id, franchise_id, roles(code)")
          .eq("auth_user_id", user.id)
          .single();

        if (!userRecord) {
          setError("User record not found");
          setIsLoading(false);
          return;
        }

        const rolesData: any = userRecord.roles;
        const roleCode: string | null = Array.isArray(rolesData)
          ? rolesData[0]?.code
          : rolesData?.code;

        if (!roleCode) {
          setError("Role not found");
          setIsLoading(false);
          return;
        }

        const role = roleCode as FranchiseRole;
        const franchiseId = userRecord.franchise_id;

        // Resolve franchise name if needed
        let franchiseName: string | null = null;
        if (franchiseId) {
          const { data: franchise } = await supabase
            .from("franchises")
            .select("name")
            .eq("id", franchiseId)
            .single();
          franchiseName = franchise?.name ?? null;
        }

        // Determine scope
        const isGlobal = role === "ADMIN" || role === "MASTER_ADMIN";
        const isFranchiseAdmin = role === "FRANCHISE_ADMIN";

        setContext({
          role,
          franchise_id: isGlobal ? null : franchiseId,
          franchise_name: franchiseName,
          is_franchise_scoped: isFranchiseAdmin || (franchiseId !== null && !isGlobal),
        });
      } catch (err: any) {
        setError(err.message ?? "Failed to resolve scope");
      } finally {
        setIsLoading(false);
      }
    }

    resolve();
  }, []);

  return {
    role: context?.role ?? null,
    franchiseId: context?.franchise_id ?? null,
    franchiseName: context?.franchise_name ?? null,
    isFranchiseScoped: context?.is_franchise_scoped ?? false,
    isLoading,
    error,
    context,
  };
}
