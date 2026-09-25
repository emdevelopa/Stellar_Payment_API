import { signPayload } from "../backend/src/lib/webhooks.js";

const secret = "whsec_test_secret_123";
const payload = { event: "payment.confirmed", id: "123" };
const rawBody = JSON.stringify(payload);

const signature = signPayload(rawBody, secret);
console.log("Payload:", rawBody);
console.log("Secret:", secret);
console.log("Signature:", signature);

// Manual check: should match HMAC-SHA256
import { createHmac } from "crypto";
const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
console.log("Expected: ", expected);

if (signature === expected) {
  console.log("✅ Signature matches!");
} else {
  console.log("❌ Signature mismatch!");
  process.exit(1);
}
