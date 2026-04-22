/**
 * Renders a plain HTML payment receipt email.
 *
 * @param {{ payment: object, merchant: object }} options
 * @returns {string} HTML string
 */
export function renderReceiptEmail({ payment, merchant }) {
  const merchantName = merchant?.name || merchant?.business_name || "Merchant";
  const logoUrl = merchant?.branding_config?.logo_url;
  const amount = payment?.amount ?? "—";
  const asset = payment?.asset ?? "—";
  const recipient = payment?.recipient ?? "—";
  const txId = payment?.tx_id ?? "—";
  const timestamp = payment?.created_at
    ? new Date(payment.created_at).toUTCString()
    : new Date().toUTCString();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Payment Receipt</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:Arial,sans-serif;color:#111827;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0"
               style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:#0f172a;padding:28px 32px;text-align:center;">
              ${
                logoUrl
                  ? `<img src="${logoUrl}" alt="${merchantName}" style="height:48px;width:auto;margin-bottom:16px;display:block;margin-left:auto;margin-right:auto;" />`
                  : ""
              }
              <p style="margin:0;font-size:18px;font-weight:700;color:#f8fafc;letter-spacing:0.5px;">
                ${merchantName}
              </p>
              <p style="margin:4px 0 0;font-size:13px;color:#94a3b8;">Payment Receipt</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 24px;font-size:14px;color:#6b7280;">
                Your payment has been confirmed on the Stellar network.
              </p>

              <table width="100%" cellpadding="0" cellspacing="0"
                     style="border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;font-size:14px;">
                <tr style="background:#f9fafb;">
                  <td style="padding:12px 16px;font-weight:600;color:#374151;width:40%;">Amount</td>
                  <td style="padding:12px 16px;color:#111827;">${amount} ${asset}</td>
                </tr>
                <tr>
                  <td style="padding:12px 16px;font-weight:600;color:#374151;border-top:1px solid #e5e7eb;">Recipient</td>
                  <td style="padding:12px 16px;color:#111827;word-break:break-all;border-top:1px solid #e5e7eb;">${recipient}</td>
                </tr>
                <tr style="background:#f9fafb;">
                  <td style="padding:12px 16px;font-weight:600;color:#374151;border-top:1px solid #e5e7eb;">Transaction ID</td>
                  <td style="padding:12px 16px;color:#111827;word-break:break-all;border-top:1px solid #e5e7eb;">${txId}</td>
                </tr>
                <tr>
                  <td style="padding:12px 16px;font-weight:600;color:#374151;border-top:1px solid #e5e7eb;">Timestamp</td>
                  <td style="padding:12px 16px;color:#111827;border-top:1px solid #e5e7eb;">${timestamp}</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:16px 32px;border-top:1px solid #e5e7eb;background:#f9fafb;">
              <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center;">
                This is an automated receipt. Please do not reply to this email.
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
