# Stellar Payment API

Accept Stellar payments (XLM or Stellar assets like USDC) using simple payment links and a developer-friendly API.

This project aims to feel like Stripe/PayPal, but built on Stellar. Merchants create a payment, share a link or QR code, and the API confirms the on-chain payment and notifies the merchant.

## What It Does

- Create payment intents with an amount, asset, and recipient
- Generate a payment link (ready for QR code usage)
- Verify payments on Stellar via Horizon
- Track status in Supabase (pending → confirmed)
- Send webhook notifications when payments are confirmed

## Tech Stack

- Backend: Node.js + Express
- Database: Supabase (Postgres)
- Stellar: `stellar-sdk` + Horizon API
- Frontend: Next.js + Tailwind (starter shell in `frontend/`)

## Quick Start (Backend)

1. Install dependencies:
```bash
cd backend
npm install
```

2. Configure environment:
```bash
cp .env.example .env
```

3. Fill out `backend/.env`:
```
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
DATABASE_URL=your_supabase_transaction_pooler_uri
REDIS_URL=redis://localhost:6379
STELLAR_NETWORK=testnet
# Optional overrides:
STELLAR_HORIZON_URL=
USDC_ISSUER=your_usdc_issuer
PAYMENT_LINK_BASE=http://localhost:3000
CREATE_PAYMENT_RATE_LIMIT_MAX=50
CREATE_PAYMENT_RATE_LIMIT_WINDOW_MS=60000
```

4. Apply schema in Supabase:
- Use `backend/sql/schema.sql` in Supabase SQL editor.

5. Run the API:
```bash
npm run dev
```

API will be available at `http://localhost:4000`.

Rate limiting uses Redis-backed shared state, so multiple API instances behind a load balancer enforce the same counters.

## API Endpoints

- `GET /health`
- `POST /api/create-payment`
- `POST /api/sessions`
- `GET /api/payment-status/:id`
- `POST /api/verify-payment/:id`
- `GET /api/merchant-branding`
- `PUT /api/merchant-branding`

### Create Payment

```json
{
  "amount": 50,
  "asset": "USDC",
  "asset_issuer": "G...ISSUER",
  "recipient": "G...RECIPIENT",
  "description": "Digital product",
  "webhook_url": "https://merchant.app/webhooks/stellar",
  "branding_overrides": {
    "primary_color": "#5ef2c0",
    "secondary_color": "#b8ffe2",
    "background_color": "#050608"
  }
}
```

`POST /api/create-payment` and `POST /api/sessions` are rate-limited per API key. By default the backend allows 50 requests per 60 seconds and returns `429 Too Many Requests` with a `Retry-After` header when the limit is exceeded.

Both endpoints return `branding_config` in the response. The config is resolved in this order:
1) per-session `branding_overrides`
2) merchant `branding_config`
3) system defaults

### Verify Payment

`POST /api/verify-payment/:id` checks Horizon for a matching payment and, if found, marks it as confirmed and fires a webhook.

Webhook payload:
```json
{
  "event": "payment.confirmed",
  "payment_id": "...",
  "amount": 50,
  "asset": "USDC",
  "asset_issuer": "G...ISSUER",
  "recipient": "G...RECIPIENT",
  "tx_id": "..."
}
```

## Current Roadmap (Short)

- Add merchant authentication (API keys/JWT)
- Improve webhook retries + delivery logs
- Add payment memo support for easier matching
- Build dashboard views for payments
- Add tests for API and Stellar verification

## Contributing

Issues are designed to be newcomer-friendly. See the roadmap above and grab any item labeled `good-first-issue`.
