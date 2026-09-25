/**
 * Stellar Horizon Client - Main Facade
 * 
 * This module provides the main interface for Stellar Horizon operations,
 * refactored into modular components for better maintainability and testability.
 * 
 * Architecture:
 * - HorizonClient: Handles all Horizon API communication with retry logic
 * - Validators: Input validation and asset management
 * - PaymentOperations: Payment matching and transaction processing
 * - SignatureVerification: Cryptographic signature validation
 * 
 * This facade maintains backward compatibility with the existing API while
 * providing a cleaner, more modular architecture.
 */

import "dotenv/config";
import * as StellarSdk from "stellar-sdk";
import { logger } from "./logger.js";
import { HorizonClient } from "./stellar/horizon-client.js";
import * as validators from "./stellar/validators.js";
import * as paymentOperations from "./stellar/payment-operations.js";
import * as signatureVerification from "./stellar/signature-verification.js";
import {
  exchangeRateQuoteRequests,
  exchangeRateQuoteDuration,
  exchangeRateHorizonCalls,
  exchangeRateSourceAccountValidation,
  horizonCacheEntries,
  horizonCacheHitsTotal,
  horizonCacheMissesTotal,
  signatureVerificationTotal,
  signatureVerificationDuration,
  signatureVerificationReplayAttempts,
} from "./metrics.js";

// Configuration
const NETWORK = (process.env.STELLAR_NETWORK || "testnet").toLowerCase();
const HORIZON_URL = (
  process.env.STELLAR_HORIZON_URL ||
  (NETWORK === "public"
    ? "https://horizon.stellar.org"
    : "https://horizon-testnet.stellar.org")
).replace(/\/$/, "");

const NETWORK_PASSPHRASE =
  NETWORK === "public"
    ? StellarSdk.Networks.PUBLIC
    : StellarSdk.Networks.TESTNET;

// Create singleton Horizon client instance
const horizonClient = new HorizonClient(HORIZON_URL, NETWORK_PASSPHRASE);

// Utility functions
function parseStroops(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function stroopsToXlm(stroops) {
  return (stroops / 10_000_000).toFixed(7);
}

// Export validators
export const isValidStellarAccountId = validators.isValidStellarAccountId;
export const isValidStellarPublicKey = validators.isValidStellarPublicKey;
export const isValidAssetCode = validators.isValidAssetCode;
export const validateMemo = validators.validateMemo;
export const resolveAsset = validators.resolveAsset;
export const isValidTransactionHash = validators.isValidTransactionHash;
export const classifyAmount = validators.classifyAmount;

// Export payment operations
export const findMatchingPayment = (params) => 
  paymentOperations.findMatchingPayment(horizonClient, params);

export const findAnyRecentPayment = (params) => 
  paymentOperations.findAnyRecentPayment(horizonClient, params);

export const createRefundTransaction = (params) => 
  paymentOperations.createRefundTransaction(horizonClient, {
    ...params,
    networkPassphrase: NETWORK_PASSPHRASE
  });

// Export signature verification
export const verifyTransactionSignature = (txHash, options) =>
  signatureVerification.verifyTransactionSignature(
    horizonClient,
    txHash,
    NETWORK_PASSPHRASE,
    options
  );

// Export Horizon client operations
export async function isHorizonReachable() {
  return horizonClient.isReachable();
}

export async function getNetworkFeeStats(operationCount = 1) {
  try {
    const safeOperationCount =
      Number.isInteger(operationCount) && operationCount > 0
        ? operationCount
        : 1;
    const feeStats = await horizonClient.getFeeStats();
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
    // Let Horizon client handle error wrapping
    throw err;
  }
}

/**
 * Query Horizon for strict-receive paths
 * Returns the best path the sender can use to deliver `destAmount` of the
 * destination asset, sending from `sourceAsset`.
 */
export async function findStrictReceivePaths({
  sourceAccount,
  destAssetCode,
  destAssetIssuer,
  destAmount,
  sourceAssetCode,
  sourceAssetIssuer,
}) {
  const startTime = Date.now();
  const destAsset = validators.resolveAsset(destAssetCode, destAssetIssuer);
  const sourceAsset = validators.resolveAsset(sourceAssetCode, sourceAssetIssuer);
  const assetLabels = {
    source_asset: sourceAssetCode || "native",
    dest_asset: destAssetCode || "native",
  };

  try {
    if (sourceAccount) {
      try {
        await horizonClient.loadAccount(sourceAccount);
        exchangeRateSourceAccountValidation.inc({ result: "valid" });
      } catch (accountErr) {
        exchangeRateSourceAccountValidation.inc({ result: "not_found" });
        throw accountErr;
      }
    } else {
      exchangeRateSourceAccountValidation.inc({ result: "skipped" });
    }

    const result = await horizonClient.findStrictReceivePaths(
      [sourceAsset],
      destAsset,
      destAmount
    );
    
    exchangeRateHorizonCalls.inc({ 
      operation: "strict_receive_paths", 
      status: "success" 
    });

    if (!result.records || result.records.length === 0) {
      exchangeRateQuoteRequests.inc({ ...assetLabels, result: "not_found" });
      exchangeRateQuoteDuration.observe(
        { ...assetLabels, result: "not_found" },
        (Date.now() - startTime) / 1000
      );
      return null;
    }

    // Return the best (first) path
    const best = result.records[0];
    const sourceAmount = Number(best.source_amount);
    if (!Number.isFinite(sourceAmount) || sourceAmount <= 0) {
      const error = new Error("Horizon returned an invalid path payment quote");
      error.status = 502;
      throw error;
    }

    exchangeRateQuoteRequests.inc({ ...assetLabels, result: "success" });
    exchangeRateQuoteDuration.observe(
      { ...assetLabels, result: "success" },
      (Date.now() - startTime) / 1000
    );

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
    exchangeRateQuoteRequests.inc({ ...assetLabels, result: "error" });
    exchangeRateQuoteDuration.observe(
      { ...assetLabels, result: "error" },
      (Date.now() - startTime) / 1000
    );

    exchangeRateHorizonCalls.inc({ 
      operation: "strict_receive_paths", 
      status: "error" 
    });

    if (!err?.status) {
      // Let Horizon client handle error wrapping
      throw err;
    }

    throw err;
  }
}

export async function getStellarConfig() {
  return {
    network: NETWORK,
    horizonUrl: HORIZON_URL,
    ...horizonClient.getConfig(),
  };
}

// Export the horizon client for advanced use cases
export { horizonClient, HorizonClient };
