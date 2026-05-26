"use server";

import { createClient as createAdminClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import type { AddressFormValues } from "@/validations/addressSchema";
import { sendEmail } from "@/services/emailService";
import {
  welcomeEmailHtml,
  WELCOME_EMAIL_SUBJECT,
} from "@/emails/WelcomeEmail";
import {
  accountDeletedEmailHtml,
  ACCOUNT_DELETED_EMAIL_SUBJECT,
} from "@/emails/AccountDeletedEmail";

// Initialize Admin Client
const supabaseAdmin = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function updateCustomerBasicInfo(
  profileId: string,
  userId: string,
  data: any,
) {
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
  return { success: true };
}

export async function updateCustomerDietaryProfile(
  profileId: string,
  data: any,
) {
  const { error } = await supabaseAdmin
    .from("customer_profiles")
    .update({
      dietary_preference: data.dietaryPreference,
      allergies: data.allergies,
    })
    .eq("id", profileId);
  if (error) return { success: false, error: error.message };
  return { success: true };
}

export async function updateCustomerMedicalProfile(
  profileId: string,
  data: any,
) {
  const { error } = await supabaseAdmin
    .from("customer_profiles")
    .update({
      medical_history_notes: data.medicalHistoryNotes,
      has_medical_history: data.hasMedicalHistory,
    })
    .eq("id", profileId);
  if (error) return { success: false, error: error.message };
  return { success: true };
}

export async function deleteMedicalDocument(
  docId: string,
  path: string,
  profileId: string,
) {
  const { error: storageError } = await supabaseAdmin.storage.from("medical_records").remove([path]);
  if (storageError) return { success: false, error: storageError.message };
  const { error: dbError } = await supabaseAdmin.from("medical_documents").delete().eq("id", docId);
  if (dbError) return { success: false, error: dbError.message };
  revalidatePath(`/admin/customers/${profileId}`);
  return { success: true };
}

export async function uploadAdminMedicalDocument(formData: FormData) {
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

  revalidatePath(`/admin/customers/${profileId}`);
  return { success: true };
}

export async function revalidateCustomersPage() {
  revalidatePath("/admin/customers");
}

export async function deleteCustomer(profileId: string, userId: string) {
  // Guard: cannot delete a customer with an active subscription
  const { count } = await supabaseAdmin
    .from("subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("customer_profile_id", profileId)
    .eq("status", "ACTIVE");
  if (count && count > 0) {
    return {
      success: false,
      error:
        "Cannot delete — customer has an active subscription. Cancel the subscription first.",
    };
  }

  // Fetch email + name before deleting (so we can send the notification)
  const { data: userData } = await supabaseAdmin
    .from("users")
    .select("email, full_name")
    .eq("id", userId)
    .single();

  const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (authError && !authError.message.includes("User not found")) {
    return { success: false, error: authError.message };
  }

  const { error: userError } = await supabaseAdmin
    .from("users")
    .delete()
    .eq("id", userId);

  if (userError) return { success: false, error: userError.message };

  // Send account-deleted email if we have the customer's email
  if (userData?.email) {
    await sendEmail(
      userData.email,
      ACCOUNT_DELETED_EMAIL_SUBJECT,
      accountDeletedEmailHtml({ name: userData.full_name || "Valued Customer" }),
    );
  }

  revalidatePath("/admin/customers");
  return { success: true };
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
  // Enforce max 2 addresses
  const { count } = await supabaseAdmin
    .from("addresses")
    .select("id", { count: "exact", head: true })
    .eq("customer_profile_id", customerProfileId);

  if (count !== null && count >= 2) {
    return { success: false, error: "Maximum of 2 addresses allowed." };
  }

  // If setting as primary, clear existing primaries
  if (data.is_primary) {
    await supabaseAdmin
      .from("addresses")
      .update({ is_primary: false })
      .eq("customer_profile_id", customerProfileId);
  }

  const { error } = await supabaseAdmin.from("addresses").insert({
    customer_profile_id: customerProfileId,
    tag: data.tag,
    street_1: data.street_1,
    street_2: data.street_2 || null,
    landmark: data.landmark || null,
    city: data.city,
    state: data.state,
    pincode: data.pincode,
    is_primary: data.is_primary,
    lat: data.lat ?? null,
    lng: data.lng ?? null,
  });

  if (error) return { success: false, error: error.message };
  return { success: true };
}

export async function adminUpsertCustomerAddress(
  customerProfileId: string,
  data: AddressFormValues,
) {
  const parsed = addressSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false, error: "Invalid address data." };
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

  revalidatePath(`/admin/customers/${customerProfileId}`);
  return { success: true };
}

export async function adminDeleteCustomerAddress(
  customerProfileId: string,
  addressId: string,
) {
  const { error } = await supabaseAdmin
    .from("addresses")
    .delete()
    .eq("id", addressId)
    .eq("customer_profile_id", customerProfileId);

  if (error) return { success: false, error: error.message };

  revalidatePath(`/admin/customers/${customerProfileId}`);
  return { success: true };
}

// ── User Management Actions ───────────────────────────────────────────────────

export async function adminSetCustomerPassword(
  authUserId: string,
  newPassword: string,
) {
  const { error } = await supabaseAdmin.auth.admin.updateUserById(authUserId, {
    password: newPassword,
  });
  if (error) return { success: false, error: error.message };
  return { success: true };
}

export async function adminSendPasswordReset(email: string) {
  const { error } = await supabaseAdmin.auth.admin.generateLink({
    type: "recovery",
    email,
  });
  if (error) return { success: false, error: error.message };
  return { success: true };
}

export async function adminToggleCustomerActive(
  profileId: string,
  userId: string,
  authUserId: string,
  makeActive: boolean,
) {
  // Guard: cannot deactivate a customer with an active subscription
  if (!makeActive) {
    const { count } = await supabaseAdmin
      .from("subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("customer_profile_id", profileId)
      .eq("status", "ACTIVE");
    if (count && count > 0) {
      return {
        success: false,
        error:
          "Cannot deactivate — customer has an active subscription. Cancel the subscription first.",
      };
    }
  }

  const { error: userError } = await supabaseAdmin
    .from("users")
    .update({ is_active: makeActive })
    .eq("id", userId);
  if (userError) return { success: false, error: userError.message };

  const { error: profileError } = await supabaseAdmin
    .from("customer_profiles")
    .update({ is_active: makeActive })
    .eq("id", profileId);
  if (profileError) return { success: false, error: profileError.message };

  // Ban/unban in Supabase Auth
  const { error: authError } =
    await supabaseAdmin.auth.admin.updateUserById(authUserId, {
      ban_duration: makeActive ? "none" : "876600h",
    });
  if (authError) return { success: false, error: authError.message };

  revalidatePath(`/admin/customers/${profileId}`);
  revalidatePath("/admin/customers");
  return { success: true };
}
