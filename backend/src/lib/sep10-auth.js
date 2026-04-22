import jwt from "jsonwebtoken";
import * as StellarSdk from "stellar-sdk";
import { randomBytes } from "node:crypto";

const NETWORK = (process.env.STELLAR_NETWORK || "testnet").toLowerCase();
const NETWORK_PASSPHRASE =
  NETWORK === "public"
    ? StellarSdk.Networks.PUBLIC
    : StellarSdk.Networks.TESTNET;

const CHALLENGE_EXPIRES_IN = 300; // 5 minutes
const JWT_SECRET = process.env.JWT_SECRET || "pluto-secret-key";

/**
 * Dynamically retrieve the server signing key from environment
 * This prevents module-level caching issues in tests
 * @returns {string|undefined} The server signing key
 */
function getServerSigningKey() {
  return process.env.SEP10_SERVER_SIGNING_KEY;
}

/**
 * Generate a SEP-0010 challenge transaction for a client account
 * @param {string} clientAccountId - Stellar public key of the client
 * @param {string} [homeDomain] - Optional home domain
 * @returns {string} Base64-encoded challenge transaction XDR
 */
export function generateChallenge(clientAccountId, homeDomain = "localhost") {
  const serverSigningKey = getServerSigningKey();

  if (!serverSigningKey) {
    throw new Error("SEP-0010 server signing key not configured");
  }

  const serverKeypair = StellarSdk.Keypair.fromSecret(serverSigningKey);
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
  const serverSigningKey = getServerSigningKey();

  if (!serverSigningKey) {
    return { valid: false, error: "SEP-0010 not configured" };
  }

  try {
    const serverKeypair = StellarSdk.Keypair.fromSecret(serverSigningKey);
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
 * @param {string} email - Merchant's email or Stellar address
 * @returns {string} JWT token
 */
export function generateSessionToken(merchantId, email) {
  return jwt.sign(
    {
      id: merchantId,
      email: email,
      merchant_id: merchantId, // Keep for legacy middleware support
    },
    JWT_SECRET,
    { expiresIn: "24h" },
  );
}

/**
 * Verify and decode a session token
 * @param {string} token - Session token
 * @returns {{ valid: boolean, payload?: object, error?: string }}
 */
export function verifySessionToken(token) {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    return { valid: true, payload };
  } catch (err) {
    return { valid: false, error: err.message || "Invalid token" };
  }
}

