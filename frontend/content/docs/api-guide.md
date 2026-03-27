# How to use the API

This guide mirrors the routes currently implemented in the backend of this repository.

## Base URL

During local development, the frontend defaults to:

```text
http://localhost:4000
```

## 1. Register a merchant

Create a merchant and receive both an API key and a webhook secret.

**Endpoint**

```http
POST /api/register-merchant
```

**Example**

```bash
curl -X POST http://localhost:4000/api/register-merchant \
  -H "Content-Type: application/json" \
  -d '{
    "email": "merchant@example.com",
    "business_name": "Example Store",
    "notification_email": "ops@example.com"
  }'
```

**Response fields to save**

- `merchant.api_key`
- `merchant.webhook_secret`
- `merchant.id`

## 2. Create a payment link

All merchant-protected endpoints use the `x-api-key` header.

**Endpoint**

```http
POST /api/create-payment
```

**Headers**

```text
x-api-key: sk_...
Content-Type: application/json
Idempotency-Key: 3f0d65e1-27b8-4b28-8f2f-8a6f9fd9d7d9
```

`Idempotency-Key` is optional, but recommended. The backend caches successful duplicate requests for 24 hours.

**Example**

```bash
curl -X POST http://localhost:4000/api/create-payment \
  -H "Content-Type: application/json" \
  -H "x-api-key: sk_your_api_key" \
  -H "Idempotency-Key: 3f0d65e1-27b8-4b28-8f2f-8a6f9fd9d7d9" \
  -d '{
    "amount": 25,
    "asset": "XLM",
    "recipient": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
    "description": "Order #2048",
    "webhook_url": "https://merchant.example/webhooks/stellar"
  }'
```

**Typical success response**

```json
{
  "payment_id": "6aa64d44-faf1-41f0-a7e7-c8f9cce62f2f",
  "payment_link": "http://localhost:3000/pay/6aa64d44-faf1-41f0-a7e7-c8f9cce62f2f",
  "status": "pending",
  "branding_config": {
    "primary_color": "#5ef2c0",
    "secondary_color": "#b8ffe2",
    "background_color": "#050608"
  }
}
```

## 3. Check payment status

Use the public status endpoint to read the latest payment state.

**Endpoint**

```http
GET /api/payment-status/:id
```

**Example**

```bash
curl http://localhost:4000/api/payment-status/6aa64d44-faf1-41f0-a7e7-c8f9cce62f2f
```

## 4. Verify the payment on Stellar

After the customer submits payment, verify it against the Stellar network.

**Endpoint**

```http
POST /api/verify-payment/:id
```

If the payment is found, the API marks it as `confirmed`, stores the `tx_id`, emits the merchant socket event, and sends the webhook.

**Example**

```bash
curl -X POST http://localhost:4000/api/verify-payment/6aa64d44-faf1-41f0-a7e7-c8f9cce62f2f
```

## 5. List merchant payments

Read recent payments for the authenticated merchant.

**Endpoint**

```http
GET /api/payments?page=1&limit=10
```

**Headers**

```text
x-api-key: sk_...
```

## 6. Test webhook delivery

If you already stored a webhook URL for the merchant, you can send a signed test event using:

```http
POST /api/webhooks/test
```

If you want to ping an arbitrary URL directly, the repo also exposes:

```http
POST /api/test-webhook
```

with:

```json
{
  "webhook_url": "https://merchant.example/webhooks/stellar"
}
```

## Notes

- Merchant auth in this codebase uses `x-api-key`, not `Authorization: Bearer ...`.
- The create-payment flow supports optional `webhook_url`, `memo`, `memo_type`, and `branding_overrides`.
- Webhook events are signed with the merchant webhook secret using `HMAC-SHA256`.

Continue with the HMAC guide in `/docs/hmac-signatures` to verify those webhook requests correctly.
