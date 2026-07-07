"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { resolveFranchiseContext } from "@/lib/franchise/context";
import { revalidatePath } from "next/cache";

import {
  updateCustomerBasicInfo,
  updateCustomerDietaryProfile,
  updateCustomerMedicalProfile,
  deleteMedicalDocument,
  uploadAdminMedicalDocument,
  adminUpsertCustomerAddress,
  adminDeleteCustomerAddress,
  adminSetCustomerPassword,
  adminSendPasswordReset,
  adminToggleCustomerActive,
  deactivateCustomerAccount,
} from "@/actions/admin-actions/customerActions";
import {
  createCoupon,
  deleteCoupon,
} from "@/actions/admin-actions/adminCouponActions";
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

/** Verifies the customer profile belongs to the calling franchise. */
async function guardProfile(profileId: string): Promise<Guard> {
  const caller = await resolveCallerFranchiseId();
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

/** Verifies a user (by auth_user_id) belongs to the calling franchise. */
async function guardAuthUser(authUserId: string): Promise<Guard> {
  const caller = await resolveCallerFranchiseId();
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

/** Verifies a user (by email) belongs to the calling franchise. */
async function guardEmail(email: string): Promise<Guard> {
  const caller = await resolveCallerFranchiseId();
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
  const res = await updateCustomerBasicInfo(profileId, userId, data);
  if (res.success) revalidateFranchiseCustomer(profileId);
  return res;
}

export async function franchiseUpdateCustomerDietaryProfile(
  profileId: string,
  data: { dietaryPreference: string; allergies: string },
) {
  const guard = await guardProfile(profileId);
  if (!guard.success) return guard;
  const res = await updateCustomerDietaryProfile(profileId, data);
  if (res.success) revalidateFranchiseCustomer(profileId);
  return res;
}

export async function franchiseUpdateCustomerMedicalProfile(
  profileId: string,
  data: { medicalHistoryNotes: string; hasMedicalHistory: boolean },
) {
  const guard = await guardProfile(profileId);
  if (!guard.success) return guard;
  const res = await updateCustomerMedicalProfile(profileId, data);
  if (res.success) revalidateFranchiseCustomer(profileId);
  return res;
}

export async function franchiseUploadMedicalDocument(formData: FormData) {
  const profileId = formData.get("profileId") as string;
  const guard = await guardProfile(profileId);
  if (!guard.success) return guard;
  const res = await uploadAdminMedicalDocument(formData);
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
  const res = await deleteMedicalDocument(docId, path, profileId);
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
  const res = await adminUpsertCustomerAddress(customerProfileId, data);
  if (res.success) revalidateFranchiseCustomer(customerProfileId);
  return res;
}

export async function franchiseDeleteCustomerAddress(
  customerProfileId: string,
  addressId: string,
) {
  const guard = await guardProfile(customerProfileId);
  if (!guard.success) return guard;
  const res = await adminDeleteCustomerAddress(customerProfileId, addressId);
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
  return adminSetCustomerPassword(authUserId, newPassword);
}

export async function franchiseSendPasswordReset(email: string) {
  const guard = await guardEmail(email);
  if (!guard.success) return guard;
  return adminSendPasswordReset(email);
}

export async function franchiseToggleCustomerActive(
  profileId: string,
  userId: string,
  authUserId: string,
  makeActive: boolean,
) {
  const guard = await guardProfile(profileId);
  if (!guard.success) return guard;
  const res = await adminToggleCustomerActive(profileId, userId, authUserId, makeActive);
  if (res.success) revalidateFranchiseCustomer(profileId);
  return res;
}

export async function franchiseDeactivateCustomerAccount(
  profileId: string,
  userId: string,
) {
  const guard = await guardProfile(profileId);
  if (!guard.success) return guard;
  const res = await deactivateCustomerAccount(profileId, userId);
  if (res.success) revalidateFranchiseCustomer(profileId);
  return res;
}

// ── Coupons (per-customer) ───────────────────────────────────────────────────────

export async function franchiseCreateCustomerCoupon(
  formData: Parameters<typeof createCoupon>[0],
) {
  const guard = await guardProfile(formData.customerProfileId);
  if (!guard.success) return guard;
  const res = await createCoupon(formData);
  if (res.success) revalidateFranchiseCustomer(formData.customerProfileId);
  return res;
}

export async function franchiseDeleteCustomerCoupon(
  couponId: string,
  customerProfileId: string,
) {
  const guard = await guardProfile(customerProfileId);
  if (!guard.success) return guard;
  const res = await deleteCoupon(couponId, customerProfileId);
  if (res.success) revalidateFranchiseCustomer(customerProfileId);
  return res;
}
