export interface WelcomeEmailProps {
  name: string;
  email: string;
  password: string;
  loginUrl?: string;
}

export function welcomeEmailHtml({
  name,
  email,
  password,
  loginUrl = "https://arogyadiet.com/login",
}: WelcomeEmailProps): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Welcome to ArogyaDiet</title>
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
              <h2 style="margin:0 0 8px;color:#1a1a1a;font-size:20px;font-weight:600;">Welcome, ${escapeHtml(name)}!</h2>
              <p style="margin:0 0 24px;color:#555555;font-size:15px;line-height:1.6;">
                Your ArogyaDiet account has been created by our team. You can log in immediately using the credentials below.
              </p>

              <!-- Credentials Box -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#fdf4f0;border:1px solid #f5cbb8;border-radius:8px;margin-bottom:24px;">
                <tr>
                  <td style="padding:20px 24px;">
                    <p style="margin:0 0 12px;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:#888888;">Your Login Details</p>
                    <table cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding:4px 0;color:#555;font-size:14px;width:80px;">Email</td>
                        <td style="padding:4px 0;color:#1a1a1a;font-size:14px;font-weight:600;">${escapeHtml(email)}</td>
                      </tr>
                      <tr>
                        <td style="padding:4px 0;color:#555;font-size:14px;">Password</td>
                        <td style="padding:4px 0;color:#e85d26;font-size:14px;font-weight:700;font-family:monospace;">${escapeHtml(password)}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 24px;color:#555555;font-size:14px;line-height:1.6;">
                We recommend changing your password after your first login for security.
              </p>

              <!-- CTA Button -->
              <table cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                <tr>
                  <td style="background:#e85d26;border-radius:8px;">
                    <a href="${loginUrl}" style="display:inline-block;padding:13px 28px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">Log In to ArogyaDiet</a>
                  </td>
                </tr>
              </table>

              <hr style="border:none;border-top:1px solid #eeeeee;margin:0 0 20px;" />

              <p style="margin:0;color:#999999;font-size:13px;line-height:1.5;">
                If you have any questions, reply to this email or contact our support team. We're happy to help!
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

export const WELCOME_EMAIL_SUBJECT = "Welcome to ArogyaDiet — Your account is ready";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
