"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { resolveFranchiseContext } from "@/lib/franchise/context";
import { revalidatePath } from "next/cache";

// The shared UNGATED cores. Previously this module delegated to the ADMIN
// actions, but each of those opens with `checkGroupManage("customers")`, which
// admits only ADMIN / MASTER_ADMIN — so every franchise customer write was
// refused, the Franchise_Owner included (franchise-scoped-access Task 1/3).
// Authorization for this portal is applied by the guards below instead.
import {
  updateCustomerBasicInfoCore,
  updateCustomerDietaryProfileCore,
  updateCustomerMedicalProfileCore,
  deleteMedicalDocumentCore,
  uploadAdminMedicalDocumentCore,
  adminUpsertCustomerAddressCore,
  adminDeleteCustomerAddressCore,
  adminSetCustomerPasswordCore,
  adminSendPasswordResetCore,
  adminUpdateCustomerEmailCore,
  adminToggleCustomerActiveCore,
  deactivateCustomerAccountCore,
} from "@/services/customerManagementCore";
import {
  createCouponCore,
  deleteCouponCore,
  type CreateCouponInput,
} from "@/services/customerCouponCore";
import { checkFranchiseGroupManage } from "@/lib/auth/adminAccess";
import type { AddressFormValues } from "@/validations/addressSchema";

type Guard =
  | { success: true; franchiseId: string }
  | { success: false; error: string };

/**
 * Resolves the calling franchise admin's franchise_id from their session.
 * Rejects anyone who is not a FRANCHISE_ADMIN with an assigned franchise.
 */
async function resolveCallerFranchiseId(): Promise<Guard> {
  const ctx = await resolveFranchiseContext();

  if (!ctx) {
    return { success: false, error: "Unable to resolve franchise context." };
  }
  if (ctx.role !== "FRANCHISE_ADMIN") {
    return {
      success: false,
      error: "You are not authorized to perform franchise operations.",
    };
  }
  if (!ctx.franchise_id) {
    return { success: false, error: "No franchise is assigned to your account." };
  }

  return { success: true, franchiseId: ctx.franchise_id };
}

/**
 * Establishes that the caller may WRITE to the `customers` group of their own
 * Franchise (franchise-scoped-access Task 3).
 *
 * Two INDEPENDENT concerns, both required, deliberately checked in this order:
 *
 *   1. Caller identity  — `resolveCallerFranchiseId` (existing behaviour, and
 *      the source of the specific "no franchise assigned" / "not authorized"
 *      messages, which are preserved).
 *   2. PERMISSION       — `checkFranchiseGroupManage("customers")`, which is the
 *      new part: it is what distinguishes Manage from View. Before this, a
 *      franchise user with `customers: "view"` was refused only incidentally
 *      (by the admin gate rejecting their role), so there was no real
 *      read-only semantics on this portal at all.
 *
 * Tenancy of the specific target row is then checked by each guard below.
 * Permission is checked BEFORE the row lookup so a view-only caller learns
 * nothing about whether a given customer exists.
 */
async function guardCustomersWrite(): Promise<Guard> {
  const caller = await resolveCallerFranchiseId();
  if (!caller.success) return caller;

  const gate = await checkFranchiseGroupManage("customers");
  if (!gate.ok) return { success: false, error: gate.error };

  return caller;
}

/** Verifies the caller may write, and that the profile belongs to their franchise. */
async function guardProfile(profileId: string): Promise<Guard> {
  const caller = await guardCustomersWrite();
  if (!caller.success) return caller;

  const supabase = createAdminClient();
  const { data: profile, error } = await supabase
    .from("customer_profiles")
    .select("id, franchise_id")
    .eq("id", profileId)
    .maybeSingle();

  if (error) return { success: false, error: error.message };
  if (!profile) return { success: false, error: "Customer not found." };
  if (profile.franchise_id !== caller.franchiseId) {
    return {
      success: false,
      error: "This customer does not belong to your franchise.",
    };
  }

  return { success: true, franchiseId: caller.franchiseId };
}

/** Verifies the caller may write, and that the user belongs to their franchise. */
async function guardAuthUser(authUserId: string): Promise<Guard> {
  const caller = await guardCustomersWrite();
  if (!caller.success) return caller;

  const supabase = createAdminClient();
  const { data: user, error } = await supabase
    .from("users")
    .select("id, franchise_id")
    .eq("auth_user_id", authUserId)
    .maybeSingle();

  if (error) return { success: false, error: error.message };
  if (!user) return { success: false, error: "Customer not found." };
  if (user.franchise_id !== caller.franchiseId) {
    return {
      success: false,
      error: "This customer does not belong to your franchise.",
    };
  }

  return { success: true, franchiseId: caller.franchiseId };
}

/** Verifies the caller may write, and that the user (by email) is in their franchise. */
async function guardEmail(email: string): Promise<Guard> {
  const caller = await guardCustomersWrite();
  if (!caller.success) return caller;

  const supabase = createAdminClient();
  const { data: user, error } = await supabase
    .from("users")
    .select("id, franchise_id")
    .eq("email", email)
    .maybeSingle();

  if (error) return { success: false, error: error.message };
  if (!user) return { success: false, error: "Customer not found." };
  if (user.franchise_id !== caller.franchiseId) {
    return {
      success: false,
      error: "This customer does not belong to your franchise.",
    };
  }

  return { success: true, franchiseId: caller.franchiseId };
}

function revalidateFranchiseCustomer(profileId?: string) {
  revalidatePath("/franchise/customers");
  if (profileId) revalidatePath(`/franchise/customers/${profileId}`);
}

/** Public revalidation helper for ISR refresh from the client dashboard. */
export async function revalidateFranchiseCustomersPage() {
  revalidatePath("/franchise/customers");
}

