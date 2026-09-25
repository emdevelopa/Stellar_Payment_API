/**
 * Trustline Management API Routes
 * 
 * Implements enhanced trustline management with all four optimization tasks:
 * - Task #595: Cryptographic signature verification
 * - Task #594: Rate limiting for trustline operations  
 * - Task #597: Enhanced error recovery
 * - Task #596: Optimized SQL queries
 */

import express from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { trustlineManager, createTrustlineRateLimits } from '../lib/trustline-manager.js';
import { requireApiKeyAuth } from '../lib/auth.js';
import { connectRedisClient } from '../lib/redis.js';
import { isValidStellarAccountId, isValidAssetCode } from '../lib/stellar.js';

const router = express.Router();
const authenticateApiKey = requireApiKeyAuth();

// Initialize rate limiting
let rateLimiters = null;

async function initializeRateLimiting() {
  if (!rateLimiters) {
    try {
      const redisClient = await connectRedisClient();
      rateLimiters = createTrustlineRateLimits(redisClient);
    } catch (error) {
      console.warn('Failed to initialize trustline rate limiting:', error.message);
      // Graceful degradation - continue without rate limiting
      rateLimiters = {
        operations: (req, res, next) => next(),
        verifications: (req, res, next) => next(),
        burst: (req, res, next) => next(),
      };
    }
  }
  return rateLimiters;
}

/** Clears the cached rate-limiter instance. Used only in tests. */
export function _resetRateLimiters() {
  rateLimiters = null;
}

// Validation middleware
const validateTxHash = [
  param('txHash')
    .isLength({ min: 64, max: 64 })
    .isHexadecimal()
    .withMessage('Transaction hash must be a 64-character hexadecimal string')
];

const validateAssetParams = [
  query('assetCode')
    .optional()
    .custom((value) => {
      if (value && !isValidAssetCode(value)) {
        throw new Error('Asset code must be 1-12 alphanumeric characters');
      }
      return true;
    }),
  query('assetIssuer')
    .optional()
    .custom((value) => {
      if (value && !isValidStellarAccountId(value)) {
        throw new Error('Asset issuer must be a valid Stellar public key');
      }
      return true;
    })
];

const validatePaginationParams = [
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  query('offset')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Offset must be a non-negative integer')
];

/**
 * POST /trustlines/verify/:txHash
 *
 * Verify trustline transaction signature with enhanced cryptographic verification
 * Implements Task #595: Add cryptographic signature verification to Trustline Manager
 */
router.post('/verify/:txHash',
  authenticateApiKey,
  validateTxHash,
  async (req, res, next) => {
    const limits = await initializeRateLimiting();
    limits.burst(req, res, next);
  },
  async (req, res, next) => {
    const limits = await initializeRateLimiting();
    limits.verifications(req, res, next);
  },
  [
    body('expectedOperation')
      .optional()
      .isIn(['changeTrust', 'allowTrust'])
      .withMessage('Expected operation must be changeTrust or allowTrust'),
    body('skipCache')
      .optional()
      .isBoolean()
      .withMessage('Skip cache must be a boolean')
  ],
  async (req, res) => {
    try {
      // Validate request
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          error: 'Validation failed',
          details: errors.array()
        });
      }

      const { txHash } = req.params;
      const { expectedOperation = 'changeTrust', skipCache = false } = req.body;

      // Verify trustline transaction with enhanced security
      const verification = await trustlineManager.verifyTrustlineTransaction(txHash, {
        expectedOperation,
        skipCache
      });

      // Log verification for audit trail
      if (req.merchant?.id) {
        try {
          await trustlineManager.queryOptimizer.logTrustlineVerification({
            merchantId: req.merchant.id,
            txHash,
            verification
          });
        } catch (logError) {
          console.warn('Failed to log trustline verification:', logError.message);
          // Don't fail the request for logging errors
        }
      }

      res.json({
        txHash,
        verification,
        timestamp: new Date().toISOString(),
        merchantId: req.merchant?.id
      });

    } catch (error) {
      console.error('Trustline verification error:', error);
      
      res.status(error.status || 500).json({
        error: 'Trustline verification failed',
        message: error.message,
        recoverable: error.recoverable || false,
        context: error.context || 'trustline verification'
      });
    }
  }
);

/**
 * GET /trustlines/config
 *
 * Get merchant's trustline configuration with optimized queries
 * Implements Task #596: Optimize SQL queries in Trustline Manager
 */
