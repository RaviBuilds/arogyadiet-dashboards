export interface FranchiseWelcomeEmailProps {
  ownerName: string;
  franchiseName: string;
  loginUrl: string;
  supportEmail: string;
}

export function franchiseWelcomeEmailHtml({
  ownerName,
  franchiseName,
  loginUrl,
  supportEmail,
}: FranchiseWelcomeEmailProps): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Welcome to ArogyaDiet Franchise Network</title>
</head>
<body style="margin:0;padding:0;background-color:#f5f5f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f5;padding:32px 0;">
    <tr>
      <td align="center">
        <table width="580" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#e85d26,#d4461a);padding:36px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:28px;font-weight:700;letter-spacing:-0.5px;">ArogyaDiet</h1>
              <p style="margin:8px 0 0;color:#fde8dc;font-size:14px;">Franchise Network</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px;">
              <h2 style="margin:0 0 8px;color:#1a1a1a;font-size:22px;font-weight:600;">
                Congratulations, ${escapeHtml(ownerName)}! 🎉
              </h2>
              <p style="margin:0 0 24px;color:#555555;font-size:15px;line-height:1.7;">
                Your franchise <strong>&ldquo;${escapeHtml(franchiseName)}&rdquo;</strong> has been activated and is now live on the ArogyaDiet network. You can start managing your operations immediately.
              </p>

              <!-- What You Can Do -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafe;border:1px solid #e2ecf4;border-radius:10px;margin-bottom:28px;">
                <tr>
                  <td style="padding:24px;">
                    <p style="margin:0 0 14px;font-size:14px;font-weight:600;color:#1a1a1a;">What you can do on your portal:</p>
                    <table cellpadding="0" cellspacing="0">
                      <tr><td style="padding:5px 0;color:#444;font-size:14px;">📊&nbsp; View your franchise dashboard with key metrics</td></tr>
                      <tr><td style="padding:5px 0;color:#444;font-size:14px;">👥&nbsp; Manage your customers and their subscriptions</td></tr>
                      <tr><td style="padding:5px 0;color:#444;font-size:14px;">🚚&nbsp; Track riders and delivery operations</td></tr>
                      <tr><td style="padding:5px 0;color:#444;font-size:14px;">📦&nbsp; Monitor today's orders and delivery batches</td></tr>
                      <tr><td style="padding:5px 0;color:#444;font-size:14px;">📈&nbsp; View revenue and performance reports</td></tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Getting Started -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#fdf8f0;border:1px solid #f5e0c4;border-radius:10px;margin-bottom:28px;">
                <tr>
                  <td style="padding:24px;">
                    <p style="margin:0 0 14px;font-size:14px;font-weight:600;color:#1a1a1a;">Getting Started:</p>
                    <table cellpadding="0" cellspacing="0">
                      <tr><td style="padding:5px 0;color:#444;font-size:14px;">1. Click the button below to log in</td></tr>
                      <tr><td style="padding:5px 0;color:#444;font-size:14px;">2. You'll be asked to set a new password on first login</td></tr>
                      <tr><td style="padding:5px 0;color:#444;font-size:14px;">3. After setting your password, you'll see your franchise dashboard</td></tr>
                      <tr><td style="padding:5px 0;color:#444;font-size:14px;">4. Explore each section using the navigation menu</td></tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- CTA Button -->
              <table cellpadding="0" cellspacing="0" style="margin:0 auto 28px;">
                <tr>
                  <td style="background:#e85d26;border-radius:10px;">
                    <a href="${loginUrl}" style="display:inline-block;padding:15px 36px;color:#ffffff;font-size:16px;font-weight:600;text-decoration:none;letter-spacing:0.3px;">
                      Log In to Your Franchise Portal &rarr;
                    </a>
                  </td>
                </tr>
              </table>

              <hr style="border:none;border-top:1px solid #eeeeee;margin:0 0 24px;" />

              <!-- Support -->
              <p style="margin:0 0 6px;color:#555555;font-size:14px;line-height:1.6;">
                <strong>Need help?</strong> Our team is here for you.
              </p>
              <p style="margin:0;color:#555555;font-size:14px;line-height:1.6;">
                Contact ArogyaDiet support at: 
                <a href="mailto:${escapeHtml(supportEmail)}" style="color:#e85d26;text-decoration:none;font-weight:600;">${escapeHtml(supportEmail)}</a>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f9f9f9;padding:24px 40px;text-align:center;border-top:1px solid #eeeeee;">
              <p style="margin:0 0 4px;color:#999999;font-size:12px;">
                This email was sent because your franchise was activated on the ArogyaDiet platform.
              </p>
              <p style="margin:0;color:#bbbbbb;font-size:11px;">
                &copy; ${new Date().getFullYear()} ArogyaDiet. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export const FRANCHISE_WELCOME_SUBJECT = "🎉 Your ArogyaDiet Franchise is Now Live!";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
