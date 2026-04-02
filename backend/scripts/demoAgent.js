/**
 * PLUTO x402 Demo Agent
 *
 * A fully autonomous AI agent that pays for API access using
 * USDC micropayments on Stellar testnet via the x402 protocol.
 *
 * Run: node backend/scripts/demoAgent.js
 *
 * The agent is completely self-contained:
 *  1. Generates a fresh Stellar keypair (no Freighter needed)
 *  2. Funds itself with XLM via Friendbot
 *  3. Adds a USDC trustline
 *  4. Gets USDC from the testnet USDC issuer
 *  5. Hits a protected endpoint → receives 402
 *  6. Reads payment details from the 402 response
 *  7. Sends exact USDC to the provider on Stellar testnet
 *  8. Calls /api/verify-x402 → receives JWT access token
 *  9. Retries the original request with X-Payment-Token header
 * 10. Logs the final 200 response
 */

import 'dotenv/config';
import * as StellarSdk from 'stellar-sdk';

const HORIZON_URL = process.env.STELLAR_HORIZON_URL || 'https://horizon-testnet.stellar.org';
const USDC_ISSUER = process.env.USDC_ISSUER || 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const API_BASE = `http://localhost:${process.env.PORT || 4000}`;
const PROTECTED_ENDPOINT = `${API_BASE}/api/demo/protected`;
const VERIFY_URL = `${API_BASE}/api/verify-x402`;

const server = new StellarSdk.Horizon.Server(HORIZON_URL);
const network = StellarSdk.Networks.TESTNET;

// ── Logging helpers ───────────────────────────────────────────────────────────

