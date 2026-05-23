"use server";

import { createClient as createAdminClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

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
  const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (authError && !authError.message.includes("User not found")) {
    return { success: false, error: authError.message };
  }

  const { error: userError } = await supabaseAdmin
    .from("users")
    .delete()
    .eq("id", userId);

  if (userError) return { success: false, error: userError.message };

  revalidatePath("/admin/customers");
  return { success: true };
}
