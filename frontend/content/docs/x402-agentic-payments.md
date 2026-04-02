# x402 Agentic Payments

PLUTO extends the standard merchant payment flow with **x402** — a pay-per-request protocol that lets AI agents and developer tools autonomously pay for API access using USDC micropayments on Stellar.

No subscriptions. No API keys. Just crypto.

---

## What is x402?

x402 is an HTTP-native payment protocol. When a client hits a protected endpoint without payment, the server returns **HTTP 402 Payment Required** with full payment instructions. The client pays on-chain, gets a short-lived access token, and retries the request.

```
Client → GET /api/demo/protected
       ← 402 { amount, recipient, memo, verify_url }
Client → sends USDC on Stellar with memo
Client → POST /api/verify-x402 { tx_hash }
       ← { access_token: "eyJ..." }
Client → GET /api/demo/protected + X-Payment-Token: eyJ...
       ← 200 { data }
```

Money flows **directly** from the agent's Stellar wallet to the API provider's wallet. PLUTO never holds funds — it only verifies the payment happened on Horizon.

---

## Live Demo

### Browser demo

Visit [/x402-demo](/x402-demo) to watch the full payment flow visualized step by step in your browser.

### Terminal demo (fully autonomous)

The terminal demo runs a completely self-contained agent — it generates its own Stellar wallet, funds it via Friendbot, acquires USDC, and completes the entire x402 flow without any human interaction.

```bash
cd backend
node scripts/demoAgent.js
```

**Expected output:**

```
╔══════════════════════════════════════════════╗
║   PLUTO x402 Agent Demo · Stellar Testnet    ║
╚══════════════════════════════════════════════╝

[AGENT] ✓ PLUTO server running at http://localhost:4000
[AGENT] [SETUP] Generating fresh agent keypair...
[AGENT]   Public key : GABC1234...
[AGENT] [SETUP] Funding with Friendbot (testnet XLM)...
[AGENT] ✓ Funded with 10,000 XLM
[AGENT] [SETUP] Adding USDC trustline...
[AGENT] ✓ USDC trustline added
[AGENT] [SETUP] Acquiring USDC (XLM → USDC via testnet DEX)...
[AGENT] ✓ Acquired 1.00 USDC via DEX

[AGENT] [1/4] Hitting endpoint: GET /api/demo/protected
[AGENT] ✓ Got 402 — payment required: 0.10 USDC
[AGENT]   Recipient : GDTVZ...
[AGENT]   Memo      : x402-a1b2c3d4e5f6g7h8

[AGENT] [2/4] Sending 0.10 USDC → GDTVZ...
[AGENT] ✓ Payment submitted → tx_hash: 02ad45864ff0...
[AGENT]   View on explorer: https://stellar.expert/explorer/testnet/tx/...

[AGENT] [3/4] Verifying payment with PLUTO...
[AGENT] ✓ Access token received (expires in 60s)

[AGENT] [4/4] Retrying request with X-Payment-Token header...

╔══════════════════════════════════════════════╗
║          AGENT MISSION COMPLETE ✓            ║
╚══════════════════════════════════════════════╝

[AGENT] ✓ Protected data received:
{
  "secret_data": "you paid for this",
  "timestamp": "2026-04-01T12:00:00.000Z",
  "message": "Welcome! This data was unlocked by a 0.10 USDC micropayment on Stellar."
}
```

---

## API Reference

### `POST /api/verify-x402`

Verifies a Stellar USDC payment and issues a short-lived JWT access token.

**Request body:**

```json
{
  "tx_hash": "02ad45864ff019eee15e01b2f8a3b8a03d0c521f644112099349d455a4c641f7",
  "expected_amount": "0.10",
  "expected_recipient": "GDTVZPCLO7YHRF3JQV6TQI6XW3DIIMFWWQWI25WWLOUZM5AOCZTE5RA3",
  "memo": "x402-a1b2c3d4e5f6g7h8"
}
```

**Success response (200):**

```json
{
  "verified": true,
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expires_in": 60,
  "tx_hash": "02ad45864ff0...",
  "amount": "0.10",
  "asset": "USDC"
}
```

**Error responses:**

