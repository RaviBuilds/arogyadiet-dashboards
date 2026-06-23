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
import { logAdminAction } from "@/lib/logger";

const supabaseAdmin = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export interface FranchiseCreateCustomerData {
  fullName: string;
  email: string;
  mobile: string;
  password: string;
  gender?: string;
  dateOfBirth?: string;
  dietaryPreference?: string;
  allergies?: string;
  hasMedicalHistory?: boolean;
  medicalHistoryNotes?: string;
  addresses?: AddressFormValues[];
  franchiseId: string;
}

/**
 * Creates a customer profile stamped with the franchise_id.
 * Same as admin create but ensures the customer belongs to the calling franchise.
 */
export async function franchiseCreateCustomerAction(data: FranchiseCreateCustomerData) {
  if (!data.franchiseId) {
    return { success: false, error: "Franchise ID is required." };
  }

  // 1. Create Supabase auth user
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

  // 3. Insert into users with franchise_id
  const { data: userData, error: userError } = await supabaseAdmin
    .from("users")
    .insert({
      auth_user_id: authUserId,
      role_id: roleData.id,
      full_name: data.fullName,
      email: data.email,
      mobile: data.mobile,
      is_active: true,
      franchise_id: data.franchiseId,
    })
    .select("id")
    .single();

  if (userError || !userData) {
    await supabaseAdmin.auth.admin.deleteUser(authUserId);
    return { success: false, error: "Failed to create user record." };
  }

  // 4. Insert into customer_profiles with franchise_id
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
      franchise_id: data.franchiseId,
    })
    .select("id")
    .single();

  if (profileError || !profileData) {
    await supabaseAdmin.auth.admin.deleteUser(authUserId);
    return { success: false, error: "Failed to create customer profile." };
  }

  // 5. Insert addresses
  if (data.addresses && data.addresses.length > 0) {
    for (const addr of data.addresses.slice(0, 2)) {
      await franchiseCreateAddressForCustomer(profileData.id, addr, data.franchiseId);
    }
  }

  await logAdminAction("CREATE", "customer", profileData.id, {
    email: data.email,
    full_name: data.fullName,
    franchise_id: data.franchiseId,
  });
  revalidatePath("/franchise/customers");

  // Send welcome email (non-blocking)
  await sendEmail(
    data.email,
    WELCOME_EMAIL_SUBJECT,
    welcomeEmailHtml({ name: data.fullName, email: data.email, password: data.password }),
  );

  return { success: true, profileId: profileData.id };
}

async function franchiseCreateAddressForCustomer(
  customerProfileId: string,
  data: AddressFormValues,
  franchiseId: string,
) {
  const serviceAreaPincodes = await getServiceAreaPincodesAction();
  const parsed = createAddressSchema(serviceAreaPincodes).safeParse(data);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid address data." };
  }

  if (parsed.data.is_primary) {
    await supabaseAdmin
      .from("addresses")
      .update({ is_primary: false })
      .eq("customer_profile_id", customerProfileId);
  }

  const { error: insertError } = await supabaseAdmin.from("addresses").insert({
    customer_profile_id: customerProfileId,
    tag: parsed.data.tag,
    street_1: parsed.data.street_1,
    street_2: parsed.data.street_2 || null,
    landmark: parsed.data.landmark || null,
    city: parsed.data.city,
    state: parsed.data.state,
    pincode: parsed.data.pincode,
    lat: parsed.data.lat,
    lng: parsed.data.lng,
    is_primary: parsed.data.is_primary,
    franchise_id: franchiseId,
  });

  if (insertError) {
    return { success: false, error: insertError.message };
  }

  return { success: true };
}
