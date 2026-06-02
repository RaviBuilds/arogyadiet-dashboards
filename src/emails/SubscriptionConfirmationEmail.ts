export interface SubscriptionConfirmationEmailProps {
  name: string;
  planName: string;
  startDate: string;
  endDate: string;
  totalDays: number;
  paymentStatus: string;
  dashboardUrl?: string;
}

export function subscriptionConfirmationEmailHtml({
  name,
  planName,
  startDate,
  endDate,
  totalDays,
  paymentStatus,
  dashboardUrl = "https://arogyadiet.com/dashboard",
}: SubscriptionConfirmationEmailProps): string {
  const paymentBadgeColor = paymentStatus === "PAID" ? "#16a34a" : "#d97706";
  const paymentBadgeBg = paymentStatus === "PAID" ? "#f0fdf4" : "#fffbeb";
  const paymentBadgeBorder = paymentStatus === "PAID" ? "#86efac" : "#fcd34d";
  const paymentLabel = paymentStatus === "PAID" ? "Payment Received" : "Payment Pending";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Subscription Confirmed — ArogyaDiet</title>
</head>
<body style="margin:0;padding:0;background-color:#f5f5f5;font-family:Arial,sans-serif;">
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
              <p style="margin:0 0 4px;color:#888888;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Subscription Confirmed</p>
              <h2 style="margin:0 0 6px;color:#1a1a1a;font-size:22px;font-weight:700;">${escapeHtml(planName)}</h2>
              <p style="margin:0 0 28px;color:#555555;font-size:15px;line-height:1.6;">
                Hi ${escapeHtml(name)}, your meal plan subscription has been confirmed. Here are your plan details:
              </p>

              <!-- Plan Details Box -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#fdf4f0;border:1px solid #f5cbb8;border-radius:8px;margin-bottom:24px;">
                <tr>
                  <td style="padding:24px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding:8px 0;border-bottom:1px solid #f0d5c8;">
                          <table width="100%">
                            <tr>
                              <td style="color:#777777;font-size:14px;">Plan</td>
                              <td style="color:#1a1a1a;font-size:14px;font-weight:600;text-align:right;">${escapeHtml(planName)}</td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0;border-bottom:1px solid #f0d5c8;">
                          <table width="100%">
                            <tr>
                              <td style="color:#777777;font-size:14px;">Start Date</td>
                              <td style="color:#1a1a1a;font-size:14px;font-weight:600;text-align:right;">${escapeHtml(startDate)}</td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0;border-bottom:1px solid #f0d5c8;">
                          <table width="100%">
                            <tr>
                              <td style="color:#777777;font-size:14px;">End Date</td>
                              <td style="color:#1a1a1a;font-size:14px;font-weight:600;text-align:right;">${escapeHtml(endDate)}</td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0;border-bottom:1px solid #f0d5c8;">
                          <table width="100%">
                            <tr>
                              <td style="color:#777777;font-size:14px;">Total Meals</td>
                              <td style="color:#1a1a1a;font-size:14px;font-weight:600;text-align:right;">${totalDays} days</td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0;">
                          <table width="100%">
                            <tr>
                              <td style="color:#777777;font-size:14px;">Payment</td>
                              <td style="text-align:right;">
                                <span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600;color:${paymentBadgeColor};background:${paymentBadgeBg};border:1px solid ${paymentBadgeBorder};">
                                  ${paymentLabel}
                                </span>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 24px;color:#555555;font-size:14px;line-height:1.6;">
                Your daily meals will be planned according to your dietary preferences. You can view your meal schedule and manage your subscription from your dashboard.
              </p>

              <!-- CTA Button -->
              <table cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                <tr>
                  <td style="background:#e85d26;border-radius:8px;">
                    <a href="${dashboardUrl}" style="display:inline-block;padding:13px 28px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">View My Dashboard</a>
                  </td>
                </tr>
              </table>

              <hr style="border:none;border-top:1px solid #eeeeee;margin:0 0 20px;" />

              <p style="margin:0;color:#999999;font-size:13px;line-height:1.5;">
                Questions? Reply to this email or contact our team. We're here to help you on your health journey!
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

export function subscriptionConfirmationSubject(planName: string): string {
  return `Subscription Confirmed — ${planName}`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
