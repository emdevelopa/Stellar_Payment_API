/**
 * AMM Bot Cache Module
 * Provides robust caching with Redis + memory fallback
 * 
 * @module cache
 */

import Redis, { Redis as RedisClient } from 'ioredis';
import logger from './logger'; // Adjust path to your logger

// ============================================================================
// Type Definitions
// ============================================================================

export interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
  fallbacks: number;
  memorySize: number;
  redisConnected: boolean;
}

export interface CacheEntry<T = any> {
  value: T;
  expires: number;
}

export interface CacheConfig {
  redis: {
    host: string;
    port: number;
    password?: string;
    db: number;
  };
  ttl: {
    market: number;
    liquidity: number;
    position: number;
    history: number;
    default: number;
  };
  strategies: {
    [key: string]: {
      ttl: number;
      stale: number;
    };
  };
}

export type CacheStrategy = 'market' | 'liquidity' | 'position' | 'history' | 'default';

export interface FetchFunction<T> {
  (): Promise<T>;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: CacheConfig = {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB || '0', 10),
  },
  ttl: {
    market: 10,
    liquidity: 30,
    position: 60,
    history: 120,
    default: 60,
  },
  strategies: {
    market: { ttl: 10, stale: 5 },
    liquidity: { ttl: 30, stale: 15 },
    position: { ttl: 60, stale: 30 },
    history: { ttl: 120, stale: 60 },
    default: { ttl: 60, stale: 10 },
  },
};

// ============================================================================
// Cache Service Class
// ============================================================================

/**
 * AMM Bot Cache Service
 * 
 * Provides a robust caching layer with:
 * - Redis primary storage with memory fallback
 * - Configurable TTL per data type
 * - Stale-while-revalidate pattern
 * - Automatic error recovery
 * - Statistics tracking
 */
