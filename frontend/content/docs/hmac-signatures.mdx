# How to verify HMAC signatures

Webhook signing in this repository lives in `backend/src/lib/webhooks.js`.

## Header format

When a webhook secret is available, the backend sends:

```text
PLUTO-Signature: sha256=<hex_digest>
```

The digest is generated from the exact JSON string body using HMAC-SHA256.

## Signing logic used by the backend

The backend currently signs payloads with logic equivalent to:

```js
import {createHmac} from "crypto";

const rawBody = JSON.stringify(payload);
const digest = createHmac("sha256", webhookSecret)
  .update(rawBody)
  .digest("hex");

const header = `sha256=${digest}`;
```

## Important verification rule

Verify the signature against the **raw request body**, not a re-serialized object created later in your handler.

If your framework parses JSON first and you rebuild it with a different key order or whitespace, the signature check can fail.

## Node.js example

```js
import crypto from "node:crypto";
import express from "express";

const app = express();

app.post(
  "/webhooks/pluto",
  express.raw({type: "application/json"}),
  (req, res) => {
    const secret = process.env.STELLAR_WEBHOOK_SECRET;
    const rawBody = req.body.toString("utf8");
    const incoming = req.get("PLUTO-Signature") || "";

    const expected = `sha256=${crypto
      .createHmac("sha256", secret)
      .update(rawBody)
      .digest("hex")}`;

    const valid =
      incoming.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(incoming), Buffer.from(expected));

    if (!valid) {
      return res.status(401).json({error: "Invalid webhook signature"});
    }

    const payload = JSON.parse(rawBody);

    if (payload.event === "payment.confirmed") {
      console.log("Confirmed payment:", payload.payment_id, payload.tx_id);
    }

    res.status(204).end();
  }
);
```

## Example payload fields

The backend sends a `payment.confirmed` payload with fields like:

```json
{
  "event": "payment.confirmed",
  "payment_id": "6aa64d44-faf1-41f0-a7e7-c8f9cce62f2f",
  "amount": 25,
  "asset": "XLM",
  "asset_issuer": null,
  "recipient": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
  "tx_id": "stellar_tx_hash"
}
```

The test webhook route sends a similar payload with:

- `event: "payment.confirmed"`
- `test: true`

## Retry behavior

If delivery fails, the backend schedules retries after:

- 10 seconds
- 30 seconds
- 60 seconds

Your webhook handler should therefore be:

- idempotent
- fast to acknowledge
- tolerant of duplicate deliveries

## Checklist

- Save the `webhook_secret` returned during merchant registration.
- Read the raw request body before JSON parsing changes it.
- Compute `HMAC-SHA256` over that exact raw body.
- Compare against the `PLUTO-Signature` header.
- Reject invalid signatures with `401`.
- Treat webhook events as retryable and idempotent.
