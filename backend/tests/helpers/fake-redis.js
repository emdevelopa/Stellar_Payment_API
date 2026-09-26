/**
 * In-memory stand-in for the subset of Redis used by the exchange-rate
 * coordinator (issues #1445, #1446): SET [PX ms] [NX], GET, DEL and the
 * compare-and-delete EVAL script. Several coordinators can share one
 * instance to simulate multiple API processes against the same Redis.
 *
 * Commands resolve asynchronously (optionally after `latencyMs`) so they
 * interleave the way network round-trips do. Expiry follows Date.now(), so
 * it works with vi.useFakeTimers().
 */
export function createFakeRedis({ latencyMs = 0 } = {}) {
  const store = new Map(); // key -> { value, expiresAt }
  const calls = [];
  let failWith = null;

  const live = (key) => {
    const entry = store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && Date.now() >= entry.expiresAt) {
      store.delete(key);
      return null;
    }
    return entry;
  };

  const execute = (args) => {
    const [cmd, ...rest] = args;
    switch (String(cmd).toUpperCase()) {
      case 'GET':
        return live(rest[0])?.value ?? null;
      case 'SET': {
        const [key, value, ...opts] = rest;
        const upper = opts.map((o) => String(o).toUpperCase());
        const pxIndex = upper.indexOf('PX');
        const ttl = pxIndex >= 0 ? Number(opts[pxIndex + 1]) : null;
        if (upper.includes('NX') && live(key)) return null;
        store.set(key, { value: String(value), expiresAt: ttl ? Date.now() + ttl : null });
        return 'OK';
      }
      case 'DEL':
        return rest.reduce((n, key) => n + (live(key) && store.delete(key) ? 1 : 0), 0);
      case 'EVAL': {
        // Only the compare-and-delete release script is supported.
        const [, , key, token] = rest;
        if (live(key)?.value === token) {
          store.delete(key);
          return 1;
        }
        return 0;
      }
      default:
        throw new Error(`fake-redis: unsupported command ${cmd}`);
    }
  };

  return {
    isOpen: true,
    calls,
    store,
    /** Make every subsequent command reject with `error` (null to heal). */
    setFailure(error) {
      failWith = error;
    },
    async sendCommand(args) {
      calls.push(args);
      if (latencyMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, latencyMs));
      } else {
        await Promise.resolve();
      }
      if (failWith) throw failWith;
      return execute(args);
    },
    /** Test helper: count calls by command name. */
    count(cmd) {
      return calls.filter(([c]) => String(c).toUpperCase() === cmd).length;
    },
  };
}
