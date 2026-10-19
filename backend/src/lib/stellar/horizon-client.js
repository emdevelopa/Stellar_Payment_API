/**
 * Horizon Client - Encapsulates all Horizon API interactions
 * 
 * This module provides a clean interface for Horizon operations with built-in
 * retry logic, error handling, and connection management.
 * 
 * Refactored to use modular components for better maintainability:
 * - RetryManager: Handles retry logic and metrics
 * - ErrorHandler: Error classification and handling utilities
 * - Constants: Centralized configuration
 */

import * as StellarSdk from "stellar-sdk";
import { logger } from "../logger.js";
import { 
  horizonClientErrors,
  horizonClientLatency,
  horizonClientHealthCheckDuration,
  horizonClientHealthCheckResult,
  horizonClientConnections,
} from "../metrics.js";
import { DEFAULT_RETRY_DELAYS_MS, DEFAULT_HEALTH_TIMEOUT_MS } from "./horizon-client/constants.js";
import { createRetryManager } from "./horizon-client/retry-manager.js";
import { classifyError, getErrorStatus, handleError } from "./horizon-client/error-handler.js";

export class HorizonClient {
  constructor(horizonUrl, networkPassphrase, options = {}) {
    this.horizonUrl = horizonUrl.replace(/\/$/, "");
    this.networkPassphrase = networkPassphrase;
    this.retryDelays = options.retryDelays || DEFAULT_RETRY_DELAYS_MS;
    this.healthTimeout = options.healthTimeout || DEFAULT_HEALTH_TIMEOUT_MS;
    
    this.server = new StellarSdk.Horizon.Server(this.horizonUrl);
    this.retryManager = createRetryManager(this.retryDelays);
    
    // Track active connections
    horizonClientConnections.inc();
  }

  /**
   * Check if Horizon server is reachable
   */
  async isReachable() {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      this.healthTimeout,
    );

    const startTime = Date.now();
    try {
      const response = await fetch(this.horizonUrl, {
        method: "GET",
        signal: controller.signal,
        headers: {
          Accept: "application/json",
        },
      });

      // Treat rate limiting as reachable so transient Horizon throttling
      // doesn't fail the entire API health check.
      const isReachable = response.ok || response.status === 429;
      const duration = (Date.now() - startTime) / 1000;
      
      // Record granular health check metrics
      horizonClientHealthCheckDuration.observe(duration);
      horizonClientHealthCheckResult.inc({ 
        result: isReachable ? "success" : "failure" 
      });
      horizonClientLatency.observe({ 
        operation: "health_check", 
        result: isReachable ? "success" : "failure" 
      }, duration);
      
      return isReachable;
    } catch (err) {
      const duration = (Date.now() - startTime) / 1000;
      
      // Record health check failure metrics
      horizonClientHealthCheckDuration.observe(duration);
      horizonClientHealthCheckResult.inc({ result: "failure" });
      horizonClientErrors.inc({ 
        operation: "health_check", 
        error_type: classifyError(err) 
      });
      
      return false;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Load account details with retry logic
   */
  async loadAccount(accountId) {
    return this.retryManager.executeWithRetry(
      () => this.server.loadAccount(accountId),
      "loadAccount",
      { accountId },
      this.horizonUrl
    );
  }

  /**
   * Fetch payments for an account with retry logic
   */
  async fetchPayments(accountId, options = {}) {
    const builder = this.server
      .payments()
      .forAccount(accountId);
    
    if (options.order) builder.order(options.order);
    if (options.limit) builder.limit(options.limit);
    
    return this.retryManager.executeWithRetry(
      () => builder.call(),
      "fetchPayments",
      { accountId, options },
      this.horizonUrl
    );
  }

  /**
   * Fetch transaction details with retry logic
   */
  async fetchTransaction(txHash) {
    return this.retryManager.executeWithRetry(
      () => this.server.transactions().transaction(txHash).call(),
      "fetchTransaction",
      { txHash },
      this.horizonUrl
    );
  }

  /**
   * Find strict-receive payment paths with retry logic
   */
  async findStrictReceivePaths(sourceAssets, destAsset, destAmount) {
    return this.retryManager.executeWithRetry(
      () => this.server
        .strictReceivePaths(sourceAssets, destAsset, destAmount)
        .call(),
      "findStrictReceivePaths",
      { destAsset: destAsset.getCode(), destAmount },
      this.horizonUrl
    );
  }

  /**
   * Get fee statistics with retry logic
   */
  async getFeeStats() {
    return this.retryManager.executeWithRetry(
      () => this.server.feeStats(),
      "getFeeStats",
      {},
      this.horizonUrl
    );
  }

  /**
   * Get client configuration
   */
  getConfig() {
    return {
      horizonUrl: this.horizonUrl,
      networkPassphrase: this.networkPassphrase,
      retryDelays: this.retryDelays,
      healthTimeout: this.healthTimeout,
      retryManager: this.retryManager.getConfig(),
    };
  }

  /**
   * Get the retry manager instance (for advanced use cases)
   */
  getRetryManager() {
    return this.retryManager;
  }

  /**
   * Get the Stellar SDK server instance (for advanced use cases)
   */
  getServer() {
    return this.server;
  }

  /**
   * Cleanup resources (decrement connection counter)
   */
  close() {
    horizonClientConnections.dec();
  }
}