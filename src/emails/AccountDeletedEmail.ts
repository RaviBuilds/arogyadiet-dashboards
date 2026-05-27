export interface AccountDeletedEmailProps {
  name: string;
  supportEmail?: string;
}

export function accountDeletedEmailHtml({
  name,
  supportEmail = "support@arogyadiet.com",
}: AccountDeletedEmailProps): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Account Closed — ArogyaDiet</title>
</head>
<body style="margin:0;padding:0;background-color:#f5f5f5;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f5;padding:32px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:#e85d26;padding:32px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:700;letter-spacing:-0.5px;">ArogyaDiet</h1>
              <p style="margin:6px 0 0;color:#fde8dc;font-size:13px;">Let's Go Eat</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:36px 40px;">
              <h2 style="margin:0 0 8px;color:#1a1a1a;font-size:20px;font-weight:600;">Account Closed</h2>
              <p style="margin:0 0 20px;color:#555555;font-size:15px;line-height:1.6;">
                Hi ${escapeHtml(name)},
              </p>
              <p style="margin:0 0 20px;color:#555555;font-size:15px;line-height:1.6;">
                We're writing to confirm that your ArogyaDiet account has been permanently closed by our team. Your account data, subscription history, and personal information have been removed from our systems.
              </p>

              <!-- Info Box -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff8f6;border:1px solid #f5cbb8;border-radius:8px;margin-bottom:24px;">
                <tr>
                  <td style="padding:20px 24px;">
                    <p style="margin:0;color:#555555;font-size:14px;line-height:1.7;">
                      &bull; Your login access has been revoked.<br />
                      &bull; All personal data has been deleted.<br />
                      &bull; Any active sessions have been terminated.
                    </p>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 20px;color:#555555;font-size:15px;line-height:1.6;">
                If you believe this was done in error or have any questions, please reach out to us at
                <a href="mailto:${escapeHtml(supportEmail)}" style="color:#e85d26;text-decoration:none;">${escapeHtml(supportEmail)}</a>.
              </p>

              <p style="margin:0;color:#555555;font-size:15px;line-height:1.6;">
                Thank you for being a part of ArogyaDiet. We wish you good health!
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f9f9f9;padding:20px 40px;text-align:center;border-top:1px solid #eeeeee;">
              <p style="margin:0;color:#bbbbbb;font-size:12px;">© ${new Date().getFullYear()} ArogyaDiet. All rights reserved.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export const ACCOUNT_DELETED_EMAIL_SUBJECT =
  "Your ArogyaDiet account has been closed";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
