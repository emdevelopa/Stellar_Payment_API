/**
 * Payment Operations - Payment matching and transaction processing
 * 
 * This module handles payment-related operations:
 * - Finding matching payments
 * - Payment validation
 * - Amount classification
 */

import * as StellarSdk from "stellar-sdk";
import { resolveAsset, amountsMatch, classifyAmount } from "./validators.js";
import { logger } from "../logger.js";
import { 
  paymentMatchingOperations,
  paymentMatchingErrors 
} from "../metrics.js";

/**
 * Check if a payment record matches the expected asset
 */
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
 * Check if transaction memo matches expected values
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
 */
async function isMultiSigAccount(horizonClient, accountId) {
  try {
    const account = await horizonClient.loadAccount(accountId);
    const thresholds = account.thresholds;
    const signers = account.signers;

    // Multi-sig if: multiple signers OR threshold > 1
    return signers.length > 1 || thresholds.med_threshold > 1;
  } catch (err) {
    logger.warn(
      { accountId, error: err.message },
      "Could not load account for multi-sig check"
    );
    return false;
  }
}

/**
 * Find a payment matching specific criteria
 */
export async function findMatchingPayment(horizonClient, {
  recipient,
  amount,
  assetCode,
  assetIssuer,
  memo,
  memoType,
  createdAt,
}) {
  const startTime = Date.now();
  const asset = resolveAsset(assetCode, assetIssuer);
  const createdAtMs = createdAt ? new Date(createdAt).getTime() - 60_000 : 0;

  try {
    const page = await horizonClient.fetchPayments(recipient, {
      order: "desc",
      limit: 200,
    });

    // Check if recipient is multi-sig for enhanced verification
    const isMultiSig = await isMultiSigAccount(horizonClient, recipient);

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
          const tx = await horizonClient.fetchTransaction(payment.transaction_hash);

          if (!memoMatches(tx, memo, memoType)) {
            continue;
          }
        } catch (_txErr) {
          continue;
        }
      }

      paymentMatchingOperations.inc({ result: "found" });

      return {
        id: payment.id,
        transaction_hash: payment.transaction_hash,
        is_multisig: isMultiSig,
        received_amount: payment.amount,
      };
    }

    paymentMatchingOperations.inc({ result: "not_found" });
    return null;
  } catch (err) {
    paymentMatchingErrors.inc({ 
      error_type: err.status || "unknown" 
    });
    throw err;
  }
}

/**
 * Find any recent payment to the recipient regardless of amount
 * Used to detect underpayments/overpayments
 */
export async function findAnyRecentPayment(horizonClient, {
  recipient,
  assetCode,
  assetIssuer,
  createdAt,
}) {
  const asset = resolveAsset(assetCode, assetIssuer);
  // Allow 60s of clock skew — reject anything more than 60s before intent creation
  const cutoffMs = createdAt ? new Date(createdAt).getTime() - 60_000 : 0;

  try {
    const page = await horizonClient.fetchPayments(recipient, {
      order: "desc",
      limit: 100,
    });

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
  } catch {
    return null;
  }
}

/**
 * Create a refund transaction
 */
export async function createRefundTransaction(horizonClient, {
  sourceAccount,
  destination,
  amount,
  assetCode,
  assetIssuer,
  memo,
  networkPassphrase,
}) {
  try {
    const account = await horizonClient.loadAccount(sourceAccount);
    const asset = resolveAsset(assetCode, assetIssuer);

    const txBuilder = new StellarSdk.TransactionBuilder(account, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase,
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
    throw err; // Let Horizon client handle error wrapping
  }
}