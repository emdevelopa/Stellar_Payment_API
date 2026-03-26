import "dotenv/config";
import * as StellarSdk from "stellar-sdk";

const NETWORK = (process.env.STELLAR_NETWORK || "testnet").toLowerCase();
const HORIZON_URL =
  process.env.STELLAR_HORIZON_URL ||
  (NETWORK === "public"
    ? "https://horizon.stellar.org"
    : "https://horizon-testnet.stellar.org");

const server = new StellarSdk.Horizon.Server(HORIZON_URL);

export async function isHorizonReachable() {
  try {
    await server.ledgers().order("desc").limit(1).call();
    return true;
  } catch {
    return false;
  }
}

export function resolveAsset(assetCode, assetIssuer) {
  if (!assetCode) {
    throw new Error("Asset code is required");
  }

  if (assetCode.toUpperCase() === "XLM") {
    return StellarSdk.Asset.native();
  }

  if (!assetIssuer) {
    throw new Error("Asset issuer is required for non-native assets");
  }

  return new StellarSdk.Asset(assetCode.toUpperCase(), assetIssuer);
}

function amountsMatch(expected, received) {
  const expectedNum = Number(expected);
  const receivedNum = Number(received);

  if (Number.isNaN(expectedNum) || Number.isNaN(receivedNum)) {
    return false;
  }

  return Math.abs(expectedNum - receivedNum) <= 0.0000001;
}

function paymentMatchesAsset(payment, asset) {
  if (asset.isNative()) {
    return payment.asset_type === "native";
  }

  return (
    payment.asset_code === asset.code && payment.asset_issuer === asset.issuer
  );
}

/**
 * Wraps Horizon SDK errors into descriptive, consumer-friendly Error objects.
 */
function handleHorizonError(err, context = "") {
  const status = err?.response?.status;

  if (status === 429) {
    const error = new Error(
      "Horizon rate limit exceeded. Please retry after a short wait.",
    );
    error.status = 429;
    return error;
  }

  if (status === 404) {
    const error = new Error(
      `Stellar account not found${context ? `: ${context}` : ""}`,
    );
    error.status = 404;
    return error;
  }

  if (status && status >= 400 && status < 500) {
    const detail = err?.response?.data?.detail || err.message;
    const error = new Error(`Horizon request error (${status}): ${detail}`);
    error.status = status;
    return error;
  }

  if (status && status >= 500) {
    const error = new Error(
      `Horizon server error (${status}). The Stellar network may be experiencing issues.`,
    );
    error.status = 502;
    return error;
  }

  // Network / connection errors (ECONNREFUSED, timeout, etc.)
  const error = new Error(
    `Unable to connect to Horizon (${HORIZON_URL}): ${err.message}`,
  );
  error.status = 502;
  return error;
}

/**
 * Returns true when the on-chain transaction memo matches the expected values.
 * If no memo is expected the check is skipped (backward-compatible).
 */
function memoMatches(tx, expectedMemo, expectedMemoType) {
  const txMemoType = (tx.memo_type || "none").toLowerCase();
  const wantType = (expectedMemoType || "text").toLowerCase();

  if (txMemoType !== wantType) return false;
  return String(tx.memo) === String(expectedMemo);
}

/**
 * Check if an account is a multi-sig account
 * Issue #149: Support for Multi-sig Receiving Addresses
 */
async function isMultiSigAccount(accountId) {
  try {
    const account = await server.loadAccount(accountId);
    const thresholds = account.thresholds;
    const signers = account.signers;

    // Multi-sig if: multiple signers OR threshold > 1
    return signers.length > 1 || thresholds.med_threshold > 1;
  } catch (err) {
    console.warn(`Could not load account ${accountId}:`, err.message);
    return false;
  }
}

export async function findMatchingPayment({
  recipient,
  amount,
  assetCode,
  assetIssuer,
  memo,
  memoType,
}) {
  const asset = resolveAsset(assetCode, assetIssuer);

  let page;
  try {
    page = await server
      .payments()
      .forAccount(recipient)
      .order("desc")
      .limit(200)
      .call();
  } catch (err) {
    throw handleHorizonError(err, recipient);
  }

  // Check if recipient is multi-sig for enhanced verification
  const isMultiSig = await isMultiSigAccount(recipient);

  for (const payment of page.records) {
    if (payment.type !== "payment") {
      continue;
    }

    if (!paymentMatchesAsset(payment, asset)) {
      continue;
    }

    if (!amountsMatch(amount, payment.amount)) {
      continue;
    }

    // Verify payment destination matches recipient (important for multi-sig)
    if (payment.to !== recipient) {
      continue;
    }

    // If a memo is expected, fetch the parent transaction and compare
    if (memo != null && memo !== "") {
      try {
        const tx = await server
          .transactions()
          .transaction(payment.transaction_hash)
          .call();

        if (!memoMatches(tx, memo, memoType)) {
          continue;
        }
      } catch (_txErr) {
        // Cannot verify memo — skip this candidate
        continue;
      }
    }

    return {
      id: payment.id,
      transaction_hash: payment.transaction_hash,
      is_multisig: isMultiSig,
    };
  }

  return null;
}

/**
 * Create a refund transaction XDR for a merchant to sign
 * Issue #150: Implement a Refund API Transaction Helper
 */
export async function createRefundTransaction({
  sourceAccount,
  destination,
  amount,
  assetCode,
  assetIssuer,
  memo,
}) {
  try {
    const account = await server.loadAccount(sourceAccount);
    const asset = resolveAsset(assetCode, assetIssuer);

    const txBuilder = new StellarSdk.TransactionBuilder(account, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase:
        NETWORK === "public"
          ? StellarSdk.Networks.PUBLIC
          : StellarSdk.Networks.TESTNET,
    });

    txBuilder.addOperation(
      StellarSdk.Operation.payment({
        destination,
        asset,
        amount: amount.toString(),
      }),
    );

    if (memo) {
      txBuilder.addMemo(StellarSdk.Memo.text(memo));
    }

    txBuilder.setTimeout(300); // 5 minutes

    const transaction = txBuilder.build();

    return {
      xdr: transaction.toXDR(),
      hash: transaction.hash().toString("hex"),
    };
  } catch (err) {
    throw handleHorizonError(err, sourceAccount);
  }
}

export function getStellarConfig() {
  return {
    network: NETWORK,
    horizonUrl: HORIZON_URL,
  };
}
