# PLUTO — Agentic Payment Infrastructure on Stellar

> **Hackathon submission for: Agents on Stellar · x402 + Stripe MPP**

PLUTO is a Stripe-like payment gateway built on Stellar that lets merchants accept XLM and USDC payments — now extended with **x402 pay-per-request** so AI agents can autonomously pay for API access using USDC micropayments.

---

## What We Built

### Core: Merchant Payment Gateway
A full-stack payment infrastructure on Stellar testnet:
- Merchants register and get an API key
- Create payment links (`POST /api/create-payment`)
- Customers pay via a branded checkout page (`/pay/:id`)
- Payments confirmed automatically via Horizon polling
- Webhooks fire on confirmation
- Real-time dashboard with analytics

### New: x402 Agentic Payments
The x402 protocol turns any HTTP endpoint into a pay-per-request service. AI agents can autonomously pay for API access without subscriptions or API keys — just USDC on Stellar.

**Flow:**
```
Agent → GET /api/demo/protected
      ← 402 { amount: "0.10", asset: "USDC", recipient: "G...", memo: "x402-abc123" }
Agent → sends 0.10 USDC on Stellar with memo
Agent → POST /api/verify-x402 { tx_hash, amount, recipient, memo }
      ← { access_token: "eyJ..." }
Agent → GET /api/demo/protected + X-Payment-Token: eyJ...
      ← 200 { secret_data: "you paid for this" }
```

---

## Live Demo

### Run the agent demo
```bash
cd backend
node scripts/demoAgent.js
```

Watch an AI agent go through the full payment loop — 402 → pay → verify → 200 — entirely automatically on Stellar testnet.

### Frontend demo
Visit `http://localhost:3000/x402-demo` to see the agent payment flow visualized in real-time.

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Backend | Node.js + Express |
| Database | Supabase (Postgres) |
| Blockchain | Stellar SDK + Horizon API (testnet) |
| Frontend | Next.js 14 + Tailwind CSS |
| Real-time | Socket.io + SSE |
| Rate limiting | Redis |
| Agentic payments | x402 protocol (custom implementation) |

---

## x402 Implementation

### New endpoints
- `POST /api/verify-x402` — verifies a Stellar USDC payment and issues a short-lived JWT
- `GET /api/demo/protected` — example paywalled endpoint (0.10 USDC per request)
- `GET /api/demo/free` — free endpoint for comparison

### Middleware
`backend/src/middleware/x402.js` — drop-in Express middleware that protects any route:

```js
import { x402Middleware } from './middleware/x402.js';

app.get('/api/my-paid-endpoint',
  x402Middleware({ amount: '0.10', recipient: 'G...YOUR_ADDRESS' }),
  (req, res) => res.json({ data: 'you paid for this' })
);
```

### Replay attack prevention
Every verified `tx_hash` is stored in the `x402_payments` table. Reusing a transaction hash returns `409 Conflict`.

### Access tokens
Short-lived JWTs (60s expiry) signed with `X402_JWT_SECRET`. Agents include them as `X-Payment-Token` header on retries.

---

## Stellar Testnet Interaction

This project makes real Stellar testnet transactions:
- Payment creation stores recipient Stellar addresses
- Horizon polling confirms on-chain USDC/XLM payments
- x402 agent submits real USDC payments on testnet
- All transactions verifiable on [Stellar Expert (testnet)](https://stellar.expert/explorer/testnet)

USDC issuer (testnet): `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`

---

## Quick Start

### Prerequisites
- Node.js 18+
- Redis
- Supabase account
- Stellar testnet wallet (Freighter)

### Backend
```bash
cd backend
cp .env.example .env
# Fill in SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL
npm install
npm run migrate
npm run dev
```

### Frontend
```bash
cd frontend
cp .env.example .env.local
# Set NEXT_PUBLIC_API_URL=http://localhost:4000
npm install
npm run dev
```

### Run the x402 agent demo
```bash
cd backend
node scripts/demoAgent.js
```

---

## Environment Variables

```env
# Supabase
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
DATABASE_URL=

# Stellar
STELLAR_NETWORK=testnet
STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org
USDC_ISSUER=GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5

# x402
X402_JWT_SECRET=your_secret_here
X402_TOKEN_EXPIRY_SECONDS=60
X402_PROVIDER_PUBLIC_KEY=G...YOUR_PROVIDER_ADDRESS

# Redis
REDIS_URL=redis://localhost:6379
```

---

## What's Next

- **MPP (Stripe Machine Payments)** — payment channels for high-frequency agent interactions without per-tx fees
- **Agent marketplace** — merchants list paywalled APIs, agents discover and pay autonomously
- **Ethereum support** — same frontend, separate backend service for ERC-20 payments
- **Spending policies** — contract accounts with per-agent USDC limits

---

## Hackathon Notes

- All Stellar interactions use real testnet transactions (not mocked)
- The x402 implementation is custom-built on top of the existing PLUTO infrastructure
- The demo agent is fully autonomous — no human interaction required after `node scripts/demoAgent.js`
- Open source: full source code in this repository
