# PLUTO — Agentic Payment Infrastructure on Stellar

PLUTO is a dual-mode payment infrastructure built on Stellar that bridges the gap between traditional Web3 e-commerce (human-driven checkouts via Freighter) and the emerging headless machine economy (AI agents interacting autonomously via the x402 Payment Required protocol).

As AI agents become more capable and autonomous, they need a native way to pay for API access, computational resources, and premium data without human intervention. PLUTO provides a robust framework that enables developers and merchants to seamlessly monetize API endpoints for AI agents natively on the Stellar blockchain.

## How it works (x402 Protocol)

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

## Hackathon Notes & Judging Criteria

### Real Stellar Testnet Interaction
- All Stellar interactions use **actual testnet transactions** (we do not mock blockchain actions).
- Payment creation stores dedicated Stellar recipient addresses per merchant.
- Our Horizon polling engine confirms on-chain USDC/XLM payments in real-time.
- The x402 agent script submits actual USDC micropayments on the testnet.
- All transactions are entirely verifiable on [Stellar Expert (testnet)](https://stellar.expert/explorer/testnet).

### Unfinished Features & Mock Data (Requirement 1 Disclosure)
While the core payment processing and x402 logic is 100% functional, the following areas contain placeholders or are unfinished due to hackathon time constraints:
1. **Analytics Dashboard:** The merchant volume chart on the frontend dashboard currently displays synthesized local data curves for visual demonstration; the real-time aggregation pipeline from Supabase is not fully implemented.
2. **Settings Persistence:** Some deep settings (like custom coloring options for the checkout UI) store temporarily in state but aren't fully wired to apply dynamic CSS globally.
3. **Machine Payment Protocol (MPP):** Our planned Stripe-like payment channels for high-frequency agent actions (to avoid per-txn standard fees) was architected but not finished in this version.
4. **Ethereum Support:** Our backend architecture allows for ERC-20 payment routing, but we have exclusively rolled out Stellar indexing for this MVP.

- **Open Source**: The full source code is public in this repository.
- **The dual video focus**: PLUTO bridges the visual e-commerce gap (1-page Freighter checkouts) seamlessly alongside headless Machine economies (x402 agent payments). Both run off the exact same resilient backend.
