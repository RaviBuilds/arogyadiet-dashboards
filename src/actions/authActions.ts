"use server";

import { redirect } from "next/navigation";
import {
  sendPasswordResetEmail,
  updateUserPassword,
  login,
} from "@/services/AuthService";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export async function LoginAction(prevState: any, formData: FormData) {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const portalRole = formData.get("portalRole") as string;
  const redirectPath = formData.get("redirectPath") as string;

  let finalRedirectPath = redirectPath;

  console.log("--- LoginAction Triggered ---");
  console.log("Email:", email);
  console.log("Expected Portal Role:", portalRole);

  try {
    await login(email, password, portalRole);

    // --- NEW: Bypass cookie delay by querying the database directly ---
    const supabaseAdmin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    const { data: userData } = await supabaseAdmin
      .from("users")
      .select("force_password_change")
      .eq("email", email)
      .single();

    if (userData?.force_password_change) {
      console.log("User requires password change. Intercepting redirect.");
      finalRedirectPath = `/${portalRole.toLowerCase()}/update-password`;
    } else {
      console.log("Login successful, redirecting to:", finalRedirectPath);
    }
  } catch (error: any) {
    console.error("LoginAction Caught Error:", error.message);
    return { error: error.message };
  }

  redirect(finalRedirectPath);
}

//forgot password section
export async function forgotPasswordAction(prevState: any, formData: FormData) {
  const email = formData.get("email") as string;
  const headerList = await headers();
  const host = headerList.get("host");
  const protocol = host?.includes("localhost") ? "http" : "https";

  const exactRedirectUrl = `${protocol}://${host}/api/auth/recovery`;

  if (!email) {
    return { error: "Email is required!" };
  }
  try {
    await sendPasswordResetEmail(email, exactRedirectUrl);
    return { success: "Check your email for a password reset link." };
  } catch (error: any) {
    return { error: error.message };
  }
}

//update the password
export async function updatePasswordAction(prevState: any, formData: FormData) {
  const password = formData.get("password") as string;
  const confirmPassword = formData.get("confirmPassword") as string;

  if (password !== confirmPassword) {
    return { error: "Password do not match." };
  }
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters long." };
  }

  try {
    await updateUserPassword(password);

    // --- NEW: Clear the database flag so they aren't stuck in a loop ---
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      const supabaseAdmin = createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
      );
      await supabaseAdmin
        .from("users")
        .update({ force_password_change: false })
        .eq("auth_user_id", user.id);
    }
  } catch (error: any) {
    return { error: error.message };
  }

  redirect("/dashboard");
}