// ── Profile & Medical ─────────────────────────────────────────────────────────

export async function franchiseUpdateCustomerBasicInfo(
  profileId: string,
  userId: string,
  data: { fullName: string; mobile: string; gender: string; dateOfBirth: string },
) {
  const guard = await guardProfile(profileId);
  if (!guard.success) return guard;
  const res = await updateCustomerBasicInfoCore(profileId, userId, data);
  if (res.success) revalidateFranchiseCustomer(profileId);
  return res;
}

export async function franchiseUpdateCustomerDietaryProfile(
  profileId: string,
  data: { dietaryPreference: string; allergies: string },
) {
  const guard = await guardProfile(profileId);
  if (!guard.success) return guard;
  const res = await updateCustomerDietaryProfileCore(profileId, data);
  if (res.success) revalidateFranchiseCustomer(profileId);
  return res;
}

export async function franchiseUpdateCustomerMedicalProfile(
  profileId: string,
  data: { medicalHistoryNotes: string; hasMedicalHistory: boolean },
) {
  const guard = await guardProfile(profileId);
  if (!guard.success) return guard;
  const res = await updateCustomerMedicalProfileCore(profileId, data);
  if (res.success) revalidateFranchiseCustomer(profileId);
  return res;
}

export async function franchiseUploadMedicalDocument(formData: FormData) {
  const profileId = formData.get("profileId") as string;
  const guard = await guardProfile(profileId);
  if (!guard.success) return guard;
  const res = await uploadAdminMedicalDocumentCore(formData);
  if (res.success) revalidateFranchiseCustomer(profileId);
  return res;
}

export async function franchiseDeleteMedicalDocument(
  docId: string,
  path: string,
  profileId: string,
) {
  const guard = await guardProfile(profileId);
  if (!guard.success) return guard;
  const res = await deleteMedicalDocumentCore(docId, path, profileId);
  if (res.success) revalidateFranchiseCustomer(profileId);
  return res;
}

// ── Addresses ──────────────────────────────────────────────────────────────────

export async function franchiseUpsertCustomerAddress(
  customerProfileId: string,
  data: AddressFormValues,
) {
  const guard = await guardProfile(customerProfileId);
  if (!guard.success) return guard;
  const res = await adminUpsertCustomerAddressCore(customerProfileId, data);
  if (res.success) revalidateFranchiseCustomer(customerProfileId);
  return res;
}

export async function franchiseDeleteCustomerAddress(
  customerProfileId: string,
  addressId: string,
) {
  const guard = await guardProfile(customerProfileId);
  if (!guard.success) return guard;
  const res = await adminDeleteCustomerAddressCore(customerProfileId, addressId);
  if (res.success) revalidateFranchiseCustomer(customerProfileId);
  return res;
}

// ── User Management ─────────────────────────────────────────────────────────────

export async function franchiseSetCustomerPassword(
  authUserId: string,
  newPassword: string,
) {
  const guard = await guardAuthUser(authUserId);
  if (!guard.success) return guard;
  return adminSetCustomerPasswordCore(authUserId, newPassword);
}

export async function franchiseSendPasswordReset(email: string) {
  const guard = await guardEmail(email);
  if (!guard.success) return guard;
  return adminSendPasswordResetCore(email);
}

/**
 * Change a customer's login email.
 *
 * Guarded by `guardAuthUser` (not `guardEmail`): the identifier supplied is the
 * customer's `auth_user_id`, and the NEW email is by definition not yet on any
 * row, so looking the tenant up by email would find nothing and refuse every
 * legitimate change.
 *
 * This was the one action of the eleven the franchise portal did not override,
 * so `Customer360Dashboard` fell back to the ADMIN action and a franchise admin
 * editing a customer's email was refused by `checkGroupManage("customers")`.
 */
export async function franchiseUpdateCustomerEmail(
  authUserId: string,
  newEmail: string,
) {
  const guard = await guardAuthUser(authUserId);
  if (!guard.success) return guard;
  const res = await adminUpdateCustomerEmailCore(authUserId, newEmail);
  // The email lives on `users`, not `customer_profiles`, so the profile id is
  // not known here; revalidating the directory is enough to clear the stale
  // address from the list.
  if (res.success) revalidateFranchiseCustomer();
  return res;
}

export async function franchiseToggleCustomerActive(
  profileId: string,
  userId: string,
  authUserId: string,
  makeActive: boolean,
) {
  const guard = await guardProfile(profileId);
  if (!guard.success) return guard;
  const res = await adminToggleCustomerActiveCore(profileId, userId, authUserId, makeActive);
  if (res.success) revalidateFranchiseCustomer(profileId);
  return res;
}

export async function franchiseDeactivateCustomerAccount(
  profileId: string,
  userId: string,
) {
  const guard = await guardProfile(profileId);
  if (!guard.success) return guard;
  const res = await deactivateCustomerAccountCore(profileId, userId);
  if (res.success) revalidateFranchiseCustomer(profileId);
  return res;
}

// ── Coupons (per-customer) ───────────────────────────────────────────────────────

export async function franchiseCreateCustomerCoupon(
  formData: CreateCouponInput,
) {
  const guard = await guardProfile(formData.customerProfileId);
  if (!guard.success) return guard;
  const res = await createCouponCore(formData);
  if (res.success) revalidateFranchiseCustomer(formData.customerProfileId);
  return res;
}

export async function franchiseDeleteCustomerCoupon(
  couponId: string,
  customerProfileId: string,
) {
  const guard = await guardProfile(customerProfileId);
  if (!guard.success) return guard;
  const res = await deleteCouponCore(couponId, customerProfileId);
  if (res.success) revalidateFranchiseCustomer(customerProfileId);
  return res;
}