router.get('/config',
  authenticateApiKey,
  async (req, res, next) => {
    const limits = await initializeRateLimiting();
    limits.burst(req, res, next);
  },
  async (req, res, next) => {
    const limits = await initializeRateLimiting();
    limits.operations(req, res, next);
  },
  async (req, res) => {
    try {
      if (!req.merchant?.id) {
        return res.status(401).json({
          error: 'Merchant authentication required'
        });
      }

      // Get comprehensive trustline configuration
      const config = await trustlineManager.getMerchantTrustlineConfig(req.merchant.id);

      res.json({
        merchantId: req.merchant.id,
        config,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Get trustline config error:', error);
      
      res.status(error.status || 500).json({
        error: 'Failed to get trustline configuration',
        message: error.message,
        recoverable: error.recoverable || false
      });
    }
  }
);

/**
 * GET /trustlines/assets/:assetCode/payments
 *
 * Get payments for specific asset with optimized filtering
 * Implements Task #596: Optimize SQL queries in Trustline Manager
 */
router.get('/assets/:assetCode/payments',
  authenticateApiKey,
  async (req, res, next) => {
    const limits = await initializeRateLimiting();
    limits.burst(req, res, next);
  },
  async (req, res, next) => {
    const limits = await initializeRateLimiting();
    limits.operations(req, res, next);
  },
  [
    param('assetCode')
      .custom((value) => {
        if (!isValidAssetCode(value)) {
          throw new Error('Asset code must be 1-12 alphanumeric characters');
        }
        return true;
      }),
    ...validateAssetParams,
    ...validatePaginationParams,
    query('status')
      .optional()
      .isIn(['pending', 'confirmed', 'failed'])
      .withMessage('Status must be pending, confirmed, or failed'),
    query('dateFrom')
      .optional()
      .isISO8601()
      .withMessage('Date from must be a valid ISO 8601 date'),
    query('dateTo')
      .optional()
      .isISO8601()
      .withMessage('Date to must be a valid ISO 8601 date')
  ],
  async (req, res) => {
    try {
      // Validate request
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          error: 'Validation failed',
          details: errors.array()
        });
      }

      if (!req.merchant?.id) {
        return res.status(401).json({
          error: 'Merchant authentication required'
        });
      }

      const { assetCode } = req.params;
      const {
        assetIssuer = null,
        status = null,
        limit = 50,
        offset = 0,
        dateFrom = null,
        dateTo = null
      } = req.query;

      // Get payments with optimized query
      const payments = await trustlineManager.queryOptimizer.findPaymentsByAsset(
        req.merchant.id,
        assetCode.toUpperCase(),
        assetIssuer,
        {
          status,
          limit: parseInt(limit),
          offset: parseInt(offset),
          dateFrom,
          dateTo
        }
      );

      res.json({
        merchantId: req.merchant.id,
        assetCode: assetCode.toUpperCase(),
        assetIssuer,
        filters: { status, dateFrom, dateTo },
        pagination: { limit: parseInt(limit), offset: parseInt(offset) },
        payments: payments.rows || [],
        count: payments.rows?.length || 0,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Get asset payments error:', error);
      
      res.status(error.status || 500).json({
        error: 'Failed to get asset payments',
        message: error.message,
        recoverable: error.recoverable || false
      });
    }
  }
);

/**
 * GET /trustlines/stats
 *
 * Get trustline statistics with optimized aggregation
 * Implements Task #596: Optimize SQL queries in Trustline Manager
 */
router.get('/stats',
  authenticateApiKey,
  async (req, res, next) => {
    const limits = await initializeRateLimiting();
    limits.burst(req, res, next);
  },
  async (req, res, next) => {
    const limits = await initializeRateLimiting();
    limits.operations(req, res, next);
  },
  [
    query('timeframe')
      .optional()
      .isIn(['1 hour', '24 hours', '7 days', '30 days'])
      .withMessage('Timeframe must be 1 hour, 24 hours, 7 days, or 30 days')
  ],
  async (req, res) => {
    try {
      // Validate request
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          error: 'Validation failed',
          details: errors.array()
        });
      }

      if (!req.merchant?.id) {
        return res.status(401).json({
          error: 'Merchant authentication required'
        });
      }

      const { timeframe = '24 hours' } = req.query;

      // Get payment statistics by asset
      const stats = await trustlineManager.queryOptimizer.getPaymentStatsByAsset(
        req.merchant.id,
        timeframe
      );

      // Get health metrics
      const healthMetrics = await trustlineManager.queryOptimizer.getTrustlineHealthMetrics(
        req.merchant.id
      );

      res.json({
        merchantId: req.merchant.id,
        timeframe,
        stats: stats.rows || [],
        healthMetrics: healthMetrics.rows || [],
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Get trustline stats error:', error);
      
      res.status(error.status || 500).json({
        error: 'Failed to get trustline statistics',
        message: error.message,
        recoverable: error.recoverable || false
      });
    }
  }
);

/**
 * POST /trustlines/validate-asset
 *
 * Validate asset against merchant's allowed issuers and payment limits
 * Implements enhanced validation with error recovery
 */
