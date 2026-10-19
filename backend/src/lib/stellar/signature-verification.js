/**
 * Signature Verification - Transaction signature validation
 * 
 * This module handles cryptographic signature verification for Stellar transactions:
 * - Transaction envelope parsing
 * - Signature validation
 * - Multi-sig support
 * - Fee-bump transaction handling
 */

import * as StellarSdk from "stellar-sdk";
import { logger } from "../logger.js";
import {
  signatureVerificationOperations,
  signatureVerificationLatency,
  signatureVerificationReplayDetected,
} from "../metrics.js";

/**
 * Perform full cryptographic signature verification for a Stellar transaction
 * 
 * Verification steps:
 *  1. Fetch the transaction envelope from Horizon
 *  2. Deserialise the XDR envelope and confirm at least one signature is present
 *  3. Load the source account to obtain its current signer list and thresholds
 *  4. For each signature in the envelope, derive the signer's public key via
 *     Ed25519 key-recovery and check it against the account's authorised signers
 *  5. Accumulate signing weight and verify it meets the account's medium threshold
 *     (used for payment operations)
 * 
 * @param {object} horizonClient - Horizon client instance
 * @param {string} txHash - The transaction hash to verify
 * @param {string} networkPassphrase - Network passphrase for XDR parsing
 * @param {object} options - Optional configuration
 * @returns {Promise<SignatureVerificationResult>}
 */
export async function verifyTransactionSignature(
  horizonClient,
  txHash,
  networkPassphrase,
  options = {}
) {
  // Clamp caller-supplied retry options to prevent resource exhaustion from
  // untrusted or misconfigured callers (VULN-15).
  const maxRetries = Math.min(Math.max(0, Number(options.maxRetries ?? 3)), 5);
  const retryDelay = Math.min(Math.max(0, Number(options.retryDelay ?? 1000)), 5000);
  const startTime = Date.now();
  
  if (!txHash || typeof txHash !== "string") {
    logger.error(
      { txHash, type: typeof txHash },
      "verifyTransactionSignature: Invalid input"
    );
    signatureVerificationOperations.inc({ result: "error" });
    signatureVerificationLatency.observe(
      { result: "error" },
      (Date.now() - startTime) / 1000
    );
    return {
      valid: false,
      reason: "Invalid transaction hash provided",
      isMultiSig: false,
      signatureCount: 0,
      thresholdMet: false,
    };
  }

  // Step 1: Fetch transaction envelope from Horizon with retry logic
  const txResult = await fetchTransactionWithRetry(
    horizonClient,
    txHash,
    maxRetries,
    retryDelay,
    startTime
  );
  
  if (!txResult.success) {
    return txResult.result;
  }

  const tx = txResult.transaction;

  // Step 2: Deserialise XDR envelope (supports fee-bump transactions)
  const parseResult = parseTransactionEnvelope(tx, txHash, networkPassphrase, startTime);
  if (!parseResult.success) {
    return parseResult.result;
  }

  const { transaction, isFeeBump } = parseResult;

  // NPE-02: transaction.source can be null/undefined if the SDK returns a
  // partially populated object.  A null sourceAccountId would cause
  // horizonClient.loadAccount(null) to produce an unrecoverable error.
  if (!transaction.source || typeof transaction.source !== "string") {
    logger.error(
      { txHash, isFeeBump },
      "verifyTransactionSignature: transaction.source is null or not a string",
    );
    signatureVerificationOperations.inc({ result: "error" });
    signatureVerificationLatency.observe(
      { result: "error" },
      (Date.now() - startTime) / 1000,
    );
    return {
      valid: false,
      reason: "Transaction is missing a source account",
      isMultiSig: false,
      signatureCount: 0,
      thresholdMet: false,
    };
  }

  // Step 3: Load source account signers & thresholds
  const accountResult = await loadSourceAccount(
    horizonClient,
    transaction.source,
    txHash,
    startTime
  );
  
  if (!accountResult.success) {
    return accountResult.result;
  }

  const { signers, medThreshold, isMultiSig } = accountResult;

  // Step 4: Verify each signature cryptographically
  const verificationResult = verifySignatures(
    transaction,
    signers,
    medThreshold,
    txHash,
    startTime
  );

  // Step 5: Return final result
  signatureVerificationOperations.inc({ result: verificationResult.valid ? "valid" : "invalid" });
  signatureVerificationLatency.observe(
    { result: verificationResult.valid ? "valid" : "invalid" },
    (Date.now() - startTime) / 1000
  );

  return {
    valid: verificationResult.valid,
    reason: verificationResult.reason,
    isMultiSig,
    signatureCount: transaction.signatures.length,
    thresholdMet: verificationResult.thresholdMet,
    isFeeBump,
  };
}

