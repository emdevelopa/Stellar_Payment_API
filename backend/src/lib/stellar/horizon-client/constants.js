/**
 * Horizon Client Constants
 * 
 * Centralized configuration constants for the Horizon Client
 */

export const DEFAULT_RETRY_DELAYS_MS = Object.freeze([150, 500]);
export const DEFAULT_HEALTH_TIMEOUT_MS = 2_000;

export const RETRYABLE_ERROR_CODES = Object.freeze([
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
]);

export const RETRYABLE_ERROR_STATUS_CODES = Object.freeze([408, 429]);

export const RETRYABLE_MESSAGE_PATTERNS = Object.freeze([
  "timeout",
  "temporar",
  "network",
  "socket",
  "fetch failed",
]);

export const ERROR_CLASSIFICATION = Object.freeze({
  RATE_LIMIT: "rate_limit",
  NOT_FOUND: "not_found",
  SERVER_ERROR: "server_error",
  CLIENT_ERROR: "client_error",
  NETWORK_ERROR: "network_error",
  TIMEOUT: "timeout",
  UNKNOWN: "unknown",
});

export const ERROR_STATUS_MAPPING = Object.freeze({
  [ERROR_CLASSIFICATION.RATE_LIMIT]: 429,
  [ERROR_CLASSIFICATION.NOT_FOUND]: 404,
  [ERROR_CLASSIFICATION.SERVER_ERROR]: 502,
  [ERROR_CLASSIFICATION.NETWORK_ERROR]: 502,
  [ERROR_CLASSIFICATION.TIMEOUT]: 502,
});

export const HTTP_STATUS_RANGES = Object.freeze({
  SUCCESS: [200, 299],
  REDIRECT: [300, 399],
  CLIENT_ERROR: [400, 499],
  SERVER_ERROR: [500, 599],
});
