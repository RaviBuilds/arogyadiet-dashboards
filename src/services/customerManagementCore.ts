// src/services/customerManagementCore.ts
//
// Feature: franchise-scoped-access — Task 2.
//
// The UNGATED business logic behind the customer-management actions, extracted
// verbatim from `src/actions/admin-actions/customerActions.ts` so that two
// callers with DIFFERENT authorization models can share one implementation:
//
//   * `admin-actions/customerActions.ts`      — gate: checkGroupManage("customers")
//   * `franchise-actions/franchiseCustomer…`  — gate: checkFranchiseGroupManage
//                                                      ("customers") + tenant guard
//
// ─── WHY THIS MODULE EXISTS (read before adding to it) ───────────────────────
//
// Franchise customer writes used to delegate straight to the admin actions, but
// every admin action opens with `checkGroupManage("customers")`, which admits
// only `ADMIN` / `MASTER_ADMIN`. A `FRANCHISE_ADMIN` was therefore refused on
// every customer write, including the Franchise_Owner.
//
// The obvious fix — teaching `checkGroupManage` to accept `FRANCHISE_ADMIN` —
// is UNSAFE and must not be attempted. `Customer360Dashboard` is a shared
// client component that imports the admin actions as fallbacks for its
// `actions` prop, so their server-action ids are present in the franchise
// client bundle and are directly invocable from a franchise session. The admin
// actions perform no franchise-ownership check of their own, so that role check
// is currently the ONLY thing preventing an unrestricted cross-tenant write.
// Extracting the logic instead keeps the admin gate exactly as strict as it is
// today while giving the franchise portal its own correctly-scoped entry point.
//
// ─── INVARIANTS ──────────────────────────────────────────────────────────────
//
//  1. THIS FILE MUST NOT CARRY THE `"use server"` DIRECTIVE. Adding it would
//     turn every export into an independently invocable server-action endpoint
//     with NO authorization whatsoever — reintroducing, in a worse form, the
//     very hole described above.
//  2. Nothing here authorizes anything. Every core assumes its caller has
//     already established both permission (manage on `customers`) and, where
//     applicable, tenancy. A core called without a gate is a security bug.
//  3. Bodies are byte-for-byte the pre-extraction logic, including the
//     `/admin/...` revalidation paths. Core Business behaviour must not change
//     (that constraint is pinned by
//     `admin-actions/__tests__/customer-actions-authorization.pin.test.ts`).
//     The franchise wrappers add their own `/franchise/...` revalidations on
//     top, exactly as they did before.

import { createClient } from "@supabase/supabase-js";
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
  accountDeletedEmailHtml,
  ACCOUNT_DELETED_EMAIL_SUBJECT,
} from "@/emails/AccountDeletedEmail";
import { logAdminAction } from "@/lib/logger";
import { deleteCustomerAddress } from "@/lib/address/deleteCustomerAddress";
import {
  notifyAdminCustomerProfileUpdated,
  resolveUserIdFromProfile,
} from "@/lib/customer/customerProfileNotifications";
import {
  buildArchivedEmail,
  isArchivedCustomerEmail,
} from "@/lib/customers/customerArchive";

/**
 * The service-role client. Owned here rather than in `customerActions.ts` so
 * both the admin actions and the cores operate through one instance.
 *
 * Service role bypasses RLS, which is exactly why invariant 2 above matters:
 * these cores have no database-level safety net of their own.
 */
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/** The shape every core returns; mirrors the pre-extraction action results. */
export type CustomerActionResult =
  | { success: true }
  | { success: false; error: string };

// ─── Profile & Medical ───────────────────────────────────────────────────────

export async function updateCustomerBasicInfoCore(
  profileId: string,
  userId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any,
): Promise<CustomerActionResult> {
  const { error: userError } = await supabaseAdmin
    .from("users")
    .update({ full_name: data.fullName, mobile: data.mobile })
    .eq("id", userId);
  const { error: profileError } = await supabaseAdmin
    .from("customer_profiles")
    .update({ gender: data.gender, date_of_birth: data.dateOfBirth })
    .eq("id", profileId);
  if (userError || profileError)
    return { success: false, error: "Failed update" };
  await logAdminAction("UPDATE", "customer", profileId, { section: "basic_info" });
  await notifyAdminCustomerProfileUpdated(userId, "basic_info");
  return { success: true };
}

