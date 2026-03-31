import { Resend } from "resend";


const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * Renders a basic HTML email receipt for a confirmed payment.
 */

function renderReceiptHtml({ businessName, amount, asset, recipient, txId, paymentId }) {
  return `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Payment Receipt</title>
    <style>
      body { font-family: Arial, sans-serif; background: #f4f4f4; padding: 20px; }
      .container { background: #ffffff; padding: 32px; border-radius: 8px; max-width: 560px; margin: auto; }
      .header { font-size: 20px; font-weight: bold; margin-bottom: 24px; color: #1a1a1a; }
      .row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #eeeeee; }
      .label { color: #666666; font-size: 14px; }
      .value { color: #1a1a1a; font-size: 14px; font-weight: bold; }
      .footer { margin-top: 24px; font-size: 12px; color: #999999; }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">✅ Payment Confirmed</div>
      <p>Hi ${businessName}, a customer payment has been confirmed on the Stellar network.</p>
      <div class="row">
        <span class="label">Amount</span>
        <span class="value">${amount} ${asset}</span>
      </div>
      <div class="row">
        <span class="label">Recipient</span>
        <span class="value">${recipient}</span>
      </div>
      <div class="row">
        <span class="label">Payment ID</span>
        <span class="value">${paymentId}</span>
      </div>
      <div class="row">
        <span class="label">Transaction ID</span>
        <span class="value">${txId}</span>
      </div>
      <div class="footer">
        This is an automated receipt from Stellar Payment API.
      </div>
    </div>
  </body>
</html>
  `.trim();
}

/**
 * Sends a payment confirmation receipt email to the merchant.
 * Dispatched asynchronously — never blocks the client response.
 */
export function sendReceiptEmail({ to, businessName, amount, asset, recipient, txId, paymentId }) {
  if (!process.env.RESEND_API_KEY) {
    console.warn("RESEND_API_KEY not set — skipping receipt email.");
    return;
  }

  if (!to) {
    console.warn("No notification_email set for merchant — skipping receipt email.");
    return;
  }

  // Fire and forget — does not block response
  resend.emails.send({
    from: "Stellar Payment API <receipts@yourdomain.com>",
    to,
    subject: `Payment Confirmed: ${amount} ${asset}`,
    html: renderReceiptHtml({ businessName, amount, asset, recipient, txId, paymentId }),
  }).catch((err) => {
    console.error("Failed to send receipt email:", err.message);
  });
}

/** @type {Resend | null} */
let resendClient = null;

function getClient() {
  if (!resendClient) {
    resendClient = new Resend(process.env.RESEND_API_KEY);
  }
  return resendClient;
}

const FROM_ADDRESS =
  process.env.RECEIPT_FROM_EMAIL || "receipts@notifications.dripsnetwork.com";

/**
 * Sends a receipt email via Resend.
 *
 * @param {{ to: string, subject: string, html: string }} options
 * @returns {Promise<{ ok: boolean, error?: unknown }>}
 */
export async function sendCustomReceiptEmail({ to, subject, html }) {
  try {
    const client = getClient();
    const { error } = await client.emails.send({
      from: FROM_ADDRESS,
      to,
      subject,
      html,
    });

    if (error) {
      return { ok: false, error };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err };
  }
}

