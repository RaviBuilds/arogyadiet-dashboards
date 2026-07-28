"use server";

import { createClient as createAdminClient } from "@supabase/supabase-js";
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
import { checkGroupManage, getCurrentAdminContext } from "@/lib/auth/adminAccess";
import { resolveClinicForPincode } from "@/lib/clinic/pincode-resolver";
import { reconcileOnClinicChange } from "@/services/AssignmentService";
import type { CustomerCategory } from "@/types/dietitian";
import { getISTDateString } from "@/lib/dates/ist";
import {
  ADDON_STATUS_DELIVERED,
  FULFILLMENT_DELIVERED_OFFLINE,
} from "@/lib/shop/addonFulfillment";

// Initialize Admin Client
const supabaseAdmin = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function adminUpdateAddonOrderDeliveryDate(
  addonOrderId: string,
  newDeliveryDate: string,
) {
  const gate = await checkGroupManage("customers");
  if (!gate.ok) return { success: false, error: gate.error };

  const today = getISTDateString(0);
  if (newDeliveryDate <= today) {
    return { success: false, error: "Delivery date must be after today." };
  }

  const { data: order, error: fetchError } = await supabaseAdmin
    .from("addon_orders")
    .select("id, status, delivery_order_id, customer_profile_id")
    .eq("id", addonOrderId)
    .single();

  if (fetchError || !order) return { success: false, error: "Order not found." };
  if (order.status !== "PAID")
    return { success: false, error: "Only paid orders can be rescheduled." };
  if (order.delivery_order_id)
    return { success: false, error: "This order has already been scheduled and cannot be changed." };

  // The chosen date must be an ACTIVE (non-paused) delivery day that exists in
  // the customer's upcoming preferences. Because daily preferences only span
  // the subscription window, this single check enforces all three rules:
  //   - it is not a paused day (is_paused = false),
  //   - it is within the subscription (a preference row exists for the date),
  //   - it is a real delivery day the order can ride along with.
  const { data: pref, error: prefError } = await supabaseAdmin
    .from("subscription_daily_preferences")
    .select("preference_date, is_paused")
    .eq("customer_profile_id", order.customer_profile_id)
    .eq("preference_date", newDeliveryDate)
    .maybeSingle();

  if (prefError) return { success: false, error: prefError.message };
  if (!pref) {
    return {
      success: false,
      error:
        "The selected date is outside the customer's subscription window.",
    };
  }
  if (pref.is_paused) {
    return {
      success: false,
      error: "The selected date is a paused day. Choose an active delivery day.",
    };
  }

  const { error: updateError } = await supabaseAdmin
    .from("addon_orders")
    .update({ target_delivery_date: newDeliveryDate })
    .eq("id", addonOrderId);

  if (updateError) return { success: false, error: updateError.message };

  await logAdminAction("UPDATE", "addon_order", addonOrderId, {
    target_delivery_date: newDeliveryDate,
  });
  revalidatePath("/admin/customers");
  revalidatePath("/admin/operations");
  revalidatePath("/shop/orders");
  return { success: true };
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

  const { data: order, error: fetchError } = await supabaseAdmin
    .from("addon_orders")
    .select("id, status")
    .eq("id", addonOrderId)
    .single();

  if (fetchError || !order) return { success: false, error: "Order not found." };
  if (order.status === "PENDING")
    return {
      success: false,
      error: "This order is not paid yet and cannot be marked delivered.",
    };
  if (order.status !== "PAID")
    return {
      success: false,
      error: "Only a paid (undelivered) order can be marked delivered.",
    };

  const { error: updateError } = await supabaseAdmin
    .from("addon_orders")
    .update({
      status: ADDON_STATUS_DELIVERED,
      fulfillment_status: FULFILLMENT_DELIVERED_OFFLINE,
      delivered_at: new Date().toISOString(),
      // Unlink from any assigned delivery so no rider carries it.
      delivery_order_id: null,
    })
    .eq("id", addonOrderId);

  if (updateError) return { success: false, error: updateError.message };

  await logAdminAction("UPDATE", "addon_order", addonOrderId, {
    fulfillment_status: FULFILLMENT_DELIVERED_OFFLINE,
    marked_delivered_offline: true,
  });
  revalidatePath("/admin/operations");
  revalidatePath("/admin/customers");
  revalidatePath("/shop/orders");
  return { success: true };
}