const C = { reset: '\x1b[0m', cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', magenta: '\x1b[35m', bold: '\x1b[1m', dim: '\x1b[2m' };

function log(step, msg) {
  console.log(`${C.cyan}[AGENT]${C.reset} ${C.yellow}[${step}]${C.reset} ${msg}`);
}
function ok(msg) { console.log(`${C.green}[AGENT] ✓${C.reset} ${msg}`); }
function info(msg) { console.log(`${C.dim}[AGENT]   ${msg}${C.reset}`); }
function die(msg, err) {
  console.error(`${C.red}[AGENT] ✗ ${msg}${C.reset}`);
  if (err) console.error(`${C.red}         ${err.message || JSON.stringify(err)}${C.reset}`);
  process.exit(1);
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Step 1: Generate & fund agent wallet ──────────────────────────────────────

async function setupAgent() {
  log('SETUP', 'Generating fresh agent keypair...');
  const kp = StellarSdk.Keypair.random();
  info(`Public key : ${C.magenta}${kp.publicKey()}${C.reset}`);
  info(`(Secret key is ephemeral — only lives in memory for this run)`);

  log('SETUP', 'Funding with Friendbot (testnet XLM)...');
  const fb = await fetch(`https://friendbot.stellar.org?addr=${kp.publicKey()}`);
  if (!fb.ok) die('Friendbot failed', new Error(await fb.text()));
  ok('Funded with 10,000 XLM');

  await sleep(2000);

  // Add USDC trustline
  log('SETUP', 'Adding USDC trustline...');
  const acc = await server.loadAccount(kp.publicKey());
  const usdc = new StellarSdk.Asset('USDC', USDC_ISSUER);

  const trustTx = new StellarSdk.TransactionBuilder(acc, { fee: StellarSdk.BASE_FEE, networkPassphrase: network })
    .addOperation(StellarSdk.Operation.changeTrust({ asset: usdc }))
    .setTimeout(30)
    .build();
  trustTx.sign(kp);
  await server.submitTransaction(trustTx);
  ok('USDC trustline added');

  // Get USDC — try DEX path payment first, fall back to issuer
  log('SETUP', 'Acquiring USDC (XLM → USDC via testnet DEX)...');
  const acc2 = await server.loadAccount(kp.publicKey());

  try {
    const swapTx = new StellarSdk.TransactionBuilder(acc2, { fee: '10000', networkPassphrase: network })
      .addOperation(StellarSdk.Operation.pathPaymentStrictReceive({
        sendAsset: StellarSdk.Asset.native(),
        sendMax: '200',
        destination: kp.publicKey(),
        destAsset: usdc,
        destAmount: '1.00',
        path: [],
      }))
      .setTimeout(30)
      .build();
    swapTx.sign(kp);
    await server.submitTransaction(swapTx);
    ok('Acquired 1.00 USDC via DEX');
  } catch {
    // DEX may not have liquidity — try getting USDC from the issuer account
    // On testnet the USDC issuer sometimes allows direct payments
    log('SETUP', 'DEX unavailable, requesting USDC from testnet faucet...');
    try {
      const faucet = await fetch(`https://friendbot-testnet.stellar.org/usdc?addr=${kp.publicKey()}`);
      if (faucet.ok) {
        ok('Got USDC from testnet faucet');
      } else {
        throw new Error('Faucet unavailable');
      }
    } catch {
      // Last resort: use the USDC issuer keypair if provided
      if (process.env.USDC_ISSUER_SECRET) {
        const issuerKp = StellarSdk.Keypair.fromSecret(process.env.USDC_ISSUER_SECRET);
        const issuerAcc = await server.loadAccount(issuerKp.publicKey());
        const mintTx = new StellarSdk.TransactionBuilder(issuerAcc, { fee: StellarSdk.BASE_FEE, networkPassphrase: network })
          .addOperation(StellarSdk.Operation.payment({ destination: kp.publicKey(), asset: usdc, amount: '1.00' }))
          .setTimeout(30)
          .build();
        mintTx.sign(issuerKp);
        await server.submitTransaction(mintTx);
        ok('Got 1.00 USDC from issuer');
      } else {
        console.log(`\n${C.yellow}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.reset}`);
        console.log(`${C.yellow}Could not auto-acquire USDC. Please manually send 0.50 USDC to:${C.reset}`);
        console.log(`${C.magenta}${kp.publicKey()}${C.reset}`);
        console.log(`${C.yellow}Use: https://laboratory.stellar.org or your Freighter wallet${C.reset}`);
        console.log(`${C.yellow}Then re-run this script with:${C.reset}`);
        console.log(`${C.bold}AGENT_SECRET=${kp.secret()} node backend/scripts/demoAgent.js${C.reset}`);
        console.log(`${C.yellow}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.reset}\n`);
        process.exit(0);
      }
    }
  }

  await sleep(1000);
  return kp;
}

// ── Step 2: Hit protected endpoint → get 402 ─────────────────────────────────

async function hitEndpoint() {
  log('1/4', `Hitting endpoint: GET ${PROTECTED_ENDPOINT}`);
  const res = await fetch(PROTECTED_ENDPOINT);
  const body = await res.json();

  if (res.status === 402) {
    ok(`Got 402 — payment required: ${C.yellow}${body.amount} ${body.asset}${C.reset}`);
    info(`Recipient : ${C.magenta}${body.recipient}${C.reset}`);
    info(`Memo      : ${C.yellow}${body.memo}${C.reset}`);
    info(`Verify at : ${body.verify_url}`);
    return body;
  }

  die(`Unexpected status ${res.status}`, new Error(JSON.stringify(body)));
}

// ── Step 3: Send USDC payment ─────────────────────────────────────────────────

async function sendPayment(kp, details) {
  const { amount, recipient, memo, asset_issuer } = details;
  log('2/4', `Sending ${C.yellow}${amount} USDC${C.reset} → ${C.magenta}${recipient.slice(0,8)}...${recipient.slice(-6)}${C.reset}`);
  info(`Memo: ${C.yellow}${memo}${C.reset}`);

  const acc = await server.loadAccount(kp.publicKey());
  const usdc = new StellarSdk.Asset('USDC', asset_issuer || USDC_ISSUER);

  const tx = new StellarSdk.TransactionBuilder(acc, { fee: StellarSdk.BASE_FEE, networkPassphrase: network })
    .addOperation(StellarSdk.Operation.payment({ destination: recipient, asset: usdc, amount }))
    .addMemo(StellarSdk.Memo.text(memo))
    .setTimeout(30)
    .build();

  tx.sign(kp);
  const result = await server.submitTransaction(tx);
  ok(`Payment submitted → tx_hash: ${C.magenta}${result.hash}${C.reset}`);
  info(`View on explorer: https://stellar.expert/explorer/testnet/tx/${result.hash}`);
  return result.hash;
}

// ── Step 4: Verify with PLUTO ─────────────────────────────────────────────────

async function verifyPayment(txHash, details) {
  log('3/4', 'Verifying payment with PLUTO...');
  info('Waiting 4s for Horizon to index the transaction...');
  await sleep(4000);

  const res = await fetch(VERIFY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tx_hash: txHash,
      expected_amount: details.amount,
      expected_recipient: details.recipient,
      memo: details.memo,
    }),
  });

  const body = await res.json();
  if (!res.ok) die(`Verification failed: ${body.error}`, new Error(JSON.stringify(body)));

  ok(`Access token received (expires in ${body.expires_in}s)`);
  return body.access_token;
}

// ── Step 5: Retry with token ──────────────────────────────────────────────────

async function retryWithToken(token) {
  log('4/4', 'Retrying request with X-Payment-Token header...');
  const res = await fetch(PROTECTED_ENDPOINT, { headers: { 'X-Payment-Token': token } });
  const body = await res.json();
  if (res.status !== 200) die(`Request failed ${res.status}`, new Error(JSON.stringify(body)));
  return body;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${C.bold}╔══════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}║   PLUTO x402 Agent Demo · Stellar Testnet    ║${C.reset}`);
  console.log(`${C.bold}╚══════════════════════════════════════════════╝${C.reset}\n`);

  // Check server
  try {
    const h = await fetch(`${API_BASE}/health`);
    if (!h.ok) throw new Error();
    ok(`PLUTO server running at ${API_BASE}`);
  } catch {
    die(`Cannot reach PLUTO at ${API_BASE} — is the backend running?`);
  }

  if (!process.env.X402_PROVIDER_PUBLIC_KEY) die('X402_PROVIDER_PUBLIC_KEY not set in .env');
  if (!process.env.X402_JWT_SECRET) die('X402_JWT_SECRET not set in .env');

  info(`Provider : ${C.magenta}${process.env.X402_PROVIDER_PUBLIC_KEY}${C.reset}`);
  console.log();

  // Use existing agent secret if provided (for re-runs after manual USDC funding)
  let agentKp;
  if (process.env.AGENT_SECRET) {
    agentKp = StellarSdk.Keypair.fromSecret(process.env.AGENT_SECRET);
    ok(`Using existing agent wallet: ${C.magenta}${agentKp.publicKey()}${C.reset}`);
  } else {
    agentKp = await setupAgent();
  }

  console.log();
  const paymentDetails = await hitEndpoint();
  console.log();
  const txHash = await sendPayment(agentKp, paymentDetails);
  console.log();
  const accessToken = await verifyPayment(txHash, paymentDetails);
  console.log();
  const data = await retryWithToken(accessToken);

  console.log(`\n${C.green}${C.bold}╔══════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.green}${C.bold}║          AGENT MISSION COMPLETE ✓            ║${C.reset}`);
  console.log(`${C.green}${C.bold}╚══════════════════════════════════════════════╝${C.reset}\n`);

  ok('Protected data received:');
  console.log(JSON.stringify(data, null, 2));

  console.log(`\n${C.bold}Flow summary:${C.reset}`);
  console.log(`  ${C.yellow}402 Payment Required${C.reset} → ${C.yellow}USDC sent on Stellar${C.reset} → ${C.yellow}Verified by PLUTO${C.reset} → ${C.green}Access granted${C.reset}\n`);
}

main().catch(err => { console.error(`${C.red}[AGENT] Fatal:${C.reset}`, err.message); process.exit(1); });