export async function updateCustomerDietaryProfileCore(
  profileId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any,
): Promise<CustomerActionResult> {
  const { error } = await supabaseAdmin
    .from("customer_profiles")
    .update({
      dietary_preference: data.dietaryPreference,
      allergies: data.allergies,
    })
    .eq("id", profileId);
  if (error) return { success: false, error: error.message };
  await logAdminAction("UPDATE", "customer", profileId, { section: "dietary" });
  const dietaryUserId = await resolveUserIdFromProfile(profileId);
  if (dietaryUserId) {
    await notifyAdminCustomerProfileUpdated(dietaryUserId, "dietary");
  }
  return { success: true };
}

export async function updateCustomerMedicalProfileCore(
  profileId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any,
): Promise<CustomerActionResult> {
  const { error } = await supabaseAdmin
    .from("customer_profiles")
    .update({
      medical_history_notes: data.medicalHistoryNotes,
      has_medical_history: data.hasMedicalHistory,
    })
    .eq("id", profileId);
  if (error) return { success: false, error: error.message };
  await logAdminAction("UPDATE", "customer", profileId, { section: "medical" });
  const medicalUserId = await resolveUserIdFromProfile(profileId);
  if (medicalUserId) {
    await notifyAdminCustomerProfileUpdated(medicalUserId, "medical");
  }
  return { success: true };
}

export async function deleteMedicalDocumentCore(
  docId: string,
  path: string,
  profileId: string,
): Promise<CustomerActionResult> {
  const { error: storageError } = await supabaseAdmin.storage
    .from("medical_records")
    .remove([path]);
  if (storageError) return { success: false, error: storageError.message };
  const { error: dbError } = await supabaseAdmin
    .from("medical_documents")
    .delete()
    .eq("id", docId);
  if (dbError) return { success: false, error: dbError.message };
  await logAdminAction("DELETE", "medical_document", docId, {
    profile_id: profileId,
  });
  const docDeleteUserId = await resolveUserIdFromProfile(profileId);
  if (docDeleteUserId) {
    await notifyAdminCustomerProfileUpdated(docDeleteUserId, "medical_document");
  }
  revalidatePath(`/admin/customers/${profileId}`);
  return { success: true };
}

export async function uploadAdminMedicalDocumentCore(
  formData: FormData,
): Promise<CustomerActionResult> {
  const file = formData.get("file") as File;
  const profileId = formData.get("profileId") as string;
  const userId = formData.get("userId") as string;

  const filePath = `${userId}/${Math.random()}_${file.name}`;
  const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
    .from("medical_records")
    .upload(filePath, file);

  if (uploadError) return { success: false, error: uploadError.message };

  const { error: dbError } = await supabaseAdmin
    .from("medical_documents")
    .insert({
      customer_profile_id: profileId,
      file_name: file.name,
      storage_path: uploadData?.path,
      file_size_bytes: file.size,
    });

  if (dbError) return { success: false, error: dbError.message };

  await supabaseAdmin
    .from("customer_profiles")
    .update({ has_medical_history: true })
    .eq("id", profileId);

  await logAdminAction("CREATE", "medical_document", profileId, {
    file_name: file.name,
  });
  if (userId) {
    await notifyAdminCustomerProfileUpdated(userId, "medical_document");
  }
  revalidatePath(`/admin/customers/${profileId}`);
  return { success: true };
}

// ─── Addresses ───────────────────────────────────────────────────────────────

export async function adminUpsertCustomerAddressCore(
  customerProfileId: string,
  data: AddressFormValues,
): Promise<CustomerActionResult> {
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

  const addressId = parsed.data.id;

  if (!addressId) {
    const { count } = await supabaseAdmin
      .from("addresses")
      .select("id", { count: "exact", head: true })
      .eq("customer_profile_id", customerProfileId);

    if (count !== null && count >= 2) {
      return { success: false, error: "Maximum of 2 addresses allowed." };
    }
  }

  if (parsed.data.is_primary) {
    await supabaseAdmin
      .from("addresses")
      .update({ is_primary: false })
      .eq("customer_profile_id", customerProfileId);
  }

  const addressData = {
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
  };

  const { error } = addressId
    ? await supabaseAdmin
        .from("addresses")
        .update(addressData)
        .eq("id", addressId)
        .eq("customer_profile_id", customerProfileId)
    : await supabaseAdmin.from("addresses").insert(addressData);

  if (error) return { success: false, error: error.message };

  await logAdminAction(
    addressId ? "UPDATE" : "CREATE",
    "customer_address",
    addressId || customerProfileId,
    { tag: parsed.data.tag },
  );
  const addressUserId = await resolveUserIdFromProfile(customerProfileId);
  if (addressUserId) {
    await notifyAdminCustomerProfileUpdated(addressUserId, "address", {
      isAddressEdit: Boolean(addressId),
      addressTag: parsed.data.tag,
    });
  }
  revalidatePath(`/admin/customers/${customerProfileId}`);
  return { success: true };
}

