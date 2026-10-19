/**
 * Horizon Client Error Handler
 * 
 * Utility functions for error classification, status extraction, and error handling
 */

import {
  ERROR_CLASSIFICATION,
  ERROR_STATUS_MAPPING,
  RETRYABLE_ERROR_CODES,
  RETRYABLE_ERROR_STATUS_CODES,
  RETRYABLE_MESSAGE_PATTERNS,
} from "./constants.js";

/**
 * Extract HTTP status from error
 */
export function getErrorStatus(err) {
  return err?.response?.status ?? err?.status ?? null;
}

/**
 * Classify error type for metrics
 */
export function classifyError(err) {
  const status = getErrorStatus(err);
  
  if (status === 429) return ERROR_CLASSIFICATION.RATE_LIMIT;
  if (status === 404) return ERROR_CLASSIFICATION.NOT_FOUND;
  if (status && status >= 500) return ERROR_CLASSIFICATION.SERVER_ERROR;
  if (status && status >= 400) return ERROR_CLASSIFICATION.CLIENT_ERROR;
  
  const code = String(err?.code || "").toUpperCase();
  if (code.includes("CONN") || code.includes("TIMEOUT")) return ERROR_CLASSIFICATION.NETWORK_ERROR;
  if (code.includes("ABORT")) return ERROR_CLASSIFICATION.TIMEOUT;
  
  return ERROR_CLASSIFICATION.UNKNOWN;
}

/**
 * Determine if an error is retryable
 */
export function isRetryableError(err) {
  const status = getErrorStatus(err);
  
  // Retry on rate limits and timeouts
  if (RETRYABLE_ERROR_STATUS_CODES.includes(status)) {
    return true;
  }

  // Retry on server errors
  if (typeof status === "number" && status >= 500) {
    return true;
  }

  // Retry on network errors
  const code = String(err?.code || "").toUpperCase();
  if (RETRYABLE_ERROR_CODES.includes(code)) {
    return true;
  }

  if (err?.name === "AbortError") {
    return true;
  }

  // Retry on timeout/temporary errors in message
  const message = String(err?.message || "");
  return RETRYABLE_MESSAGE_PATTERNS.some(pattern => 
    new RegExp(pattern, "i").test(message)
  );
}

/**
 * Wrap Horizon errors into descriptive error objects
 */
export function handleError(err, operation, context, horizonUrl) {
  const status = getErrorStatus(err);
  const contextStr = Object.entries(context)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");

  if (status === 429) {
    const error = new Error(
      "Horizon rate limit exceeded. Please retry after a short wait.",
    );
    error.status = 429;
    error.operation = operation;
    return error;
  }

  if (status === 404) {
    const error = new Error(
      `Stellar resource not found${contextStr ? `: ${contextStr}` : ""}`,
    );
    error.status = 404;
    error.operation = operation;
    return error;
  }

  if (status && status >= 400 && status < 500) {
    const detail = err?.response?.data?.detail || err.message;
    const error = new Error(`Horizon request error (${status}): ${detail}`);
    error.status = status;
    error.operation = operation;
    return error;
  }

  if (status && status >= 500) {
    const error = new Error(
      `Horizon server error (${status}). The Stellar network may be experiencing issues.`,
    );
    error.status = 502;
    error.operation = operation;
    return error;
  }

  // Network / connection errors
  const error = new Error(
    `Unable to connect to Horizon (${horizonUrl}): ${err.message}`,
  );
  error.status = 502;
  error.operation = operation;
  return error;
}

/**
 * Format context object for logging
 */
export function formatContext(context) {
  return Object.entries(context)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
}
