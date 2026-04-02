I am building on top of an existing Pluto payment gateway project. 
Pluto is a Stripe-like API built on Stellar that lets merchants accept 
XLM and USDC payments via payment links and webhooks.

Current tech stack:
- Backend: Node.js + Express
- Database: Supabase (Postgres)
- Blockchain: stellar-sdk + Horizon API (testnet)
- Frontend: Next.js + Tailwind
- Rate limiting: Redis
- Network: Stellar testnet
- USDC issuer (testnet): GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5

Current API endpoints:
- GET  /health
- POST /api/create-payment
- POST /api/sessions
- GET  /api/payment-status/:id
- POST /api/verify-payment/:id
- GET  /api/merchant-branding
- PUT  /api/merchant-branding

I want to implement the x402 Payment Required protocol on top of 
this existing project. Here is exactly what needs to be built:

═══════════════════════════════════════
WHAT x402 IS
═══════════════════════════════════════
x402 is a protocol that lets API providers charge per request using 
crypto. When an AI agent or client hits a protected endpoint without 
payment, the server returns HTTP 402 Payment Required with payment 
details. The agent reads those details, sends USDC on Stellar, then 
retries the request with proof of payment. Pluto verifies the 
on-chain transaction and grants access.

Money flows directly from agent's Stellar wallet → API provider's 
Stellar wallet. Pluto never holds the funds — it only verifies the 
payment happened on Horizon.

═══════════════════════════════════════
WHAT TO BUILD — 3 PIECES
═══════════════════════════════════════

──────────────────────────────────────
PIECE 1: New Pluto endpoint — /api/verify-x402
──────────────────────────────────────
Add this new route to the existing Express backend.

POST /api/verify-x402

Request body:
{
  "tx_hash": "stellar transaction hash from the agent",
  "expected_amount": "0.10",
  "expected_recipient": "G...API_PROVIDER_STELLAR_ADDRESS",
  "memo": "unique payment memo / request identifier"
}

What it does:
1. Query Stellar Horizon testnet for the transaction by hash
2. Confirm the transaction sent the correct USDC amount
3. Confirm it went to the correct recipient address
4. Confirm the memo matches
5. Check this tx_hash has not been used before 
   (store used hashes in Supabase to prevent replay attacks)
6. If all checks pass → return a short-lived access token (JWT, 
   expires in 60 seconds, signed with an env secret)
7. If any check fails → return 400 with a clear error message

Store each verified x402 payment in a new Supabase table:
x402_payments (
  id uuid primary key,
  tx_hash text unique,
  amount numeric,
  recipient text,
  memo text,
  verified_at timestamptz,
  access_token_hash text
)

──────────────────────────────────────
PIECE 2: x402 Express middleware package
──────────────────────────────────────
Create this as a reusable middleware inside the backend at:
backend/src/middleware/x402.js

The middleware factory takes a config object:
{
  amount: "0.10",           // USDC amount required per request
  asset: "USDC",            
  recipient: "G...",        // API provider's Stellar address
  plutoVerifyUrl: "http://localhost:4000/api/verify-x402",
  memo_prefix: "x402"       // optional prefix for memo generation
}

Middleware behaviour:
1. Check incoming request for header: X-Payment-Token: <jwt>
2. If header exists → verify the JWT signature and expiry
   - Valid → call next() and grant access
   - Invalid/expired → fall through to step 3
3. If no valid token → return HTTP 402 with this exact shape:
{
  "x402": true,
  "error": "Payment required",
  "amount": "0.10",
  "asset": "USDC",
  "network": "stellar-testnet",
  "recipient": "G...PROVIDER_ADDRESS",
  "asset_issuer": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  "memo": "x402-<unique-request-id>",
  "verify_url": "http://localhost:4000/api/verify-x402",
  "instructions": "Send exact USDC amount to recipient with memo, then POST tx_hash to verify_url to receive access token, then retry this request with header X-Payment-Token: <token>"
}

──────────────────────────────────────
PIECE 3: Demo agent script
──────────────────────────────────────
Create this at: backend/scripts/demoAgent.js

This script simulates an AI agent that:
1. Hits a demo protected endpoint (create a simple demo route 
   GET /api/demo/protected that uses the x402 middleware, 
   returns { "secret_data": "you paid for this", "timestamp": now })
2. Receives the 402 response
3. Reads the payment details from the 402 body
4. Builds and submits a real USDC payment on Stellar testnet 
   using stellar-sdk — from a funded agent testnet wallet
5. Calls POST /api/verify-x402 with the tx_hash
6. Receives the access token
7. Retries the original request with X-Payment-Token header
8. Logs the final 200 response to the console

The agent needs its own Stellar testnet keypair. 
Generate a fresh one in the script using:
Keypair.random() — and fund it with Friendbot automatically.
Also add a USDC trustline for the agent account automatically 
before attempting to pay.

Log every step clearly so the output reads like a story:
[AGENT] Hitting endpoint: GET /api/demo/protected
[AGENT] Got 402 — payment required: 0.10 USDC
[AGENT] Sending payment to G...RECIPIENT on Stellar testnet...
[AGENT] Payment submitted. tx_hash: a3f9bc2e...
[AGENT] Verifying with Pluto...
[AGENT] Got access token. Retrying request...
[AGENT] SUCCESS — received data: { secret_data: "you paid for this" }

═══════════════════════════════════════
ENV VARIABLES TO ADD
═══════════════════════════════════════
Add these to backend/.env and backend/.env.example:

X402_JWT_SECRET=your_jwt_signing_secret_here
X402_TOKEN_EXPIRY_SECONDS=60
STELLAR_NETWORK=testnet
STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org
USDC_ISSUER=GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5

═══════════════════════════════════════
SUPABASE MIGRATION
═══════════════════════════════════════
Create a new migration file at:
backend/migrations/x402_payments.sql

With the x402_payments table defined above.
Follow whatever migration pattern already exists in this project.

═══════════════════════════════════════
CONSTRAINTS — DO NOT BREAK EXISTING CODE
═══════════════════════════════════════
- Do not modify any existing routes or middleware
- Do not change the existing Supabase payments table
- Do not change the existing verify-payment logic
- All new code goes in new files where possible
- Reuse the existing Horizon server instance and Supabase client
- Follow the existing code style and file structure exactly
- Add the new /api/verify-x402 route in the same pattern as 
  existing routes in the routes/ folder
- Add the demo protected route GET /api/demo/protected in a new 
  file: backend/src/routes/demo.js

═══════════════════════════════════════
DEFINITION OF DONE
═══════════════════════════════════════
I should be able to run:
  node backend/scripts/demoAgent.js

And see the agent go through the full payment loop — 
402 → pay → verify → retry → 200 — entirely automatically, 
logged step by step in the terminal.

Start by reading the existing codebase structure, then implement 
all three pieces. Ask me if anything about the existing code 
structure is unclear before writing new files.