export async function adminDeleteCustomerAddressCore(
  customerProfileId: string,
  addressId: string,
): Promise<CustomerActionResult> {
  const result = await deleteCustomerAddress(customerProfileId, addressId);

  if (!result.success) {
    return { success: false, error: result.error };
  }

  await logAdminAction("DELETE", "customer_address", addressId, {
    customer_profile_id: customerProfileId,
  });
  const deleteAddressUserId = await resolveUserIdFromProfile(customerProfileId);
  if (deleteAddressUserId) {
    await notifyAdminCustomerProfileUpdated(deleteAddressUserId, "address", {
      isAddressDelete: true,
    });
  }
  revalidatePath(`/admin/customers/${customerProfileId}`);
  return { success: true };
}

// ─── User management ─────────────────────────────────────────────────────────

export async function adminSetCustomerPasswordCore(
  authUserId: string,
  newPassword: string,
): Promise<CustomerActionResult> {
  const { error } = await supabaseAdmin.auth.admin.updateUserById(authUserId, {
    password: newPassword,
  });
  if (error) return { success: false, error: error.message };
  await logAdminAction("UPDATE", "customer", authUserId, {
    action: "password_reset",
  });
  return { success: true };
}

export async function adminSendPasswordResetCore(
  email: string,
): Promise<CustomerActionResult> {
  const { error } = await supabaseAdmin.auth.admin.generateLink({
    type: "recovery",
    email,
  });
  if (error) return { success: false, error: error.message };
  await logAdminAction("UPDATE", "customer", email, {
    action: "password_reset_email",
  });
  return { success: true };
}

/**
 * Change the customer's login email — the Auth identity AND the `users` mirror.
 *
 * Carried over VERBATIM from `admin-actions/customerActions.adminUpdateCustomerEmail`
 * (only the `checkGroupManage` gate was left behind in the action), so the admin
 * portal's behaviour is unchanged: same format check, same duplicate-email
 * check, same failure messages, same `logAdminAction` payload, and the same
 * decision to LOG-BUT-NOT-FAIL when the `users` mirror update errors after the
 * Auth email has already changed.
 *
 * This was the one action of the eleven the franchise portal could not override,
 * so a franchise admin changing a customer's email hit the ADMIN-only gate and
 * was refused (franchise-scoped-access; Customer_360 "User Management" tab).
 */
export async function adminUpdateCustomerEmailCore(
  authUserId: string,
  newEmail: string,
): Promise<CustomerActionResult> {
  // Validate email format
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
    return { success: false, error: "Invalid email format" };
  }

  // Check if email already exists
  const { data: existingUser } = await supabaseAdmin.auth.admin.listUsers();
  const emailExists = existingUser?.users.some(
    (u) => u.email === newEmail && u.id !== authUserId,
  );

  if (emailExists) {
    return { success: false, error: "Email already in use by another account" };
  }

  // Update email via Supabase Admin API
  const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
    authUserId,
    { email: newEmail },
  );

  if (updateError) {
    return { success: false, error: updateError.message };
  }

  // Update email in users table as well. A failure here is logged rather than
  // returned: the Auth email has already changed, so reporting failure would be
  // misleading and a caller retrying could not undo it.
  const { error: usersError } = await supabaseAdmin
    .from("users")
    .update({ email: newEmail })
    .eq("auth_user_id", authUserId);

  if (usersError) {
    console.error("Failed to sync email to users table:", usersError);
  }

  await logAdminAction("UPDATE", "customer", authUserId, {
    action: "email_update",
    new_email: newEmail,
  });

  return { success: true };
}

