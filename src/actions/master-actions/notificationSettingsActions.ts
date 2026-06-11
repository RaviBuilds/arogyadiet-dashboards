"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/services/emailService";

/**
 * Get the shared admin email from system_settings
 */
export async function getSharedAdminEmail(): Promise<string> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("system_settings")
    .select("shared_admin_email")
    .eq("id", "global")
    .single();

  if (error || !data?.shared_admin_email) {
    // Fallback to the hardcoded default
    return "arogya664@gmail.com";
  }

  return data.shared_admin_email;
}

/**
 * Update the shared admin email in system_settings
 */
export async function updateSharedAdminEmail(
  email: string
): Promise<{ success: boolean; error?: string }> {
  if (!email || !email.includes("@")) {
    return { success: false, error: "Please enter a valid email address." };
  }

  const supabase = createAdminClient();

  const { error } = await supabase
    .from("system_settings")
    .update({
      shared_admin_email: email.trim(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", "global");

  if (error) {
    console.error("updateSharedAdminEmail error:", error);
    return { success: false, error: error.message };
  }

  revalidatePath("/master/reports");
  return { success: true };
}

/**
 * Send a test email to the shared admin email
 */
export async function sendTestEmailToSharedAdmin(): Promise<{
  success: boolean;
  error?: string;
  sentTo?: string;
}> {
  const email = await getSharedAdminEmail();

  if (!email) {
    return { success: false, error: "No shared admin email configured." };
  }

  const subject = "🧪 ArogyaDiet - Test Email";
  const html = `
    <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto; padding: 32px;">
      <h2 style="color: #1e293b; margin-bottom: 16px;">Test Email from ArogyaDiet</h2>
      <p style="color: #475569; font-size: 14px; line-height: 1.6;">
        This is a test email sent from the <strong>Master Admin Report Engine</strong> page.
        If you received this, the shared admin email configuration is working correctly.
      </p>
      <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
      <p style="color: #94a3b8; font-size: 12px;">
        Sent to: ${email}<br/>
        Timestamp: ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
      </p>
    </div>
  `;

  try {
    await sendEmail(email, subject, html);
    return { success: true, sentTo: email };
  } catch (err) {
    console.error("sendTestEmailToSharedAdmin error:", err);
    return { success: false, error: "Failed to send test email." };
  }
}