/**
 * Fetch transaction from Horizon with retry logic
 */
async function fetchTransactionWithRetry(
  horizonClient,
  txHash,
  maxRetries,
  retryDelay,
  startTime
) {
  let retryCount = 0;
  
  while (retryCount <= maxRetries) {
    try {
      const tx = await horizonClient.fetchTransaction(txHash);

      // NPE-01: Horizon can return a null/undefined response or a response
      // object that is missing `envelope_xdr`.  Guard here so downstream code
      // never dereferences a null `tx` or a null `tx.envelope_xdr`.
      if (tx == null) {
        logger.error(
          { txHash, retryCount },
          "verifyTransactionSignature: Horizon returned null transaction",
        );
        signatureVerificationOperations.inc({ result: "error" });
        signatureVerificationLatency.observe(
          { result: "error" },
          (Date.now() - startTime) / 1000,
        );
        return {
          success: false,
          result: {
            valid: false,
            reason: "Horizon returned an empty transaction response",
            isMultiSig: false,
            signatureCount: 0,
            thresholdMet: false,
          },
        };
      }

      if (typeof tx.envelope_xdr !== "string" || tx.envelope_xdr.trim() === "") {
        logger.error(
          { txHash, retryCount, txKeys: Object.keys(tx) },
          "verifyTransactionSignature: Horizon response missing envelope_xdr",
        );
        signatureVerificationOperations.inc({ result: "error" });
        signatureVerificationLatency.observe(
          { result: "error" },
          (Date.now() - startTime) / 1000,
        );
        return {
          success: false,
          result: {
            valid: false,
            reason: "Transaction response is missing the envelope XDR",
            isMultiSig: false,
            signatureCount: 0,
            thresholdMet: false,
          },
        };
      }

      return { success: true, transaction: tx };
    } catch (err) {
      const isTransient = 
        err?.response?.status >= 500 || 
        err?.code === 'ECONNREFUSED' || 
        err?.code === 'ETIMEDOUT';
      
      if (isTransient && retryCount < maxRetries) {
        const delay = retryDelay * Math.pow(2, retryCount);
        logger.warn(
          {
            txHash,
            retry: retryCount + 1,
            maxRetries,
            delayMs: delay,
            error: err.message,
          },
          "verifyTransactionSignature: Transient error, retrying"
        );
        await new Promise(resolve => setTimeout(resolve, delay));
        retryCount++;
        continue;
      }
      
      logger.error(
        {
          txHash,
          errorStatus: err?.response?.status,
          errorCode: err?.code,
          retryCount,
          error: err.message,
        },
        "verifyTransactionSignature: Failed to fetch transaction"
      );
      
      signatureVerificationOperations.inc({ result: "error" });
      signatureVerificationLatency.observe(
        { result: "error" },
        (Date.now() - startTime) / 1000
      );

      // Return a generic reason to callers to avoid leaking internal network
      // topology or Horizon URL details (VULN-04).
      return {
        success: false,
        result: {
          valid: false,
          reason: "Failed to fetch transaction from Horizon",
          isMultiSig: false,
          signatureCount: 0,
          thresholdMet: false,
        },
      };
    }
  }

  // Should not reach here
  return {
    success: false,
    result: {
      valid: false,
      reason: "Max retries exceeded fetching transaction",
      isMultiSig: false,
      signatureCount: 0,
      thresholdMet: false,
    },
  };
}

