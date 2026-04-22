import "dotenv/config";
import * as StellarSdk from "stellar-sdk";

const NETWORK = (process.env.STELLAR_NETWORK || "testnet").toLowerCase();
const HORIZON_URL = (
  process.env.STELLAR_HORIZON_URL ||
  (NETWORK === "public"
    ? "https://horizon.stellar.org"
    : "https://horizon-testnet.stellar.org")
).replace(/\/$/, "");

const server = new StellarSdk.Horizon.Server(HORIZON_URL);
const HORIZON_HEALTH_TIMEOUT_MS = 2_000;

function parseStroops(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function stroopsToXlm(stroops) {
  return (stroops / 10_000_000).toFixed(7);
}

/**
 * Validates Stellar memo format based on memo type
 * @param {string} memo - The memo value
 * @param {string} memoType - The memo type (text, id, hash, return)
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateMemo(memo, memoType) {
  if (!memo || !memoType) {
    return { valid: true };
  }

  const normalizedType = memoType.toLowerCase();

  switch (normalizedType) {
    case "text":
      // TEXT memos must be <= 28 bytes UTF-8
      if (Buffer.byteLength(memo, "utf8") > 28) {
        return {
          valid: false,
          error: "TEXT memo must be 28 bytes or less (UTF-8 encoded)",
        };
      }
      return { valid: true };

    case "id":
      // ID memos must be unsigned 64-bit integers (0 to 18446744073709551615)
      if (!/^\d+$/.test(memo)) {
        return {
          valid: false,
          error: "memo must be a valid unsigned 64-bit integer when memo_type is id",
        };
      }
      try {
        const value = BigInt(memo);
        if (value < 0n || value > 18446744073709551615n) {
          return {
            valid: false,
            error: "ID memo must be between 0 and 18446744073709551615",
          };
        }
      } catch {
        return {
          valid: false,
          error: "ID memo must be a valid unsigned 64-bit integer",
        };
      }
      return { valid: true };

    case "hash":
      // HASH memos must be exactly 32 bytes (64 hex characters)
      if (!/^[0-9a-fA-F]{64}$/.test(memo)) {
        return {
          valid: false,
          error: "memo must be a 32-byte hex string (64 characters) when memo_type is hash",
        };
      }
      return { valid: true };

    case "return":
      // RETURN memos can be either 32-byte hex or a valid unsigned 64-bit ID
      const isHex = /^[0-9a-fA-F]{64}$/.test(memo);
      let isValidId = false;

      if (/^\d+$/.test(memo)) {
        try {
          const val = BigInt(memo);
          isValidId = val >= 0n && val <= 18446744073709551615n;
        } catch {
          isValidId = false;
        }
      }

      if (!isHex && !isValidId) {
        return {
          valid: false,
          error: "memo must be a valid unsigned 64-bit integer or a 32-byte hex string (64 characters) when memo_type is return",
        };
      }
      return { valid: true };

    default:
      return {
        valid: false,
        error: `Invalid memo type: ${memoType}. Must be one of: text, id, hash, return`,
      };
  }
}

export async function isHorizonReachable() {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    HORIZON_HEALTH_TIMEOUT_MS,
  );

  try {
    const response = await fetch(HORIZON_URL, {
      method: "GET",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
      },
    });

    // Treat rate limiting as reachable so transient Horizon throttling
    // doesn't fail the entire API health check.
    return response.ok || response.status === 429;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
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

  // Exact match within 1 stroop (0.0000001 XLM)
  return Math.abs(expectedNum - receivedNum) <= 0.0000001;
}

/**
 * Classify how a received amount compares to the expected amount.
 * Returns: "exact" | "underpaid" | "overpaid"
 */
export function classifyAmount(expected, received) {
  const expectedNum = Number(expected);
  const receivedNum = Number(received);

  if (Number.isNaN(expectedNum) || Number.isNaN(receivedNum)) return "exact";

  const diff = receivedNum - expectedNum;
  if (Math.abs(diff) <= 0.0000001) return "exact";
  if (diff < 0) return "underpaid";
  return "overpaid";
}

function paymentMatchesAsset(payment, asset) {
  if (asset.isNative()) {
    return payment.asset_type === "native";
  }

  const expectedCode =
    typeof asset.getCode === "function" ? asset.getCode() : asset.code;
  const expectedIssuer =
    typeof asset.getIssuer === "function" ? asset.getIssuer() : asset.issuer;

  return (
    String(payment.asset_code || "").toUpperCase() ===
      String(expectedCode || "").toUpperCase() &&
    String(payment.asset_issuer || "") === String(expectedIssuer || "")
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
  const normalizedTxMemo = tx.memo == null ? "" : String(tx.memo);
  const normalizedExpectedMemo =
    expectedMemo == null ? "" : String(expectedMemo);

  if (txMemoType !== wantType) return false;
  return normalizedTxMemo === normalizedExpectedMemo;
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

/**
 * Query Horizon for strict-receive paths.
 * Returns the best path the sender can use to deliver `destAmount` of the
 * destination asset, sending from `sourceAsset`.
 *
 * @param {object} opts
 * @param {string} opts.sourceAccount   — Stellar public key of the sender
 * @param {string} opts.destAssetCode   — Asset code the merchant wants to receive
 * @param {string|null} opts.destAssetIssuer — Issuer (null for XLM)
 * @param {string} opts.destAmount      — Amount the merchant must receive
 * @param {string} opts.sourceAssetCode — Asset code the customer wants to send
 * @param {string|null} opts.sourceAssetIssuer — Issuer (null for XLM)
 * @returns {Promise<{source_amount: string, path: Array}>}
 */
export async function findStrictReceivePaths({
  sourceAccount,
  destAssetCode,
  destAssetIssuer,
  destAmount,
  sourceAssetCode,
  sourceAssetIssuer,
}) {
  const destAsset = resolveAsset(destAssetCode, destAssetIssuer);
  const sourceAsset = resolveAsset(sourceAssetCode, sourceAssetIssuer);

  try {
    const result = await server
      .strictReceivePaths([sourceAsset], destAsset, destAmount)
      .call();

    if (!result.records || result.records.length === 0) {
      return null;
    }

    // Return the best (first) path
    const best = result.records[0];
    return {
      source_amount: best.source_amount,
      source_asset_code:
        best.source_asset_type === "native" ? "XLM" : best.source_asset_code,
      source_asset_issuer: best.source_asset_issuer || null,
      destination_amount: best.destination_amount,
      path: best.path.map((p) => ({
        asset_code: p.asset_type === "native" ? "XLM" : p.asset_code,
        asset_issuer: p.asset_issuer || null,
      })),
    };
  } catch (err) {
    throw handleHorizonError(err, "strict-receive-paths");
  }
}

export async function findMatchingPayment({
  recipient,
  amount,
  assetCode,
  assetIssuer,
  memo,
  memoType,
  createdAt, // ISO string — only match transactions after this time
}) {
  const asset = resolveAsset(assetCode, assetIssuer);
  const createdAtMs = createdAt ? new Date(createdAt).getTime() - 60_000 : 0;

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
    const isDirectPayment = payment.type === "payment";
    const isPathPayment = payment.type === "path_payment_strict_receive";

    if (!isDirectPayment && !isPathPayment) {
      continue;
    }

    // Only consider transactions that occurred after the payment intent was created
    if (createdAtMs > 0 && payment.created_at) {
      const txMs = new Date(payment.created_at).getTime();
      if (txMs < createdAtMs) {
        continue;
      }
    }

    if (!paymentMatchesAsset(payment, asset)) {
      continue;
    }

    if (!amountsMatch(amount, payment.amount)) {
      continue;
    }

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
        continue;
      }
    }

    return {
      id: payment.id,
      transaction_hash: payment.transaction_hash,
      is_multisig: isMultiSig,
      received_amount: payment.amount,
    };
  }

  return null;
}

