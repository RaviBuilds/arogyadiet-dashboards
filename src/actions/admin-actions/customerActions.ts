"use server";

import { revalidatePath } from "next/cache";
import {
  createAddressSchema,
  type AddressFormValues,
} from "@/validations/addressSchema";
import {
  assertDeliverablePincode,
  getServiceAreaPincodesAction,
} from "@/actions/pincodeActions";
import { sendEmail } from "@/services/emailService";
import {
  welcomeEmailHtml,
  WELCOME_EMAIL_SUBJECT,
} from "@/emails/WelcomeEmail";
import { logAdminAction } from "@/lib/logger";
import { checkGroupManage, getCurrentAdminContext } from "@/lib/auth/adminAccess";
import { resolveClinicForPincode } from "@/lib/clinic/pincode-resolver";
import { reconcileOnClinicChange } from "@/services/AssignmentService";
import type { CustomerCategory } from "@/types/dietitian";
// `getISTDateString`, `ADDON_STATUS_DELIVERED` and `FULFILLMENT_DELIVERED_OFFLINE`
// moved with the addon-order bodies into `@/services/addonOrderCore`.
// The ungated business logic, shared with the Franchise_Portal's own
// correctly-scoped wrappers (franchise-scoped-access Task 2). Each action below
// is now exactly "authorize, then delegate" — see the header of
// `customerManagementCore.ts` for why the gate is NOT pushed down into the
// cores, and why loosening `checkGroupManage` would be unsafe.
import {
  supabaseAdmin,
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
  updateAddonOrderDeliveryDateCore,
  markAddonOrderDeliveredOfflineCore,
} from "@/services/addonOrderCore";

export async function adminUpdateAddonOrderDeliveryDate(
  addonOrderId: string,
  newDeliveryDate: string,
) {
  const gate = await checkGroupManage("customers");
  if (!gate.ok) return { success: false, error: gate.error };
  return updateAddonOrderDeliveryDateCore(addonOrderId, newDeliveryDate);
}

/**
 * Mark a shop (addon) order as delivered OFFLINE — e.g. the customer collected
 * the product at the clinic. This takes the order OUT of the meal-delivery
 * routing pipeline:
 *   - status is set to DELIVERED (so `runProductLinkingAction`, which only
 *     links `PAID` unlinked orders, never touches it again),
 *   - fulfillment_status is stamped `DELIVERED_OFFLINE` and `delivered_at` = now,
 *   - if the order was already linked to a delivery, `delivery_order_id` is
 *     cleared so no rider carries it.
 *
 * Available for both unscheduled ("Purchased") and already-scheduled orders.
 * A PENDING (unpaid) or already-terminal (DELIVERED/CANCELLED) order is rejected.
 */
export async function adminMarkAddonOrderDeliveredOffline(addonOrderId: string) {
  const gate = await checkGroupManage("customers");
  if (!gate.ok) return { success: false, error: gate.error };
  return markAddonOrderDeliveredOfflineCore(addonOrderId);
}

export async function updateCustomerBasicInfo(
  profileId: string,
  userId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any,
) {
  const gate = await checkGroupManage("customers");
  if (!gate.ok) return { success: false, error: gate.error };
  return updateCustomerBasicInfoCore(profileId, userId, data);
}

export async function updateCustomerDietaryProfile(
  profileId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any,
) {
  const gate = await checkGroupManage("customers");
  if (!gate.ok) return { success: false, error: gate.error };
  return updateCustomerDietaryProfileCore(profileId, data);
}

export async function updateCustomerMedicalProfile(
  profileId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any,
) {
  const gate = await checkGroupManage("customers");
  if (!gate.ok) return { success: false, error: gate.error };
  return updateCustomerMedicalProfileCore(profileId, data);
}

export async function deleteMedicalDocument(
  docId: string,
  path: string,
  profileId: string,
) {
  const gate = await checkGroupManage("customers");
  if (!gate.ok) return { success: false, error: gate.error };
  return deleteMedicalDocumentCore(docId, path, profileId);
}

export async function uploadAdminMedicalDocument(formData: FormData) {
  const gate = await checkGroupManage("customers");
  if (!gate.ok) return { success: false, error: gate.error };
  return uploadAdminMedicalDocumentCore(formData);
}

export async function revalidateCustomersPage() {
  revalidatePath("/admin/customers");
}

export async function deactivateCustomerAccount(
  profileId: string,
  userId: string,
) {
  const gate = await checkGroupManage("customers");
  if (!gate.ok) return { success: false, error: gate.error };
  return deactivateCustomerAccountCore(profileId, userId);
}

/** @deprecated Use deactivateCustomerAccount */
export async function deleteCustomer(profileId: string, userId: string) {
  const gate = await checkGroupManage("customers");
  if (!gate.ok) return { success: false, error: gate.error };
  // Delegates to the CORE rather than to `deactivateCustomerAccount`, so this
  // stays a single authorization check as it was before the extraction.
  return deactivateCustomerAccountCore(profileId, userId);
}

