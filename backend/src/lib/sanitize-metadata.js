/**
 * Middleware to sanitize metadata JSON payloads
 * Prevents XSS, NoSQL injection, and excessive nesting
 */

const MAX_NESTING_DEPTH = 4;
const MAX_STRING_LENGTH = 1000;
const MAX_KEYS = 50;

// Keys that rewrite an object's prototype chain when assigned (issue #1447).
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// Patterns that indicate potential XSS or injection attacks
const DANGEROUS_PATTERNS = [
  /<script[^>]*>.*?<\/script>/gi,
  /javascript:/gi,
  /on\w+\s*=/gi, // event handlers like onclick=
  /\$where/gi, // MongoDB injection
  /\$ne/gi,
  /\$gt/gi,
  /\$lt/gi,
  /\$regex/gi,
];

/**
 * Check nesting depth of an object
 */
function getDepth(obj, currentDepth = 0) {
  if (typeof obj !== 'object' || obj === null) {
    return currentDepth;
  }

  if (Array.isArray(obj)) {
    if (obj.length === 0) return currentDepth + 1;
    return Math.max(...obj.map(item => getDepth(item, currentDepth + 1)));
  }

  const keys = Object.keys(obj);
  if (keys.length === 0) return currentDepth + 1;

  return Math.max(...keys.map(key => getDepth(obj[key], currentDepth + 1)));
}

/**
 * Count total keys in nested object
 */
function countKeys(obj) {
  if (typeof obj !== 'object' || obj === null) {
    return 0;
  }

  let count = 0;

  if (Array.isArray(obj)) {
    for (const item of obj) {
      count += countKeys(item);
    }
    return count;
  }

  const keys = Object.keys(obj);
  count += keys.length;

  for (const key of keys) {
    count += countKeys(obj[key]);
  }

  return count;
}

/**
 * Whether any own key anywhere in obj is a prototype-pollution key.
 */
function hasForbiddenKey(obj) {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }
  for (const key of Object.keys(obj)) {
    if (FORBIDDEN_KEYS.has(key) || hasForbiddenKey(obj[key])) {
      return true;
    }
  }
  return false;
}

/**
 * Sanitize string values to remove dangerous patterns
 */
function sanitizeString(str) {
  if (typeof str !== 'string') return str;

  // Truncate overly long strings
  if (str.length > MAX_STRING_LENGTH) {
    str = str.substring(0, MAX_STRING_LENGTH);
  }

  // Remove dangerous patterns
  let sanitized = str;
  for (const pattern of DANGEROUS_PATTERNS) {
    sanitized = sanitized.replace(pattern, '');
  }

  // HTML encode special characters
  sanitized = sanitized
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');

  return sanitized;
}

/**
 * Recursively sanitize object
 */
function sanitizeObject(obj) {
  if (typeof obj !== 'object' || obj === null) {
    return typeof obj === 'string' ? sanitizeString(obj) : obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item));
  }

  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    // Never assign prototype-pollution keys: `sanitized.__proto__ = x`
    // would replace the object's prototype instead of adding a key.
    if (FORBIDDEN_KEYS.has(key)) continue;
    // Sanitize key names too
    const cleanKey = sanitizeString(key);
    sanitized[cleanKey] = sanitizeObject(value);
  }

  return sanitized;
}

/**
 * Validate and sanitize metadata
 */
export function validateMetadata(metadata) {
  // Allow null/undefined
  if (metadata === null || metadata === undefined) {
    return { valid: true, sanitized: null };
  }

  // Must be an object or array
  if (typeof metadata !== 'object') {
    return {
      valid: false,
      error: 'Metadata must be a JSON object or array'
    };
  }

  // Check nesting depth
  const depth = getDepth(metadata);
  if (depth > MAX_NESTING_DEPTH) {
    return {
      valid: false,
      error: `Metadata nesting depth exceeds maximum of ${MAX_NESTING_DEPTH} levels`
    };
  }

  // Check total keys
  const keyCount = countKeys(metadata);
  if (keyCount > MAX_KEYS) {
    return {
      valid: false,
      error: `Metadata contains too many keys (max: ${MAX_KEYS})`
    };
  }

  if (hasForbiddenKey(metadata)) {
    return {
      valid: false,
      error: 'Metadata contains a forbidden key (__proto__, constructor or prototype)'
    };
  }

  // Sanitize the metadata
  const sanitized = sanitizeObject(metadata);

  return { valid: true, sanitized };
}

/**
 * Express middleware for sanitizing metadata in request body
 */
export function sanitizeMetadataMiddleware(req, res, next) {
  if (!req.body.metadata) {
    return next();
  }

  const result = validateMetadata(req.body.metadata);

  if (!result.valid) {
    return res.status(400).json({ error: result.error });
  }

  // Replace with sanitized version
  req.body.metadata = result.sanitized;
  next();
}