router.post('/validate-asset',
  authenticateApiKey,
  async (req, res, next) => {
    const limits = await initializeRateLimiting();
    limits.burst(req, res, next);
  },
  async (req, res, next) => {
    const limits = await initializeRateLimiting();
    limits.operations(req, res, next);
  },
  [
    body('assetCode')
      .notEmpty()
      .custom((value) => {
        if (!isValidAssetCode(value)) {
          throw new Error('Asset code must be 1-12 alphanumeric characters');
        }
        return true;
      }),
    body('assetIssuer')
      .optional()
      .custom((value) => {
        if (value && !isValidStellarAccountId(value)) {
          throw new Error('Asset issuer must be a valid Stellar public key');
        }
        return true;
      }),
    body('amount')
      .optional()
      .isFloat({ min: 0.0000001 })
      .withMessage('Amount must be a positive number with at least 7 decimal places')
  ],
  async (req, res) => {
    try {
      // Validate request
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          error: 'Validation failed',
          details: errors.array()
        });
      }

      if (!req.merchant?.id) {
        return res.status(401).json({
          error: 'Merchant authentication required'
        });
      }

      const { assetCode, assetIssuer = null, amount = null } = req.body;

      // Get merchant configuration
      const config = await trustlineManager.getMerchantTrustlineConfig(req.merchant.id);
      const merchant = config.merchant;

      if (!merchant) {
        return res.status(404).json({
          error: 'Merchant not found'
        });
      }

      const validation = {
        assetCode: assetCode.toUpperCase(),
        assetIssuer,
        amount,
        valid: true,
        issues: []
      };

      // Validate asset issuer against allowed list
      if (assetCode.toUpperCase() !== 'XLM' && assetIssuer) {
        const allowedIssuers = merchant.allowed_issuers;
        if (Array.isArray(allowedIssuers) && allowedIssuers.length > 0) {
          if (!allowedIssuers.includes(assetIssuer)) {
            validation.valid = false;
            validation.issues.push({
              type: 'issuer_not_allowed',
              message: 'Asset issuer is not in the merchant\'s allowed list',
              allowedIssuers
            });
          }
        }
      }

      // Validate payment limits if amount provided
      if (amount !== null && merchant.payment_limits) {
        const assetLimits = merchant.payment_limits[assetCode.toUpperCase()];
        if (assetLimits) {
          if (assetLimits.min !== undefined && amount < assetLimits.min) {
            validation.valid = false;
            validation.issues.push({
              type: 'below_minimum',
              message: `Amount is below the minimum for ${assetCode.toUpperCase()}`,
              min: assetLimits.min,
              delta: assetLimits.min - amount
            });
          }
          
          if (assetLimits.max !== undefined && amount > assetLimits.max) {
            validation.valid = false;
            validation.issues.push({
              type: 'above_maximum',
              message: `Amount exceeds the maximum for ${assetCode.toUpperCase()}`,
              max: assetLimits.max,
              delta: amount - assetLimits.max
            });
          }
        }
      }

      res.json({
        merchantId: req.merchant.id,
        validation,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Asset validation error:', error);
      
      res.status(error.status || 500).json({
        error: 'Asset validation failed',
        message: error.message,
        recoverable: error.recoverable || false
      });
    }
  }
);

/**
 * GET /trustlines/health
 * 
 * Get trustline system health status
 * Implements monitoring for all optimization tasks
 */
router.get('/health',
  async (req, res) => {
    try {
      const health = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        components: {
          signatureVerifier: 'healthy',
          rateLimiter: 'healthy',
          errorRecovery: 'healthy',
          queryOptimizer: 'healthy'
        },
        metrics: {}
      };

      // Test signature verifier
      try {
        const testCache = trustlineManager.signatureVerifier.verificationCache;
        health.metrics.cacheSize = testCache.size;
      } catch (error) {
        health.components.signatureVerifier = 'degraded';
        health.status = 'degraded';
      }

      // Test rate limiter
      try {
        await initializeRateLimiting();
        health.components.rateLimiter = rateLimiters ? 'healthy' : 'degraded';
      } catch (error) {
        health.components.rateLimiter = 'degraded';
        health.status = 'degraded';
      }

      // Test error recovery (circuit breaker status)
      try {
        const circuitBreakerOpen = trustlineManager.errorRecovery.isCircuitBreakerOpen();
        health.metrics.circuitBreakerOpen = circuitBreakerOpen;
        if (circuitBreakerOpen) {
          health.components.errorRecovery = 'degraded';
          health.status = 'degraded';
        }
      } catch (error) {
        health.components.errorRecovery = 'unhealthy';
        health.status = 'unhealthy';
      }

      // Test query optimizer (simple query)
      try {
        // This is a lightweight test query
        await trustlineManager.queryOptimizer.getMerchantAllowedAssets('00000000-0000-0000-0000-000000000000');
        health.components.queryOptimizer = 'healthy';
      } catch (error) {
        health.components.queryOptimizer = 'degraded';
        health.status = 'degraded';
      }

      const statusCode = health.status === 'healthy' ? 200 : 
                        health.status === 'degraded' ? 200 : 503;

      res.status(statusCode).json(health);

    } catch (error) {
      console.error('Health check error:', error);
      
      res.status(503).json({
        status: 'unhealthy',
        error: 'Health check failed',
        message: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }
);

export default router;
