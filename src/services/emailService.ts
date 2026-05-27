import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM =
  process.env.RESEND_FROM_EMAIL || "ArogyaDiet <noreply@arogyadiet.com>";

export async function sendEmail(
  to: string,
  subject: string,
  html: string,
): Promise<void> {
  try {
    const { error } = await resend.emails.send({ from: FROM, to, subject, html });
    if (error) {
      console.error(`[emailService] Failed to send "${subject}" to ${to}:`, error);
    }
  } catch (err) {
    console.error(`[emailService] Unexpected error sending email to ${to}:`, err);
  }
}