export class AMMBotCache {
  private redis: RedisClient | null = null;
  private memoryCache: Map<string, CacheEntry> = new Map();
  private initialized = false;
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    hitRate: 0,
    fallbacks: 0,
    memorySize: 0,
    redisConnected: false,
  };
  private config: CacheConfig;

  constructor(config: Partial<CacheConfig> = {}) {
    this.config = {
      redis: { ...DEFAULT_CONFIG.redis, ...config.redis },
      ttl: { ...DEFAULT_CONFIG.ttl, ...config.ttl },
      strategies: { ...DEFAULT_CONFIG.strategies, ...config.strategies },
    };
  }

  // ==========================================================================
  // Public Methods
  // ==========================================================================

  /**
   * Initialize the cache service
   * Creates Redis connection with automatic fallback to memory cache
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      this.redis = new Redis({
        host: this.config.redis.host,
        port: this.config.redis.port,
        password: this.config.redis.password,
        db: this.config.redis.db,
        retryStrategy: (times: number): number | null => {
          if (times > 3) {
            logger.warn('Redis connection failed after 3 retries, using memory cache only');
            return null;
          }
          return Math.min(times * 100, 3000);
        },
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        lazyConnect: false,
      });

      // Event handlers
      this.redis.on('error', this.handleRedisError.bind(this));
      this.redis.on('connect', this.handleRedisConnect.bind(this));
      this.redis.on('close', this.handleRedisClose.bind(this));

      // Test connection
      await this.redis.ping();
      this.stats.redisConnected = true;
      this.initialized = true;
      logger.info('AMM Bot cache initialized with Redis');

    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.warn('Redis unavailable, using memory cache only:', err.message);
      this.initialized = true;
      this.redis = null;
      this.stats.redisConnected = false;
    }
  }

  /**
   * Get data from cache or fetch fresh
   * 
   * @param key - Cache key
   * @param fetchFn - Function to fetch fresh data on cache miss
   * @param ttl - Time to live in seconds (overrides strategy)
   * @param strategy - Caching strategy
   * @returns Cached or freshly fetched data
   */
  async getOrFetch<T>(
    key: string,
    fetchFn: FetchFunction<T>,
    ttl: number | null = null,
    strategy: CacheStrategy = 'default'
  ): Promise<T> {
    // Try cache first
    const cached = await this.get<T>(key);
    if (cached !== null && cached !== undefined) {
      this.stats.hits++;
      this.updateStats();
      return cached;
    }

    this.stats.misses++;
    this.updateStats();

    try {
      // Fetch fresh data with timeout
      const fresh = await this.withTimeout<T>(fetchFn);

      // Store in cache
      const effectiveTTL = ttl ?? this.getTTL(strategy);
      await this.set(key, fresh, effectiveTTL);

      return fresh;

    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error(`Cache fetch failed for key "${key}":`, err);

      // Try stale cache if available
      const stale = await this.getStale<T>(key);
      if (stale !== null) {
        logger.warn(`Returning stale data for key "${key}"`);
        return stale;
      }

      throw new Error(`Cache and fetch both failed for key "${key}": ${err.message}`);
    }
  }

  /**
   * Get data from cache (Redis + memory fallback)
   * 
   * @param key - Cache key
   * @returns Cached data or null
   */
  async get<T = any>(key: string): Promise<T | null> {
    const fullKey = this.buildKey(key);

    // Try Redis first
    if (this.redis) {
      try {
        const data = await this.redis.get(fullKey);
        if (data !== null) {
          return JSON.parse(data) as T;
        }
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.warn(`Redis GET failed for key "${key}":`, err.message);
        this.stats.fallbacks++;
        this.updateStats();
      }
    }

    // Fallback to memory cache
    const memData = this.memoryCache.get(fullKey);
    if (memData && memData.expires > Date.now()) {
      return memData.value as T;
    }

    return null;
  }

  /**
   * Set data in cache
   * 
   * @param key - Cache key
   * @param value - Data to cache
   * @param ttl - Time to live in seconds
   */
  async set<T = any>(key: string, value: T, ttl: number = 60): Promise<void> {
    const fullKey = this.buildKey(key);
    const serialized = JSON.stringify(value);

    // Store in Redis
    if (this.redis) {
      try {
        await this.redis.setex(fullKey, ttl, serialized);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.warn(`Redis SET failed for key "${key}":`, err.message);
        this.stats.fallbacks++;
        this.updateStats();
      }
    }

    // Always store in memory as fallback
    this.memoryCache.set(fullKey, {
      value,
      expires: Date.now() + (ttl * 1000),
    });

    // Clean expired entries if memory cache grows too large
    if (this.memoryCache.size > 500) {
      this.cleanMemoryCache();
    }

    this.updateStats();
  }

  /**
   * Get stale cache data (for fallback)
   * 
   * @param key - Cache key
   * @returns Stale data or null
   */
  async getStale<T = any>(key: string): Promise<T | null> {
    const fullKey = this.buildKey(key);

    // Check Redis for stale data
    if (this.redis) {
      try {
        const data = await this.redis.get(`${fullKey}:stale`);
        if (data !== null) {
          return JSON.parse(data) as T;
        }
      } catch (error) {
        // Ignore errors for stale fallback
      }
    }

    // Check memory for stale
    const memData = this.memoryCache.get(fullKey);
    if (memData) {
      return memData.value as T;
    }

    return null;
  }

  /**
   * Invalidate a specific cache key
   * 
   * @param key - Cache key to invalidate
   */
  async invalidate(key: string): Promise<void> {
    const fullKey = this.buildKey(key);

    if (this.redis) {
      try {
        await this.redis.del(fullKey);
        await this.redis.del(`${fullKey}:stale`);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.warn(`Redis DEL failed for key "${key}":`, err.message);
      }
    }

    this.memoryCache.delete(fullKey);
    this.updateStats();
  }

  /**
   * Invalidate all cache keys matching a pattern
   * 
   * @param pattern - Pattern to match (supports glob-style *)
   */
  async invalidatePattern(pattern: string): Promise<void> {
    const fullPattern = this.buildKey(pattern);

    if (this.redis) {
      try {
        const keys = await this.redis.keys(fullPattern);
        if (keys.length > 0) {
          await this.redis.del(...keys);
        }
        // Also clean up stale keys
        const staleKeys = await this.redis.keys(`${fullPattern}:stale`);
        if (staleKeys.length > 0) {
          await this.redis.del(...staleKeys);
        }
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.warn(`Redis pattern invalidation failed for "${pattern}":`, err.message);
      }
    }

    // Clean memory cache matching pattern
    const patternRegex = new RegExp(fullPattern.replace(/\*/g, '.*'));
    for (const key of this.memoryCache.keys()) {
      if (patternRegex.test(key)) {
        this.memoryCache.delete(key);
      }
    }

    this.updateStats();
  }

  /**
   * Get TTL for a specific caching strategy
   * 
   * @param strategy - Caching strategy name
   * @returns TTL in seconds
   */
  getTTL(strategy: CacheStrategy): number {
    return this.config.strategies[strategy]?.ttl ?? this.config.ttl.default;
  }

  /**
   * Get stale TTL for a specific caching strategy
   * 
   * @param strategy - Caching strategy name
   * @returns Stale TTL in seconds
   */
  getStaleTTL(strategy: CacheStrategy): number {
    return this.config.strategies[strategy]?.stale ?? 10;
  }

  /**
   * Get cache statistics
   * 
   * @returns Cache stats object
   */
  getStats(): CacheStats {
    return {
      ...this.stats,
      memorySize: this.memoryCache.size,
      redisConnected: !!this.redis,
    };
  }

  /**
   * Clear all caches (admin only)
   */
  async clearAll(): Promise<void> {
    if (this.redis) {
      try {
        const keys = await this.redis.keys(this.buildKey('*'));
        if (keys.length > 0) {
          await this.redis.del(...keys);
        }
        const staleKeys = await this.redis.keys(this.buildKey('*:stale'));
        if (staleKeys.length > 0) {
          await this.redis.del(...staleKeys);
        }
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.error('Failed to clear Redis cache:', err);
      }
    }

    this.memoryCache.clear();
    this.stats = {
      hits: 0,
      misses: 0,
      hitRate: 0,
      fallbacks: 0,
      memorySize: 0,
      redisConnected: !!this.redis,
    };
    logger.info('All caches cleared');
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    if (this.redis) {
      await this.redis.quit();
      this.redis = null;
    }
    this.memoryCache.clear();
    this.initialized = false;
    logger.info('Cache service shut down');
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Build cache key with prefix
   */
  private buildKey(key: string): string {
    return `amm-bot:${key}`;
  }

  /**
   * Update statistics
   */
  private updateStats(): void {
    const total = this.stats.hits + this.stats.misses;
    this.stats.hitRate = total > 0 ? this.stats.hits / total : 0;
    this.stats.memorySize = this.memoryCache.size;
    this.stats.redisConnected = !!this.redis;
  }

  /**
   * Clean expired memory cache entries
   */
  private cleanMemoryCache(): void {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, entry] of this.memoryCache) {
      if (entry.expires < now) {
        this.memoryCache.delete(key);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      logger.debug(`Cleaned ${cleaned} expired memory cache entries`);
    }
  }

  /**
   * Timeout wrapper for fetch operations
   */
  private async withTimeout<T>(fn: FetchFunction<T>, timeoutMs = 5000): Promise<T> {
    return Promise.race([
      fn(),
      new Promise<T>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Cache fetch timeout exceeded (${timeoutMs}ms)`));
        }, timeoutMs);
      }),
    ]);
  }

  // ==========================================================================
  // Redis Event Handlers
  // ==========================================================================

  private handleRedisError(error: Error): void {
    logger.error('Redis cache error:', error);
    this.stats.fallbacks++;
    this.stats.redisConnected = false;
    this.updateStats();

    // Gracefully degrade to memory cache
    if (this.redis) {
      this.redis.quit().catch(() => {});
      this.redis = null;
    }
  }

  private handleRedisConnect(): void {
    logger.info('Redis cache connected successfully');
    this.stats.fallbacks = 0;
    this.stats.redisConnected = true;
    this.updateStats();
  }

  private handleRedisClose(): void {
    logger.warn('Redis connection closed');
    this.stats.redisConnected = false;
    this.updateStats();
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Singleton instance of the cache service
 * 
 * Use this instance throughout your application:
 * 
 * @example
 * import cache from '../lib/cache';
 * 
 * // Initialize once at startup
 * await cache.initialize();
 * 
 * // Use cache
 * const data = await cache.getOrFetch('price:USDC', async () => {
 *   return await fetchPrice();
 * });
 */
const cache = new AMMBotCache();
export default cache;