// ── Admin Create Customer ─────────────────────────────────────────────────────

export interface AdminCreateCustomerData {
  // Account
  fullName: string;
  email: string;
  mobile: string;
  password: string;
  // Profile
  gender?: string;
  dateOfBirth?: string;
  dietaryPreference?: string;
  allergies?: string;
  hasMedicalHistory?: boolean;
  medicalHistoryNotes?: string;
  // Addresses (0–2)
  addresses?: AddressFormValues[];
}

export async function adminCreateCustomerAction(data: AdminCreateCustomerData) {
  const gate = await checkGroupManage("customers");
  if (!gate.ok) return { success: false, error: gate.error };
  // 1. Create Supabase auth user (email_confirm: true bypasses confirmation email)
  const { data: authData, error: authError } =
    await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
    });

  if (authError || !authData?.user) {
    return { success: false, error: authError?.message ?? "Auth creation failed" };
  }

  const authUserId = authData.user.id;

  // 2. Fetch CUSTOMER role id
  const { data: roleData } = await supabaseAdmin
    .from("roles")
    .select("id")
    .eq("code", "CUSTOMER")
    .single();

  if (!roleData) {
    await supabaseAdmin.auth.admin.deleteUser(authUserId);
    return { success: false, error: "System error: CUSTOMER role not found." };
  }

  // 3. Insert into users
  const { data: userData, error: userError } = await supabaseAdmin
    .from("users")
    .insert({
      auth_user_id: authUserId,
      role_id: roleData.id,
      full_name: data.fullName,
      email: data.email,
      mobile: data.mobile,
      is_active: true,
    })
    .select("id")
    .single();

  if (userError || !userData) {
    await supabaseAdmin.auth.admin.deleteUser(authUserId);
    return { success: false, error: "Failed to create user record." };
  }

  // 4. Insert into customer_profiles
  // Resolve clinic_id from primary address pincode (if available)
  let resolvedClinicId: string | null = null;
  const primaryAddress = data.addresses?.find((a) => a.is_primary) ?? data.addresses?.[0];
  if (primaryAddress?.pincode) {
    const clinicResolution = await resolveClinicForPincode(primaryAddress.pincode);
    if (clinicResolution.type === "resolved") {
      resolvedClinicId = clinicResolution.clinic_id;
    }
  }

  const { data: profileData, error: profileError } = await supabaseAdmin
    .from("customer_profiles")
    .insert({
      user_id: userData.id,
      is_active: true,
      gender: data.gender || null,
      date_of_birth: data.dateOfBirth || null,
      dietary_preference: data.dietaryPreference || null,
      allergies: data.allergies || null,
      has_medical_history: data.hasMedicalHistory ?? false,
      medical_history_notes: data.medicalHistoryNotes || null,
      clinic_id: resolvedClinicId,
    })
    .select("id")
    .single();

  if (profileError || !profileData) {
    await supabaseAdmin.auth.admin.deleteUser(authUserId);
    return { success: false, error: "Failed to create customer profile." };
  }

  // 5. Insert addresses (max 2)
  if (data.addresses && data.addresses.length > 0) {
    for (const addr of data.addresses.slice(0, 2)) {
      const addrResult = await adminCreateAddressForCustomer(profileData.id, addr);
      if (!addrResult.success) {
        // Non-fatal: profile was created, just warn about address failure
        console.warn("Address insert failed:", addrResult.error);
      }
    }
  }

  await logAdminAction("CREATE", "customer", profileData.id, {
    email: data.email,
    full_name: data.fullName,
  });
  revalidatePath("/admin/customers");

  // Send welcome email (non-blocking — failure does not affect account creation)
  await sendEmail(
    data.email,
    WELCOME_EMAIL_SUBJECT,
    welcomeEmailHtml({ name: data.fullName, email: data.email, password: data.password }),
  );

  return { success: true, profileId: profileData.id };
}

export async function adminCreateAddressForCustomer(
  customerProfileId: string,
  data: AddressFormValues,
) {
  const gate = await checkGroupManage("customers");
  if (!gate.ok) return { success: false, error: gate.error };
  const pincodeCheck = await assertDeliverablePincode(data.pincode);
  if (!pincodeCheck.ok) {
    return { success: false, error: pincodeCheck.error };
  }

  const serviceAreaPincodes = await getServiceAreaPincodesAction();
  const parsed = createAddressSchema(serviceAreaPincodes).safeParse(data);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid address data.",
    };
  }

  // Enforce max 2 addresses
  const { count } = await supabaseAdmin
    .from("addresses")
    .select("id", { count: "exact", head: true })
    .eq("customer_profile_id", customerProfileId);

  if (count !== null && count >= 2) {
    return { success: false, error: "Maximum of 2 addresses allowed." };
  }

  // If setting as primary, clear existing primaries
  if (parsed.data.is_primary) {
    await supabaseAdmin
      .from("addresses")
      .update({ is_primary: false })
      .eq("customer_profile_id", customerProfileId);
  }

  const { error } = await supabaseAdmin.from("addresses").insert({
    customer_profile_id: customerProfileId,
    tag: parsed.data.tag,
    street_1: parsed.data.street_1,
    street_2: parsed.data.street_2 || null,
    landmark: parsed.data.landmark || null,
    city: parsed.data.city,
    state: parsed.data.state,
    pincode: parsed.data.pincode,
    is_primary: parsed.data.is_primary,
    lat: parsed.data.lat ?? null,
    lng: parsed.data.lng ?? null,
    clinic_id: await resolveClinicForPincode(parsed.data.pincode).then(
      (r) => (r.type === "resolved" ? r.clinic_id : null)
    ),
  });

  if (error) return { success: false, error: error.message };
  await logAdminAction("CREATE", "customer_address", customerProfileId, {
    tag: parsed.data.tag,
  });
  return { success: true };
}