| Status | Reason |
|--------|--------|
| `400` | Missing fields, memo mismatch, amount mismatch, or tx not found |
| `409` | Transaction already used (replay attack prevention) |
| `500` | x402 not configured on server |

---

### `GET /api/demo/protected`

A demo endpoint protected by x402. Costs **0.10 USDC** per request.

**Without payment token → 402:**

```json
{
  "x402": true,
  "error": "Payment required",
  "amount": "0.10",
  "asset": "USDC",
  "network": "stellar-testnet",
  "recipient": "GDTVZPCLO7YHRF3JQV6TQI6XW3DIIMFWWQWI25WWLOUZM5AOCZTE5RA3",
  "asset_issuer": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  "memo": "x402-a1b2c3d4e5f6g7h8",
  "verify_url": "http://localhost:4000/api/verify-x402",
  "instructions": "Send exact USDC amount to recipient with memo, then POST tx_hash to verify_url..."
}
```

**With valid `X-Payment-Token` header → 200:**

```json
{
  "secret_data": "you paid for this",
  "timestamp": "2026-04-01T12:00:00.000Z",
  "payment": {
    "tx_hash": "02ad45864ff0...",
    "amount": "0.10",
    "memo": "x402-a1b2c3d4e5f6g7h8"
  }
}
```

---

### `GET /api/demo/free`

A free endpoint for comparison — no payment required.

```json
{
  "message": "This endpoint is free. No payment required.",
  "timestamp": "2026-04-01T12:00:00.000Z"
}
```

---

## Protecting Your Own Endpoints

Use the `x402Middleware` to add pay-per-request to any Express route:

```js
import { x402Middleware } from './middleware/x402.js';

// Charge 0.05 USDC per analytics query
app.get('/api/metrics/7day',
  x402Middleware({
    amount: '0.05',
    recipient: 'G...YOUR_STELLAR_ADDRESS',
  }),
  (req, res) => {
    res.json({ volume: 12345 });
  }
);
```

**Middleware config options:**

| Option | Required | Default | Description |
|--------|----------|---------|-------------|
| `amount` | ✓ | — | USDC amount per request (e.g. `"0.10"`) |
| `recipient` | ✓ | — | Your Stellar address that receives payments |
| `asset` | — | `"USDC"` | Asset code |
| `plutoVerifyUrl` | — | `http://localhost:4000/api/verify-x402` | Verification endpoint URL |
| `memo_prefix` | — | `"x402"` | Prefix for generated memos |

---

## Security

### Replay attack prevention

Every verified `tx_hash` is stored in the `x402_payments` table. Attempting to reuse a transaction hash returns `409 Conflict`. This prevents an agent from paying once and reusing the token indefinitely.

### Short-lived tokens

Access tokens expire in **60 seconds** (configurable via `X402_TOKEN_EXPIRY_SECONDS`). After expiry, the agent must pay again.

### Memo matching

Each 402 response includes a unique memo (`x402-<16-char-random-id>`). The verification step confirms the on-chain transaction used exactly that memo, preventing one payment from unlocking a different request.

---

## Environment Variables

Add these to `backend/.env`:

```bash
# x402 configuration
X402_JWT_SECRET=your_strong_random_secret_here
X402_TOKEN_EXPIRY_SECONDS=60
X402_PROVIDER_PUBLIC_KEY=G...YOUR_STELLAR_ADDRESS
```

Generate a strong secret:
```bash
openssl rand -hex 32
```

---

## How It Differs from Regular Payments

| | Regular PLUTO Payment | x402 Payment |
|---|---|---|
| **Who pays** | End customer (human) | Developer / AI agent (software) |
| **UI** | Checkout page with QR code | Programmatic — no UI |
| **Amount** | Any amount | Fixed per-request fee |
| **Purpose** | Buy goods/services | Unlock API access |
| **Token** | None | Short-lived JWT |
| **Frequency** | One-off | Per API call |

---

## Testnet Resources

- **USDC Issuer (testnet):** `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`
- **Fund with XLM:** [Stellar Friendbot](https://friendbot.stellar.org)
- **Explorer:** [Stellar Expert (testnet)](https://stellar.expert/explorer/testnet)
- **Stellar Lab:** [laboratory.stellar.org](https://laboratory.stellar.org)
