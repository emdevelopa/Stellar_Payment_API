/**
 * SEP-0010 Stellar Web Authentication
 * Issue #148: Support wallet-based authentication for merchants
 */

import * as StellarSdk from "stellar-sdk";
import { randomBytes } from "node:crypto";

const NETWORK = (process.env.STELLAR_NETWORK || "testnet").toLowerCase();
const NETWORK_PASSPHRASE =
  NETWORK === "public"
    ? StellarSdk.Networks.PUBLIC
    : StellarSdk.Networks.TESTNET;

const SERVER_SIGNING_KEY = process.env.SEP10_SERVER_SIGNING_KEY;
const CHALLENGE_EXPIRES_IN = 300; // 5 minutes

if (!SERVER_SIGNING_KEY) {
  console.warn("⚠️  SEP10_SERVER_SIGNING_KEY not set — SEP-0010 auth disabled");
}

/**
 * Generate a SEP-0010 challenge transaction for a client account
 * @param {string} clientAccountId - Stellar public key of the client
 * @param {string} [homeDomain] - Optional home domain
 * @returns {string} Base64-encoded challenge transaction XDR
 */
export function generateChallenge(clientAccountId, homeDomain = "localhost") {
  if (!SERVER_SIGNING_KEY) {
    throw new Error("SEP-0010 server signing key not configured");
  }

  const serverKeypair = StellarSdk.Keypair.fromSecret(SERVER_SIGNING_KEY);
  const nonce = randomBytes(32).toString("base64");

  const now = Math.floor(Date.now() / 1000);
  const minTime = now.toString();
  const maxTime = (now + CHALLENGE_EXPIRES_IN).toString();

  const account = new StellarSdk.Account(serverKeypair.publicKey(), "-1");

  const transaction = new StellarSdk.TransactionBuilder(account, {
    fee: "100",
    networkPassphrase: NETWORK_PASSPHRASE,
    timebounds: {
      minTime,
      maxTime,
    },
  })
    .addOperation(
      StellarSdk.Operation.manageData({
        name: `${homeDomain} auth`,
        value: nonce,
        source: clientAccountId,
      }),
    )
    .build();

  transaction.sign(serverKeypair);

  return transaction.toXDR();
}

/**
 * Verify a signed SEP-0010 challenge transaction
 * @param {string} challengeXdr - Base64-encoded signed transaction XDR
 * @param {string} clientAccountId - Expected client account ID
 * @returns {{ valid: boolean, error?: string }}
 */
export function verifyChallenge(challengeXdr, clientAccountId) {
  if (!SERVER_SIGNING_KEY) {
    return { valid: false, error: "SEP-0010 not configured" };
  }

  try {
    const serverKeypair = StellarSdk.Keypair.fromSecret(SERVER_SIGNING_KEY);
    const transaction = new StellarSdk.TransactionBuilder.fromXDR(
      challengeXdr,
      NETWORK_PASSPHRASE,
    );

    // Verify transaction structure
    if (transaction.operations.length !== 1) {
      return { valid: false, error: "Invalid challenge structure" };
    }

    const operation = transaction.operations[0];
    if (operation.type !== "manageData") {
      return { valid: false, error: "Invalid operation type" };
    }

    if (operation.source !== clientAccountId) {
      return { valid: false, error: "Client account mismatch" };
    }

    // Verify timebounds
    const now = Math.floor(Date.now() / 1000);
    const { minTime, maxTime } = transaction.timeBounds;

    if (now < parseInt(minTime, 10) || now > parseInt(maxTime, 10)) {
      return { valid: false, error: "Challenge expired" };
    }

    // Verify signatures
    const serverSigned = transaction.signatures.some((sig) => {
      try {
        return serverKeypair.verify(transaction.hash(), sig.signature());
      } catch {
        return false;
      }
    });

    if (!serverSigned) {
      return { valid: false, error: "Server signature missing" };
    }

    const clientKeypair = StellarSdk.Keypair.fromPublicKey(clientAccountId);
    const clientSigned = transaction.signatures.some((sig) => {
      try {
        return clientKeypair.verify(transaction.hash(), sig.signature());
      } catch {
        return false;
      }
    });

    if (!clientSigned) {
      return { valid: false, error: "Client signature missing or invalid" };
    }

    return { valid: true };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

/**
 * Generate a JWT session token for authenticated merchant
 * @param {string} merchantId - Merchant UUID
 * @param {string} stellarAddress - Merchant's Stellar public key
 * @returns {string} JWT token
 */
export function generateSessionToken(merchantId, stellarAddress) {
  // Simple JWT-like token (in production, use proper JWT library)
  const payload = {
    merchant_id: merchantId,
    stellar_address: stellarAddress,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 86400, // 24 hours
  };

  const token = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return token;
}

/**
 * Verify and decode a session token
 * @param {string} token - Session token
 * @returns {{ valid: boolean, payload?: object, error?: string }}
 */
export function verifySessionToken(token) {
  try {
    const payload = JSON.parse(
      Buffer.from(token, "base64url").toString("utf-8"),
    );

    const now = Math.floor(Date.now() / 1000);
    if (now > payload.exp) {
      return { valid: false, error: "Token expired" };
    }

    return { valid: true, payload };
  } catch (err) {
    return { valid: false, error: "Invalid token" };
  }
}
