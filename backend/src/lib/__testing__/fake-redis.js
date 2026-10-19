import {
  COMPLETE_LOCK_SCRIPT,
  RELEASE_LOCK_SCRIPT,
} from "../idempotency.js";

/**
 * Minimal in-memory Redis stand-in that implements the subset of commands the
 * idempotency middleware uses: GET, SET (NX / PX), DEL and the two Lua
 * compare-and-swap scripts. Script handling matches real Redis semantics
 * (token check before mutating, TTL enforcement on read).
 */
export class FakeRedis {
  constructor() {
    this.store = new Map();
    this.failNextGet = false;
    this.failNextSet = false;
  }

  async get(key) {
    if (this.failNextGet) {
      this.failNextGet = false;
      throw new Error("redis get unavailable");
    }
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt && entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key, value, options = {}) {
    if (this.failNextSet) {
      this.failNextSet = false;
      throw new Error("redis set unavailable");
    }
    const entry = this.store.get(key);
    const expired = entry?.expiresAt && entry.expiresAt <= Date.now();
    if (options.NX && entry && !expired) return null;
    this.store.set(key, {
      value,
      expiresAt: options.PX ? Date.now() + options.PX : null,
    });
    return "OK";
  }

  async del(key) {
    return this.store.delete(key) ? 1 : 0;
  }

  async eval(script, { keys, arguments: args }) {
    const [key] = keys;
    const raw = await this.get(key);
    if (script === COMPLETE_LOCK_SCRIPT) {
      const [token, value, ttl] = args;
      const data = raw ? JSON.parse(raw) : null;
      if (!data || data.token !== token) return 0;
      await this.set(key, value, { PX: Number(ttl) });
      return 1;
    }
    if (script === RELEASE_LOCK_SCRIPT) {
      const [token] = args;
      const data = raw ? JSON.parse(raw) : null;
      if (!data || data.token !== token) return 0;
      await this.del(key);
      return 1;
    }
    throw new Error("unknown script");
  }
}
