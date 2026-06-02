export interface RiderPaymentEmailProps {
  name: string;
  amount: number;
  period: string;
  notes: string;
  paidDate: string;
}

export function riderPaymentEmailHtml({
  name,
  amount,
  period,
  notes,
  paidDate,
}: RiderPaymentEmailProps): string {
  const formattedAmount = new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Payment Processed — ArogyaDiet</title>
</head>
<body style="margin:0;padding:0;background-color:#f5f5f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f5;padding:32px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:#16a34a;padding:32px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:700;letter-spacing:-0.5px;">ArogyaDiet</h1>
              <p style="margin:6px 0 0;color:#dcfce7;font-size:13px;">Delivery Partner Payment</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:36px 40px;">
              <p style="margin:0 0 4px;color:#888888;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Payment Processed</p>
              <h2 style="margin:0 0 6px;color:#1a1a1a;font-size:22px;font-weight:700;">&#8377;${escapeHtml(formattedAmount)}</h2>
              <p style="margin:0 0 28px;color:#555555;font-size:15px;line-height:1.6;">
                Hi ${escapeHtml(name)}, your delivery payout has been processed. Here are the details:
              </p>

              <!-- Details Box -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;margin-bottom:24px;">
                <tr>
                  <td style="padding:24px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding:8px 0;border-bottom:1px solid #bbf7d0;">
                          <table width="100%">
                            <tr>
                              <td style="color:#777777;font-size:14px;">Period</td>
                              <td style="color:#1a1a1a;font-size:14px;font-weight:600;text-align:right;">${escapeHtml(period)}</td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0;border-bottom:1px solid #bbf7d0;">
                          <table width="100%">
                            <tr>
                              <td style="color:#777777;font-size:14px;">Amount</td>
                              <td style="color:#16a34a;font-size:14px;font-weight:700;text-align:right;">&#8377;${escapeHtml(formattedAmount)}</td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0;border-bottom:1px solid #bbf7d0;">
                          <table width="100%">
                            <tr>
                              <td style="color:#777777;font-size:14px;">Paid On</td>
                              <td style="color:#1a1a1a;font-size:14px;font-weight:600;text-align:right;">${escapeHtml(paidDate)}</td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                      ${
                        notes
                          ? `<tr>
                        <td style="padding:8px 0;">
                          <table width="100%">
                            <tr>
                              <td style="color:#777777;font-size:14px;">Notes</td>
                              <td style="color:#1a1a1a;font-size:14px;text-align:right;">${escapeHtml(notes)}</td>
                            </tr>
                          </table>
                        </td>
                      </tr>`
                          : ""
                      }
                    </table>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 24px;color:#555555;font-size:14px;line-height:1.6;">
                You can view your complete earnings history on your Earnings page in the ArogyaDiet Delivery Partner app.
              </p>

              <hr style="border:none;border-top:1px solid #eeeeee;margin:0 0 20px;" />

              <p style="margin:0;color:#999999;font-size:13px;line-height:1.5;">
                Questions about this payment? Reply to this email or contact our operations team.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f9f9f9;padding:20px 40px;text-align:center;border-top:1px solid #eeeeee;">
              <p style="margin:0;color:#bbbbbb;font-size:12px;">&copy; ${new Date().getFullYear()} ArogyaDiet. All rights reserved.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function riderPaymentEmailSubject(): string {
  return "Payment Processed — ArogyaDiet";
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