export async function adminUpsertCustomerAddress(
  customerProfileId: string,
  data: AddressFormValues,
) {
  const gate = await checkGroupManage("customers");
  if (!gate.ok) return { success: false, error: gate.error };
  return adminUpsertCustomerAddressCore(customerProfileId, data);
}

export async function adminDeleteCustomerAddress(
  customerProfileId: string,
  addressId: string,
) {
  const gate = await checkGroupManage("customers");
  if (!gate.ok) return { success: false, error: gate.error };
  return adminDeleteCustomerAddressCore(customerProfileId, addressId);
}

// ── User Management Actions ───────────────────────────────────────────────────

export async function adminSetCustomerPassword(
  authUserId: string,
  newPassword: string,
) {
  const gate = await checkGroupManage("customers");
  if (!gate.ok) return { success: false, error: gate.error };
  return adminSetCustomerPasswordCore(authUserId, newPassword);
}

export async function adminSendPasswordReset(email: string) {
  const gate = await checkGroupManage("customers");
  if (!gate.ok) return { success: false, error: gate.error };
  return adminSendPasswordResetCore(email);
}

export async function adminUpdateCustomerEmail(
  authUserId: string,
  newEmail: string,
) {
  const gate = await checkGroupManage("customers");
  if (!gate.ok) return { success: false, error: gate.error };
  return adminUpdateCustomerEmailCore(authUserId, newEmail);
}

export async function adminToggleCustomerActive(
  profileId: string,
  userId: string,
  authUserId: string,
  makeActive: boolean,
) {
  const gate = await checkGroupManage("customers");
  if (!gate.ok) return { success: false, error: gate.error };
  return adminToggleCustomerActiveCore(
    profileId,
    userId,
    authUserId,
    makeActive,
  );
}

// ── Clinic Assignment Action ──────────────────────────────────────────────────

export async function adminAssignCustomerClinic(
  profileId: string,
  clinicId: string | null,
) {
  const gate = await checkGroupManage("customers");
  if (!gate.ok) return { success: false, error: gate.error };

  const { error } = await supabaseAdmin
    .from("customer_profiles")
    .update({ clinic_id: clinicId })
    .eq("id", profileId);

  if (error) return { success: false, error: error.message };

  await logAdminAction("UPDATE", "customer", profileId, {
    action: "clinic_assignment",
    clinic_id: clinicId,
  });

  // Reconcile the Dietitian_Link per the Customer_Category table (Req 8.4,
  // 8.5, 8.6) — the single place where a Clinic change can touch a
  // Dietitian_Link (dietitian-management design.md §"Assignment_Service").
  // Best-effort: the clinic assignment above already succeeded, so a failure
  // resolving the category or reconciling the link must never surface as a
  // failure of this action.
  try {
    const category = await resolveCustomerGoverningCategory(profileId);
    const { userId: actingUserId } = await getCurrentAdminContext();
    await reconcileOnClinicChange(profileId, category, clinicId, actingUserId);
  } catch (reconcileError) {
    console.error(
      "adminAssignCustomerClinic: dietitian-link reconciliation failed:",
      reconcileError,
    );
  }

  revalidatePath(`/admin/customers/${profileId}`);
  revalidatePath("/admin/customers");
  return { success: true };
}

/**
 * Resolve a Customer_Record's governing Customer_Category from its most
 * recently created `subscriptions` row, defaulting to `MEAL` when none
 * exists. Mirrors `DietitianReportService.resolveGoverningCategory` and
 * `assignmentRepository.resolveCategoryFromEmbed` — every surface that feeds
 * the Assignment_Service must agree on which subscription governs a customer.
 */
async function resolveCustomerGoverningCategory(
  profileId: string,
): Promise<CustomerCategory> {
  const { data, error } = await supabaseAdmin
    .from("subscriptions")
    .select("customer_category, created_at")
    .eq("customer_profile_id", profileId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to resolve governing category for customer ${profileId}: ${error.message}`,
    );
  }

  const category = data?.customer_category as string | undefined;
  return category === "ACCOMMODATION" || category === "KIT" || category === "MEAL"
    ? category
    : "MEAL";
}