// ─── Activation / deactivation ───────────────────────────────────────────────

/**
 * A customer with a live subscription may not be deactivated — the subscription
 * has to be cancelled first. Private to this module (both the deactivate and
 * the toggle core route through it).
 */
async function assertNoActiveSubscription(profileId: string) {
  const { count } = await supabaseAdmin
    .from("subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("customer_profile_id", profileId)
    .eq("status", "ACTIVE");

  if (count && count > 0) {
    return {
      ok: false as const,
      error:
        "Cannot deactivate — customer has an active subscription. Cancel the subscription first.",
    };
  }

  return { ok: true as const };
}

export async function deactivateCustomerAccountCore(
  profileId: string,
  userId: string,
): Promise<CustomerActionResult> {
  const guard = await assertNoActiveSubscription(profileId);
  if (!guard.ok) {
    return { success: false, error: guard.error };
  }

  const { data: userData, error: fetchError } = await supabaseAdmin
    .from("users")
    .select("email, full_name, mobile, auth_user_id, is_active")
    .eq("id", userId)
    .single();

  if (fetchError || !userData) {
    return { success: false, error: "Customer account not found." };
  }

  if (!userData.is_active && isArchivedCustomerEmail(userData.email)) {
    return { success: false, error: "Customer account is already archived." };
  }

  const originalEmail = userData.email;
  const originalMobile = userData.mobile;
  const archivedEmail = buildArchivedEmail(profileId);

  if (userData.auth_user_id) {
    const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(
      userData.auth_user_id,
      { email: archivedEmail, ban_duration: "876600h" },
    );
    if (authError) {
      return { success: false, error: authError.message };
    }
  }

  const { error: userError } = await supabaseAdmin
    .from("users")
    .update({
      email: archivedEmail,
      mobile: null,
      is_active: false,
    })
    .eq("id", userId);

  if (userError) {
    return { success: false, error: userError.message };
  }

  const { error: profileError } = await supabaseAdmin
    .from("customer_profiles")
    .update({ is_active: false })
    .eq("id", profileId);

  if (profileError) {
    return { success: false, error: profileError.message };
  }

  if (originalEmail && !isArchivedCustomerEmail(originalEmail)) {
    await sendEmail(
      originalEmail,
      ACCOUNT_DELETED_EMAIL_SUBJECT,
      accountDeletedEmailHtml({
        name: userData.full_name || "Valued Customer",
      }),
    );
  }

  await logAdminAction("UPDATE", "customer", profileId, {
    action: "deactivate",
    user_id: userId,
    original_email: originalEmail,
    original_mobile: originalMobile,
  });

  revalidatePath(`/admin/customers/${profileId}`);
  revalidatePath("/admin/customers");
  return { success: true };
}

export async function adminToggleCustomerActiveCore(
  profileId: string,
  userId: string,
  authUserId: string,
  makeActive: boolean,
): Promise<CustomerActionResult> {
  // Deactivation is the same operation as `deactivateCustomerAccountCore`.
  // Calling the CORE (not the gated action) keeps this to a single
  // authorization check, as it was before the extraction.
  if (!makeActive) {
    return deactivateCustomerAccountCore(profileId, userId);
  }

  const { data: userData, error: fetchError } = await supabaseAdmin
    .from("users")
    .select("email")
    .eq("id", userId)
    .single();

  if (fetchError || !userData) {
    return { success: false, error: "Customer account not found." };
  }

  if (isArchivedCustomerEmail(userData.email)) {
    return {
      success: false,
      error:
        "This account was archived. Create a new customer with the same email instead.",
    };
  }

  const { error: userError } = await supabaseAdmin
    .from("users")
    .update({ is_active: true })
    .eq("id", userId);
  if (userError) return { success: false, error: userError.message };

  const { error: profileError } = await supabaseAdmin
    .from("customer_profiles")
    .update({ is_active: true })
    .eq("id", profileId);
  if (profileError) return { success: false, error: profileError.message };

  const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(
    authUserId,
    { ban_duration: "none" },
  );
  if (authError) return { success: false, error: authError.message };

  await logAdminAction("UPDATE", "customer", profileId, {
    action: "reactivate",
    is_active: true,
  });
  revalidatePath(`/admin/customers/${profileId}`);
  revalidatePath("/admin/customers");
  return { success: true };
}