/**
 * Find any recent payment to the recipient regardless of amount.
 * Used to detect underpayments/overpayments.
 * Returns { transaction_hash, received_amount } or null.
 *
 * Note: we intentionally use a loose time window (no strict createdAt filter)
 * because Horizon ledger close times can have slight clock skew vs our DB.
 * The tx_id uniqueness constraint prevents false matches from older transactions.
 */
export async function findAnyRecentPayment({
  recipient,
  assetCode,
  assetIssuer,
  createdAt,
}) {
  const asset = resolveAsset(assetCode, assetIssuer);
  // Allow 60s of clock skew — reject anything more than 60s before intent creation
  const cutoffMs = createdAt ? new Date(createdAt).getTime() - 60_000 : 0;

  let page;
  try {
    page = await server.payments().forAccount(recipient).order("desc").limit(100).call();
  } catch {
    return null;
  }

  for (const payment of page.records) {
    if (payment.type !== "payment" && payment.type !== "path_payment_strict_receive") continue;
    if (payment.to !== recipient) continue;
    if (!paymentMatchesAsset(payment, asset)) continue;

    // Skip payments that are clearly older than the intent (with 60s slack)
    if (cutoffMs > 0 && payment.created_at) {
      if (new Date(payment.created_at).getTime() < cutoffMs) continue;
    }

    return {
      transaction_hash: payment.transaction_hash,
      received_amount: payment.amount,
    };
  }
  return null;
}

/*
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

export async function getNetworkFeeStats(operationCount = 1) {
  try {
    const safeOperationCount =
      Number.isInteger(operationCount) && operationCount > 0
        ? operationCount
        : 1;
    const feeStats = await server.feeStats();
    const lastLedgerBaseFee = parseStroops(feeStats.last_ledger_base_fee);
    const chargedMode = parseStroops(feeStats.fee_charged?.mode);
    const chargedP50 = parseStroops(feeStats.fee_charged?.p50);
    const recommendedFeeStroops = Math.max(
      lastLedgerBaseFee,
      chargedMode,
      chargedP50,
    );
    const totalFeeStroops = recommendedFeeStroops * safeOperationCount;

    return {
      network: NETWORK,
      horizonUrl: HORIZON_URL,
      operationCount: safeOperationCount,
      lastLedgerBaseFee,
      recommendedFeeStroops,
      totalFeeStroops,
      totalFeeXlm: stroopsToXlm(totalFeeStroops),
      feeCharged: feeStats.fee_charged ?? null,
      maxFee: feeStats.max_fee ?? null,
    };
  } catch (err) {
    throw handleHorizonError(err, "fee stats");
  }
}

export function getStellarConfig() {
  return {
    network: NETWORK,
    horizonUrl: HORIZON_URL,
  };
}
