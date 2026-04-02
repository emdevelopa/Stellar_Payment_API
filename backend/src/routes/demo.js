/**
 * Demo routes showing x402 pay-per-request in action.
 *
 * GET /api/demo/protected  — requires 0.10 USDC payment per request
 * GET /api/demo/free       — no payment required (for comparison)
 */

import express from "express";
import { x402Middleware } from "../middleware/x402.js";
import * as StellarSdk from "stellar-sdk";

const router = express.Router();

const X402_PROVIDER = process.env.X402_PROVIDER_PUBLIC_KEY;
const HORIZON_URL = process.env.STELLAR_HORIZON_URL || "https://horizon-testnet.stellar.org";
const USDC_ISSUER = process.env.USDC_ISSUER || "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const network = StellarSdk.Networks.TESTNET;
const server = new StellarSdk.Horizon.Server(HORIZON_URL);

// Only mount the protected route if the provider key is configured
if (X402_PROVIDER) {
  router.get(
    "/demo/protected",
    x402Middleware({
      amount: "0.10",
      recipient: X402_PROVIDER,
      plutoVerifyUrl: `${process.env.PAYMENT_LINK_BASE?.replace(":3000", ":4000") || "http://localhost:4000"}/api/verify-x402`,
    }),
    (req, res) => {
      res.json({
        secret_data: "you paid for this",
        timestamp: new Date().toISOString(),
        payment: req.x402
          ? {
              tx_hash: req.x402.tx_hash,
              amount: req.x402.amount,
              memo: req.x402.memo,
            }
          : null,
        message: "Welcome! This data was unlocked by a 0.10 USDC micropayment on Stellar.",
      });
    }
  );
}

router.get("/demo/free", (req, res) => {
  res.json({
    message: "This endpoint is free. No payment required.",
    timestamp: new Date().toISOString(),
  });
});

/**
 * POST /api/demo/agent-pay
 * Used by the browser demo page — spins up an ephemeral agent wallet,
 * funds it, and submits the USDC payment on behalf of the browser.
 */
router.post("/demo/agent-pay", async (req, res, next) => {
  try {
    const { amount, recipient, memo, asset_issuer } = req.body;
    if (!amount || !recipient || !memo) {
      return res.status(400).json({ error: "Missing amount, recipient, or memo" });
    }

    // Generate ephemeral agent keypair
    const agentKp = StellarSdk.Keypair.random();

    // Fund via Friendbot
    const fb = await fetch(`https://friendbot.stellar.org?addr=${agentKp.publicKey()}`);
    if (!fb.ok) return res.status(503).json({ error: "Friendbot unavailable — try the terminal demo instead" });

    await new Promise(r => setTimeout(r, 2000));

    // Add USDC trustline
    const acc = await server.loadAccount(agentKp.publicKey());
    const usdc = new StellarSdk.Asset("USDC", asset_issuer || USDC_ISSUER);

    const trustTx = new StellarSdk.TransactionBuilder(acc, { fee: StellarSdk.BASE_FEE, networkPassphrase: network })
      .addOperation(StellarSdk.Operation.changeTrust({ asset: usdc }))
      .setTimeout(30)
      .build();
    trustTx.sign(agentKp);
    await server.submitTransaction(trustTx);

    // Get USDC via DEX
    const acc2 = await server.loadAccount(agentKp.publicKey());
    try {
      const swapTx = new StellarSdk.TransactionBuilder(acc2, { fee: "10000", networkPassphrase: network })
        .addOperation(StellarSdk.Operation.pathPaymentStrictReceive({
          sendAsset: StellarSdk.Asset.native(),
          sendMax: "200",
          destination: agentKp.publicKey(),
          destAsset: usdc,
          destAmount: "1.00",
          path: [],
        }))
        .setTimeout(30)
        .build();
      swapTx.sign(agentKp);
      await server.submitTransaction(swapTx);
    } catch {
      return res.status(503).json({ error: "Could not acquire USDC via DEX. Use the terminal demo: node scripts/demoAgent.js" });
    }

    // Send payment
    const acc3 = await server.loadAccount(agentKp.publicKey());
    const payTx = new StellarSdk.TransactionBuilder(acc3, { fee: StellarSdk.BASE_FEE, networkPassphrase: network })
      .addOperation(StellarSdk.Operation.payment({ destination: recipient, asset: usdc, amount }))
      .addMemo(StellarSdk.Memo.text(memo))
      .setTimeout(30)
      .build();
    payTx.sign(agentKp);
    const result = await server.submitTransaction(payTx);

    res.json({ tx_hash: result.hash, agent_public_key: agentKp.publicKey() });
  } catch (err) {
    next(err);
  }
});

export default router;