/**
 * Parse transaction envelope, handling fee-bump transactions
 */
function parseTransactionEnvelope(tx, txHash, networkPassphrase, startTime) {
  let transaction;
  let isFeeBump = false;
  
  try {
    transaction = new StellarSdk.Transaction(tx.envelope_xdr, networkPassphrase);
  } catch (parseErr) {
    // The Transaction constructor cannot parse a fee-bump envelope. Unwrap it
    // and verify the INNER transaction's signatures: the fee-bump's own
    // signature only authorises the fee payer, not the payment, so verifying
    // the wrapper alone would let an attacker fee-bump someone else's unsigned
    // transaction. Verifying the inner transaction closes that gap.
    try {
      const envelope = StellarSdk.TransactionBuilder.fromXDR(
        tx.envelope_xdr,
        networkPassphrase
      );
      if (envelope instanceof StellarSdk.FeeBumpTransaction) {
        transaction = envelope.innerTransaction;
        isFeeBump = true;
      } else {
        throw parseErr;
      }
    } catch (err) {
      logger.error(
        {
          txHash,
          xdrLength: tx.envelope_xdr?.length,
          errorName: err.name,
          errorMessage: err.message,
        },
        "verifyTransactionSignature: Failed to parse XDR"
      );
      
      signatureVerificationOperations.inc({ result: "error" });
      signatureVerificationLatency.observe(
        { result: "error" },
        (Date.now() - startTime) / 1000
      );

      // Return a generic reason to callers — raw XDR parse errors from the
      // Stellar SDK can expose SDK version and internal class names (VULN-04).
      return {
        success: false,
        result: {
          valid: false,
          reason: "Failed to parse transaction XDR",
          isMultiSig: false,
          signatureCount: 0,
          thresholdMet: false,
        },
      };
    }
  }

  const signatures = transaction.signatures;
  if (!signatures || signatures.length === 0) {
    logger.warn({ txHash }, "verifyTransactionSignature: No signatures found");
    
    signatureVerificationOperations.inc({ result: "invalid" });
    signatureVerificationLatency.observe(
      { result: "invalid" },
      (Date.now() - startTime) / 1000
    );
    
    return {
      success: false,
      result: {
        valid: false,
        reason: "Transaction envelope contains no signatures",
        isMultiSig: false,
        signatureCount: 0,
        thresholdMet: false,
      },
    };
  }

  return { success: true, transaction, isFeeBump };
}

/**
 * Load source account for threshold and signer information
 */
async function loadSourceAccount(horizonClient, sourceAccountId, txHash, startTime) {
  try {
    const accountData = await horizonClient.loadAccount(sourceAccountId);

    // NPE-03: loadAccount may resolve with null/undefined if the Horizon
    // client implementation does not throw on a 404 but instead returns a
    // falsy value.  Guard before accessing any property.
    if (accountData == null) {
      logger.error(
        { txHash, sourceAccountId },
        "verifyTransactionSignature: loadAccount returned null",
      );
      signatureVerificationOperations.inc({ result: "error" });
      signatureVerificationLatency.observe(
        { result: "error" },
        (Date.now() - startTime) / 1000,
      );
      return {
        success: false,
        result: {
          valid: false,
          reason: "Could not load source account for weight verification",
          isMultiSig: false,
          signatureCount: 0,
          thresholdMet: false,
        },
      };
    }

    const signers = Array.isArray(accountData.signers) ? accountData.signers : [];
    const medThreshold = accountData.thresholds?.med_threshold ?? 0;
    const isMultiSig = signers.length > 1 || medThreshold > 1;

    return { success: true, signers, medThreshold, isMultiSig };
  } catch (err) {
    logger.warn(
      {
        txHash,
        sourceAccountId,
        errorStatus: err?.response?.status,
        errorMessage: err.message,
      },
      "verifyTransactionSignature: Could not load source account"
    );
    
    signatureVerificationOperations.inc({ result: "error" });
    signatureVerificationLatency.observe(
      { result: "error" },
      (Date.now() - startTime) / 1000
    );

    // Return a generic reason — raw account-load errors can expose internal
    // Horizon URLs or network addresses (VULN-04).
    return {
      success: false,
      result: {
        valid: false,
        reason: "Could not load source account for weight verification",
        isMultiSig: false,
        signatureCount: 0,
        thresholdMet: false,
      },
    };
  }
}

