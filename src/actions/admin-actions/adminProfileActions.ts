"use server";

import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  adminDisplayNameSchema,
  adminPasswordSchema,
} from "@/validations/adminProfileSchema";

type ActionResult = { success: true } | { success: false; error: string };

async function assertAdminUser() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { supabase, user: null, error: "Unauthorized" as const };
  }

  const { data: dbUser, error: userError } = await supabase
    .from("users")
    .select("id, email, roles(code)")
    .eq("auth_user_id", user.id)
    .single();

  if (userError || !dbUser) {
    return { supabase, user: null, error: "User record not found" as const };
  }

  const roles = dbUser.roles as
    | { code: string }[]
    | { code: string }
    | null
    | undefined;
  const roleCode = Array.isArray(roles) ? roles[0]?.code : roles?.code;

  if (roleCode !== "ADMIN") {
    return { supabase, user: null, error: "Unauthorized" as const };
  }

  return { supabase, user, dbUser, error: null };
}

export async function updateAdminDisplayNameAction(
  fullName: string,
): Promise<ActionResult> {
  const parsed = adminDisplayNameSchema.safeParse({ full_name: fullName });
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid display name",
    };
  }

  const auth = await assertAdminUser();
  if (auth.error || !auth.user) {
    return { success: false, error: auth.error ?? "Unauthorized" };
  }

  const { error: updateError } = await auth.supabase
    .from("users")
    .update({
      full_name: parsed.data.full_name,
      updated_at: new Date().toISOString(),
    })
    .eq("auth_user_id", auth.user.id);

  if (updateError) {
    return { success: false, error: "Failed to update display name." };
  }

  revalidatePath("/profile");
  return { success: true };
}

export async function changeAdminPasswordAction(
  currentPassword: string,
  newPassword: string,
  confirmPassword: string,
): Promise<ActionResult> {
  const parsed = adminPasswordSchema.safeParse({
    currentPassword,
    newPassword,
    confirmPassword,
  });

  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid password input",
    };
  }

  const auth = await assertAdminUser();
  if (auth.error || !auth.user || !auth.dbUser?.email) {
    return { success: false, error: auth.error ?? "Unauthorized" };
  }

  const { error: verifyError } = await auth.supabase.auth.signInWithPassword({
    email: auth.dbUser.email,
    password: parsed.data.currentPassword,
  });

  if (verifyError) {
    return { success: false, error: "Existing password is incorrect." };
  }

  const { error: updateError } = await auth.supabase.auth.updateUser({
    password: parsed.data.newPassword,
  });

  if (updateError) {
    return { success: false, error: updateError.message };
  }

  const supabaseAdmin = createAdminClient();
  await supabaseAdmin
    .from("users")
    .update({
      force_password_change: false,
      updated_at: new Date().toISOString(),
    })
    .eq("auth_user_id", auth.user.id);

  return { success: true };
}
