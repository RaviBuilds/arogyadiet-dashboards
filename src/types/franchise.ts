// src/types/franchise.ts
// TypeScript interfaces for the franchise multi-tenant system

export type FranchiseStatus = "onboarding" | "active" | "suspended";

export interface Franchise {
  id: string;
  name: string;
  status: FranchiseStatus;
  kitchen_id: string | null;
  owner_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface FranchisePincode {
  id: string;
  franchise_id: string;
  pincode: string;
  created_at: string;
}

export interface FranchiseWithPincodes extends Franchise {
  pincodes: FranchisePincode[];
}

export interface FranchiseCreateInput {
  name: string;
  kitchen_id?: string | null;
  owner_user_id?: string | null;
  pincodes?: string[];
}

export interface FranchiseUpdateInput {
  name?: string;
  kitchen_id?: string | null;
  owner_user_id?: string | null;
}

/**
 * Valid status transitions:
 * onboarding → active
 * active → suspended
 * suspended → active
 */
export interface FranchiseStatusTransition {
  franchise_id: string;
  from_status: FranchiseStatus;
  to_status: FranchiseStatus;
}

export interface FranchisePincodeConflict {
  pincode: string;
  conflicting_entity: "core" | "franchise";
  conflicting_franchise_id?: string;
  conflicting_franchise_name?: string;
}

export interface FranchiseListFilters {
  status?: FranchiseStatus;
  search?: string;
  page?: number;
  per_page?: number;
}

/**
 * User roles relevant to franchise system
 */
export type FranchiseRole =
  | "MASTER_ADMIN"
  | "ADMIN"
  | "FRANCHISE_ADMIN"
  | "RIDER"
  | "CUSTOMER";

/**
 * Franchise context resolved from user session
 */
export interface FranchiseContext {
  role: FranchiseRole;
  franchise_id: string | null; // null = core operation or global access
  franchise_name?: string | null;
  is_franchise_scoped: boolean; // true only for FRANCHISE_ADMIN
}