/**
 * Verify signatures against account signers.
 *
 * Security fixes applied here:
 *  VULN-03 — effectiveThreshold: honour med_threshold=0 as "no threshold
 *             required" per the Stellar protocol instead of silently
 *             substituting 1. When the threshold is 0, any single valid
 *             signature from an authorised signer is sufficient.
 *  VULN-09 — False-positive replay detection: the usedSigners check now
 *             runs AFTER the hint fast-path so only hint-matching signers
 *             that were already consumed trigger the replay counter.
 *  VULN-10 — Signature count cap: reject envelopes with more than 20
 *             signatures before entering the loop (Stellar protocol limit).
 *  VULN-13 — Keypair pre-computation: build the hint lookup map once
 *             outside the signature loop instead of calling
 *             Keypair.fromPublicKey inside the O(N×M) nested loop.
 */
function verifySignatures(transaction, signers, medThreshold, txHash, startTime) {
  // VULN-10: Reject envelopes that exceed the Stellar protocol maximum of 20
  // signatures before entering the nested loop. Crafted envelopes with
  // hundreds of signatures would otherwise cause CPU amplification.
  const MAX_SIGNATURES = 20;
  if (transaction.signatures.length > MAX_SIGNATURES) {
    logger.warn(
      {
        txHash,
        signatureCount: transaction.signatures.length,
        max: MAX_SIGNATURES,
      },
      "verifyTransactionSignature: Signature count exceeds protocol maximum",
    );
    return {
      valid: false,
      reason: `Signature count ${transaction.signatures.length} exceeds maximum allowed (${MAX_SIGNATURES})`,
      thresholdMet: false,
    };
  }

  // NPE-13 + NPE-04: Pre-compute Keypair objects and their hints once (O(N)).
  // Simultaneously filter out any signer entry that is null/undefined or has a
  // missing/non-string key — a malformed Horizon response could include such
  // entries and Keypair.fromPublicKey(null) would throw an NPE.
  const signerEntries = [];
  for (const s of signers) {
    if (s == null || typeof s.key !== "string" || s.key.trim() === "") {
      logger.warn(
        { txHash, signerEntry: s },
        "verifyTransactionSignature: skipping malformed signer entry (null or missing key)",
      );
      continue;
    }
    try {
      const keyPair = StellarSdk.Keypair.fromPublicKey(s.key);
      // NPE-05 pre-check: signatureHint() should always return a Buffer, but
      // guard against a null return from a mocked/stubbed Keypair.
      const hint = keyPair.signatureHint();
      if (hint == null) {
        logger.warn(
          { txHash, publicKey: s.key },
          "verifyTransactionSignature: signatureHint() returned null — skipping signer",
        );
        continue;
      }
      signerEntries.push({
        publicKey: s.key,
        // NPE-04: treat missing weight as 0 rather than propagating undefined
        // into arithmetic, which would produce NaN and silently corrupt
        // totalWeight comparisons.
        weight: typeof s.weight === "number" ? s.weight : 0,
        keyPair,
        hint,
      });
    } catch (keypairErr) {
      // NPE-04: Keypair.fromPublicKey throws if the key is syntactically
      // invalid (wrong length, bad checksum, etc.).  Skip silently so one
      // bad signer does not abort verification for the whole transaction.
      logger.warn(
        { txHash, publicKey: s.key, err: keypairErr.message },
        "verifyTransactionSignature: could not construct Keypair for signer — skipping",
      );
    }
  }

  // NPE-06: transaction.hash() computes the XDR-serialised hash of the
  // transaction envelope.  It can throw if the transaction object is in an
  // unexpected state (e.g. missing network passphrase in some SDK versions).
  // Wrap it so a malformed transaction does not cause an unhandled exception.
  let txHashBytes;
  try {
    txHashBytes = transaction.hash();
    if (txHashBytes == null) {
      throw new Error("transaction.hash() returned null");
    }
  } catch (hashErr) {
    logger.error(
      { txHash, err: hashErr.message },
      "verifyTransactionSignature: transaction.hash() failed",
    );
    return {
      valid: false,
      reason: "Failed to compute transaction hash for signature verification",
      thresholdMet: false,
    };
  }

  let totalWeight = 0;
  let validSignatureCount = 0;
  const usedSigners = new Set(); // Prevent the same signer's weight being counted twice.
  let replayAttemptsDetected = 0;

  for (const decoratedSig of transaction.signatures) {
    // NPE-05: hint() and signature() are SDK methods that should always return
    // Buffers, but a null/undefined return (possible in tests or with a
    // stubbed/mocked SDK) would cause Buffer.equals to throw.  Skip the
    // signature entirely if either accessor returns a falsy value.
    const hint = decoratedSig.hint();
    const sigBytes = decoratedSig.signature();

    if (hint == null || sigBytes == null) {
      logger.warn(
        { txHash },
        "verifyTransactionSignature: decoratedSig returned null hint or signature — skipping",
      );
      continue;
    }

    for (const entry of signerEntries) {
      // VULN-09 fix: check hint FIRST (cheap) before the usedSigners guard.
      // Previously the usedSigners check ran before the hint check, so every
      // already-consumed signer incremented the replay counter even when its
      // hint did not match the current signature — producing false positives
      // in multi-sig accounts.
      if (!hint.equals(entry.hint)) continue;

      if (usedSigners.has(entry.publicKey)) {
        replayAttemptsDetected++;
        continue;
      }

      // Full Ed25519 signature verification.
      try {
        const isValid = entry.keyPair.verify(txHashBytes, sigBytes);
        if (isValid) {
          totalWeight += entry.weight;
          validSignatureCount += 1;
          usedSigners.add(entry.publicKey);
          break; // move to next outer signature
        }
      } catch {
        // Malformed signature bytes — skip silently.
      }
    }
  }

  // Log replay attempts for security monitoring.
  if (replayAttemptsDetected > 0) {
    signatureVerificationReplayDetected.inc();
    logger.warn(
      {
        txHash,
        replayAttemptsDetected,
        totalSignatures: transaction.signatures.length,
      },
      "verifyTransactionSignature: Signature replay attempts detected",
    );
  }

  // VULN-03 fix: honour med_threshold=0 as "no threshold required" (Stellar
  // protocol definition). The previous code substituted 1, which was an
  // undocumented policy divergence that could reject valid transactions from
  // accounts intentionally configured with a zero threshold.
  // When medThreshold === 0, any single authorised signer is sufficient, so
  // we require at least one valid signature (validSignatureCount > 0) rather
  // than a weight comparison.
  const thresholdMet =
    medThreshold === 0
      ? validSignatureCount > 0
      : totalWeight >= medThreshold;

  const displayThreshold = medThreshold === 0 ? "0 (any authorised signer)" : String(medThreshold);

  if (!thresholdMet) {
    logger.warn(
      {
        txHash,
        totalWeight,
        medThreshold,
        signatureCount: transaction.signatures.length,
        validSignatureCount,
      },
      "verifyTransactionSignature: Insufficient signing weight",
    );
    return {
      valid: false,
      reason: `Insufficient signing weight: accumulated ${totalWeight}, required ${displayThreshold} (medium threshold)`,
      thresholdMet: false,
    };
  }

  logger.info(
    {
      txHash,
      totalWeight,
      medThreshold,
      signatureCount: transaction.signatures.length,
      validSignatureCount,
      durationMs: Date.now() - startTime,
    },
    "verifyTransactionSignature: Successfully verified",
  );

  return {
    valid: true,
    reason: `Signature verification passed: weight ${totalWeight} >= threshold ${displayThreshold}`,
    thresholdMet: true,
  };
}