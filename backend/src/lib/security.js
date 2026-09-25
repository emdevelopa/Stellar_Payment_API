import rateLimit from 'express-rate-limit';
import helmet from 'helmet';

/**
 * Security configuration and middleware factories
 */

/**
 * Rate limiters for different endpoint groups
 */
export const rateLimiters = {
  // Strict limit for authentication endpoints (register, rotate-key)
  auth: rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 attempts
    message: { error: 'Too many authentication attempts, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: false,
    skipFailedRequests: false,
  }),

  // Standard limit for API operations
  api: rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 30, // 30 requests
    message: { error: 'Too many requests, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: false,
  }),

  // Stricter limit for verification endpoints
  verification: rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // 10 requests
    message: { error: 'Too many verification requests, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
  }),

  // Global API rate limit as fallback
  global: rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 100, // 100 requests per minute
    message: { error: 'Too many requests, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
      // Skip rate limiting for health checks
      return req.path === '/health';
    },
  }),
};

/**
 * Security headers middleware using helmet
 */
export function getSecurityHeaders() {
  return helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https:'],
      },
    },
    frameguard: { action: 'DENY' },
    noSniff: true,
    xssFilter: true,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    hsts: {
      maxAge: 31536000, // 1 year
      includeSubDomains: true,
      preload: true,
    },
  });
}

/**
 * Request sanitization middleware
 * Prevents common injection attacks
 */
export function sanitizeRequest(req, res, next) {
  // Trim whitespace from all string fields in body
  if (req.body && typeof req.body === 'object') {
    Object.keys(req.body).forEach((key) => {
      if (typeof req.body[key] === 'string') {
        req.body[key] = req.body[key].trim();
      }
    });
  }

  // Store original body for webhook signature verification
  req.rawBody = JSON.stringify(req.body);

  next();
}

/**
 * Error response middleware
 * Sanitizes error messages to prevent information disclosure
 */
export function errorHandler(err, req, res, next) {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const isDevelopment = nodeEnv === 'development';

  let status = err.status || err.statusCode || 500;
  let message = err.message || 'Internal Server Error';

  // Don't expose database errors in production
  if (status === 500 && !isDevelopment) {
    message = 'An internal server error occurred. Please contact support.';
  }

  // Log full error in development
  if (isDevelopment) {
    console.error('Error:', {
      status,
      message: err.message,
      stack: err.stack,
      path: req.path,
      method: req.method,
    });
  } else {
    // Log sanitized error in production
    console.error('Error:', {
      status,
      message: err.message,
      path: req.path,
      method: req.method,
    });
  }

  return res.status(status).json({ error: message });
}

/**
 * Validates that API keys follow the expected format
 */
export function validateApiKeyFormat(apiKey) {
  if (!apiKey || typeof apiKey !== 'string') {
    return false;
  }
  // API keys should start with 'sk_' and have exactly 48 hex characters after prefix
  const apiKeyRegex = /^sk_[a-f0-9]{48}$/i;
  return apiKeyRegex.test(apiKey);
}

/**
 * Validates webhook URLs to prevent SSRF attacks
 */
export function validateWebhookUrl(url) {
  if (!url || typeof url !== 'string') {
    return false;
  }

  try {
    const webhookUrl = new URL(url);

    // Only allow http and https
    if (!['http:', 'https:'].includes(webhookUrl.protocol)) {
      return false;
    }

    // Block localhost in production
    const nodeEnv = process.env.NODE_ENV || 'development';
    if (nodeEnv === 'production') {
      const hostname = webhookUrl.hostname.toLowerCase();
      if (
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname.startsWith('192.168.') ||
        hostname.startsWith('10.') ||
        hostname.startsWith('172.')
      ) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Validates Stellar addresses format
 */
export function validateStellarAddress(address) {
  if (!address || typeof address !== 'string') {
    return false;
  }
  // Stellar addresses are 56 characters, start with 'G', and are base32 encoded
  // G + 55 characters from alphabet: ABCDEFGHIJKLMNOPQRSTUVWXYZ234567
  const stellarAddressRegex = /^G[ABCDEFGHIJKLMNOPQRSTUVWXYZ234567]{55}$/;
  return stellarAddressRegex.test(address);
}

/**
 * Validates asset codes (e.g., XLM, USDC)
 */
export function validateAssetCode(assetCode) {
  if (!assetCode || typeof assetCode !== 'string') {
    return false;
  }
  // Asset codes are 1-12 alphanumeric characters
  const assetCodeRegex = /^[A-Z0-9]{1,12}$/i;
  return assetCodeRegex.test(assetCode);
}

/**
 * Safely logs security events without exposing sensitive data
 */
export function logSecurityEvent(eventType, details = {}) {
  const sanitizedDetails = { ...details };

  // Remove sensitive fields
  delete sanitizedDetails.api_key;
  delete sanitizedDetails.webhook_secret;
  delete sanitizedDetails.password;
  delete sanitizedDetails.token;

  console.log(`[SECURITY] ${eventType}:`, {
    timestamp: new Date().toISOString(),
    ...sanitizedDetails,
  });
}
