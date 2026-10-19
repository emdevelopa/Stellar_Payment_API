/**
 * Horizon Client Retry Manager
 * 
 * Handles retry logic with exponential backoff and configurable delays
 */

import { logger } from "../../logger.js";
import {
  horizonClientErrors,
  horizonClientOperations,
  horizonClientRetries,
  horizonClientLatency,
  horizonClientOperationDuration,
  horizonClientRetryAttemptDuration,
  horizonClientErrorRecovery,
  horizonClientConcurrentOperations,
} from "../../metrics.js";
import { classifyError, handleError, isRetryableError } from "./error-handler.js";

/**
 * Retry manager class with configurable retry strategy
 */
export class RetryManager {
  constructor(retryDelays, metricsPrefix = "") {
    this.retryDelays = retryDelays;
    this.metricsPrefix = metricsPrefix;
    this.concurrentOperations = 0;
  }

  /**
   * Execute operation with automatic retry logic
   */
  async executeWithRetry(operation, operationName, context = {}, horizonUrl) {
    const totalStartTime = Date.now();
    this.concurrentOperations++;
    horizonClientConcurrentOperations.inc();

    try {
      let lastError = null;

      for (let attempt = 0; attempt <= this.retryDelays.length; attempt += 1) {
        const attemptStartTime = Date.now();
        
        try {
          const result = await operation();
          
          // Record attempt duration
          const attemptDuration = (Date.now() - attemptStartTime) / 1000;
          horizonClientRetryAttemptDuration.observe(
            { operation: operationName, attempt: attempt + 1 },
            attemptDuration
          );
          
          this._recordSuccess(operationName, totalStartTime);
          
          // If this was a retry (attempt > 0), record successful recovery
          if (attempt > 0) {
            horizonClientErrorRecovery.inc({
              operation: operationName,
              error_type: classifyError(lastError),
              recovery_attempt: attempt,
            });
          }
          
          return result;
        } catch (err) {
          lastError = err;
          
          // Record attempt duration even for failed attempts
          const attemptDuration = (Date.now() - attemptStartTime) / 1000;
          horizonClientRetryAttemptDuration.observe(
            { operation: operationName, attempt: attempt + 1 },
            attemptDuration
          );
          
          if (!isRetryableError(err) || attempt === this.retryDelays.length) {
            this._recordError(operationName, err);
            throw handleError(err, operationName, context, horizonUrl);
          }

          this._recordRetry(operationName);
          
          const delay = this.retryDelays[attempt];
          this._logRetry(operationName, attempt + 1, delay, err, context);
          
          await this._sleep(delay);
        }
      }

      // Should not reach here, but for completeness
      throw handleError(lastError, operationName, context, horizonUrl);
    } finally {
      this.concurrentOperations--;
      horizonClientConcurrentOperations.dec();
      
      // Record total operation duration
      const totalDuration = (Date.now() - totalStartTime) / 1000;
      horizonClientOperationDuration.observe(
        { operation: operationName, phase: "total" },
        totalDuration
      );
    }
  }

  /**
   * Record successful operation metrics
   * @private
   */
  _recordSuccess(operationName, startTime) {
    horizonClientOperations.inc({ 
      operation: operationName, 
      result: "success" 
    });
    horizonClientLatency.observe({ 
      operation: operationName, 
      result: "success" 
    }, (Date.now() - startTime) / 1000);
  }

  /**
   * Record error metrics
   * @private
   */
  _recordError(operationName, err) {
    horizonClientOperations.inc({ 
      operation: operationName, 
      result: "error" 
    });
    horizonClientErrors.inc({ 
      operation: operationName, 
      error_type: classifyError(err) 
    });
  }

  /**
   * Record retry metrics
   * @private
   */
  _recordRetry(operationName) {
    horizonClientRetries.inc({ operation: operationName });
  }

  /**
   * Log retry attempt
   * @private
   */
  _logRetry(operationName, attempt, delayMs, error, context) {
    logger.warn(
      { 
        operation: operationName, 
        attempt, 
        delayMs,
        error: error.message,
        ...context 
      },
      "Horizon client: retrying operation after error"
    );
  }

  /**
   * Sleep helper
   * @private
   */
  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get retry configuration
   */
  getConfig() {
    return {
      retryDelays: this.retryDelays,
      maxAttempts: this.retryDelays.length + 1,
      currentConcurrentOperations: this.concurrentOperations,
    };
  }
}

/**
 * Create a retry manager with default configuration
 */
export function createRetryManager(retryDelays) {
  return new RetryManager(retryDelays);
}
