"use client";

import type { FranchiseRole } from "@/types/franchise";

interface RBACGateProps {
  /** Current user's role */
  role: FranchiseRole | null;
  /** Current user's franchise_id (null = core/global) */
  franchiseId?: string | null;
  /** Roles allowed to see the children */
  allowedRoles?: FranchiseRole[];
  /** Roles explicitly denied */
  deniedRoles?: FranchiseRole[];
  /** If true, only shows children when user has a franchise assigned */
  requireFranchise?: boolean;
  /** Content to render when access is denied (optional) */
  fallback?: React.ReactNode;
  /** Children to render when access is granted */
  children: React.ReactNode;
}

/**
 * RBACGate — Role-Based Access Control wrapper component.
 *
 * Conditionally renders children based on the user's role and franchise context.
 *
 * Usage:
 * ```tsx
 * <RBACGate role={role} allowedRoles={["MASTER_ADMIN", "ADMIN"]}>
 *   <AdminOnlyControls />
 * </RBACGate>
 *
 * <RBACGate role={role} deniedRoles={["FRANCHISE_ADMIN"]}>
 *   <MasterLevelConfig />
 * </RBACGate>
 *
 * <RBACGate role={role} requireFranchise franchiseId={franchiseId} fallback={<NoFranchise />}>
 *   <FranchiseDashboard />
 * </RBACGate>
 * ```
 */
export function RBACGate({
  role,
  franchiseId,
  allowedRoles,
  deniedRoles,
  requireFranchise = false,
  fallback = null,
  children,
}: RBACGateProps) {
  // No role = not authenticated or not resolved
  if (!role) {
    return <>{fallback}</>;
  }

  // Check denied roles first (explicit deny takes priority)
  if (deniedRoles && deniedRoles.includes(role)) {
    return <>{fallback}</>;
  }

  // Check allowed roles
  if (allowedRoles && !allowedRoles.includes(role)) {
    return <>{fallback}</>;
  }

  // Check franchise requirement
  if (requireFranchise && !franchiseId) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}

/**
 * Convenience component: Only renders for MASTER_ADMIN
 */
export function MasterOnly({
  role,
  children,
  fallback,
}: {
  role: FranchiseRole | null;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  return (
    <RBACGate role={role} allowedRoles={["MASTER_ADMIN"]} fallback={fallback}>
      {children}
    </RBACGate>
  );
}

/**
 * Convenience component: Only renders for ADMIN or MASTER_ADMIN
 */
export function AdminOrAbove({
  role,
  children,
  fallback,
}: {
  role: FranchiseRole | null;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  return (
    <RBACGate role={role} allowedRoles={["ADMIN", "MASTER_ADMIN"]} fallback={fallback}>
      {children}
    </RBACGate>
  );
}

/**
 * Convenience component: Hides content from FRANCHISE_ADMIN
 * (used to hide master-level controls in shared components)
 */
export function HideFromFranchise({
  role,
  children,
}: {
  role: FranchiseRole | null;
  children: React.ReactNode;
}) {
  return (
    <RBACGate role={role} deniedRoles={["FRANCHISE_ADMIN"]}>
      {children}
    </RBACGate>
  );
}

/**
 * Convenience component: Only renders for FRANCHISE_ADMIN with assigned franchise
 */
export function FranchiseOnly({
  role,
  franchiseId,
  children,
  fallback,
}: {
  role: FranchiseRole | null;
  franchiseId?: string | null;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  return (
    <RBACGate
      role={role}
      allowedRoles={["FRANCHISE_ADMIN"]}
      requireFranchise
      franchiseId={franchiseId}
      fallback={fallback}
    >
      {children}
    </RBACGate>
  );
}