export async function updateCustomerBasicInfo(
  profileId: string,
  userId: string,
  data: any,
) {
  const gate = await checkGroupManage("customers");
  if (!gate.ok) return { success: false, error: gate.error };
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

export async function updateCustomerDietaryProfile(
  profileId: string,
  data: any,
) {
  const gate = await checkGroupManage("customers");
  if (!gate.ok) return { success: false, error: gate.error };
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

export async function updateCustomerMedicalProfile(
  profileId: string,
  data: any,
) {
  const gate = await checkGroupManage("customers");
  if (!gate.ok) return { success: false, error: gate.error };
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

export async function deleteMedicalDocument(
  docId: string,
  path: string,
  profileId: string,
) {
  const gate = await checkGroupManage("customers");
  if (!gate.ok) return { success: false, error: gate.error };
  const { error: storageError } = await supabaseAdmin.storage.from("medical_records").remove([path]);
  if (storageError) return { success: false, error: storageError.message };
  const { error: dbError } = await supabaseAdmin.from("medical_documents").delete().eq("id", docId);
  if (dbError) return { success: false, error: dbError.message };
  await logAdminAction("DELETE", "medical_document", docId, { profile_id: profileId });
  const docDeleteUserId = await resolveUserIdFromProfile(profileId);
  if (docDeleteUserId) {
    await notifyAdminCustomerProfileUpdated(docDeleteUserId, "medical_document");
  }
  revalidatePath(`/admin/customers/${profileId}`);
  return { success: true };
}

export async function uploadAdminMedicalDocument(formData: FormData) {
  const gate = await checkGroupManage("customers");
  if (!gate.ok) return { success: false, error: gate.error };
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

export async function revalidateCustomersPage() {
  revalidatePath("/admin/customers");
}

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

export async function deactivateCustomerAccount(
  profileId: string,
  userId: string,
) {
  const gate = await checkGroupManage("customers");
  if (!gate.ok) return { success: false, error: gate.error };
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

/** @deprecated Use deactivateCustomerAccount */
export async function deleteCustomer(profileId: string, userId: string) {
  const gate = await checkGroupManage("customers");
  if (!gate.ok) return { success: false, error: gate.error };
  return deactivateCustomerAccount(profileId, userId);
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

  await logAdminAction(addressId ? "UPDATE" : "CREATE", "customer_address", addressId || customerProfileId, {
    tag: parsed.data.tag,
  });
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

export async function adminDeleteCustomerAddress(
  customerProfileId: string,
  addressId: string,
) {
  const gate = await checkGroupManage("customers");
  if (!gate.ok) return { success: false, error: gate.error };
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

// ── User Management Actions ───────────────────────────────────────────────────

export async function adminSetCustomerPassword(
  authUserId: string,
  newPassword: string,
) {
  const gate = await checkGroupManage("customers");
  if (!gate.ok) return { success: false, error: gate.error };
  const { error } = await supabaseAdmin.auth.admin.updateUserById(authUserId, {
    password: newPassword,
  });
  if (error) return { success: false, error: error.message };
  await logAdminAction("UPDATE", "customer", authUserId, { action: "password_reset" });
  return { success: true };
}

export async function adminSendPasswordReset(email: string) {
  const gate = await checkGroupManage("customers");
  if (!gate.ok) return { success: false, error: gate.error };
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

export async function adminUpdateCustomerEmail(
  authUserId: string,
  newEmail: string,
) {
  const gate = await checkGroupManage("customers");
  if (!gate.ok) return { success: false, error: gate.error };
  
  // Validate email format
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
    return { success: false, error: "Invalid email format" };
  }
  
  // Check if email already exists
  const { data: existingUser } = await supabaseAdmin.auth.admin.listUsers();
  const emailExists = existingUser?.users.some(u => u.email === newEmail && u.id !== authUserId);
  
  if (emailExists) {
    return { success: false, error: "Email already in use by another account" };
  }
  
  // Update email via Supabase Admin API
  const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
    authUserId,
    { email: newEmail }
  );
  
  if (updateError) {
    return { success: false, error: updateError.message };
  }
  
  // Update email in users table as well
  const { error: usersError } = await supabaseAdmin
    .from("users")
    .update({ email: newEmail })
    .eq("auth_user_id", authUserId);
  
  if (usersError) {
    console.error("Failed to sync email to users table:", usersError);
  }
  
  await logAdminAction("UPDATE", "customer", authUserId, { 
    action: "email_update",
    new_email: newEmail 
  });
  
  return { success: true };
}

export async function adminToggleCustomerActive(
  profileId: string,
  userId: string,
  authUserId: string,
  makeActive: boolean,
) {
  const gate = await checkGroupManage("customers");
  if (!gate.ok) return { success: false, error: gate.error };
  if (!makeActive) {
    return deactivateCustomerAccount(profileId, userId);
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

  const { error: authError } =
    await supabaseAdmin.auth.admin.updateUserById(authUserId, {
      ban_duration: "none",
    });
  if (authError) return { success: false, error: authError.message };

  await logAdminAction("UPDATE", "customer", profileId, {
    action: "reactivate",
    is_active: true,
  });
  revalidatePath(`/admin/customers/${profileId}`);
  revalidatePath("/admin/customers");
  return { success: true };
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
