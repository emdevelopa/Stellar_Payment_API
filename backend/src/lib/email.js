import { Resend } from "resend";

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
