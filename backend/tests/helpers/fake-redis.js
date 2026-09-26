/**
 * Minimal in-memory Redis stand-in for concurrency tests.
 *
 * Supports the subset used by the idempotency middleware and the payment
 * session lock: GET / SET (with EX/PX) / DEL, plus sendCommand for
 * `SET key value NX PX ttl` and the compare-and-delete EVAL script.
 *
 * Each command awaits a FIFO latency tick and then executes its
 * check-and-mutate step synchronously, which matches Redis' single-threaded
 * atomicity while still letting concurrent callers interleave between
 * commands — exactly the window real race conditions live in.
 */
export function createFakeRedis({ latencyMs = 0 } = {}) {
  const store = new Map();
  const commandLog = [];

  const now = () => Date.now();
  const live = (key) => {
    const entry = store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= now()) {
      store.delete(key);
      return null;
    }
    return entry;
  };
  // Commands complete in the order they were issued (FIFO), like a single
  // Redis connection: the idempotency middleware and the session lock share
  // one client, and the lock's correctness relies on that ordering.
  let queue = Promise.resolve();
  // With no latency, stay on the microtask queue so tests using
  // vi.useFakeTimers() are not blocked on a timer that never fires.
  const tick = () => {
    if (latencyMs <= 0) return Promise.resolve();
    queue = queue.then(
      () => new Promise((resolve) => setTimeout(resolve, Math.random() * latencyMs)),
    );
    return queue;
  };

  function setEntry(key, value, { ex, px } = {}) {
    let expiresAt = null;
    if (ex) expiresAt = now() + Number(ex) * 1000;
    if (px) expiresAt = now() + Number(px);
    store.set(key, { value: String(value), expiresAt });
  }

  const client = {
    isOpen: true,
    store,
    commandLog,
    async get(key) {
      await tick();
      commandLog.push(["GET", key]);
      return live(key)?.value ?? null;
    },
    async set(key, value, opts = {}) {
      await tick();
      commandLog.push(["SET", key]);
      if (opts.NX && live(key)) return null;
      setEntry(key, value, { ex: opts.EX, px: opts.PX });
      return "OK";
    },
    async del(key) {
      await tick();
      commandLog.push(["DEL", key]);
      return store.delete(key) ? 1 : 0;
    },
    async sendCommand(args) {
      await tick();
      const [cmd, ...rest] = args;
      commandLog.push([String(cmd).toUpperCase(), rest[0]]);
      switch (String(cmd).toUpperCase()) {
        case "SET": {
          const [key, value, ...flags] = rest;
          const upper = flags.map((f) => String(f).toUpperCase());
          if (upper.includes("NX") && live(key)) return null;
          const pxIdx = upper.indexOf("PX");
          const exIdx = upper.indexOf("EX");
          setEntry(key, value, {
            px: pxIdx >= 0 ? flags[pxIdx + 1] : undefined,
            ex: exIdx >= 0 ? flags[exIdx + 1] : undefined,
          });
          return "OK";
        }
        case "EVAL": {
          const [script, numKeys, key, token] = rest;
          if (!/redis\.call\("get", KEYS\[1\]\) == ARGV\[1\]/.test(script) || numKeys !== "1") {
            throw new Error("fake-redis: unsupported EVAL script");
          }
          const entry = live(key);
          if (entry && entry.value === token) {
            store.delete(key);
            return 1;
          }
          return 0;
        }
        case "GET":
          return live(rest[0])?.value ?? null;
        default:
          throw new Error(`fake-redis: unsupported command ${cmd}`);
      }
    },
    keys(prefix = "") {
      return [...store.keys()].filter((k) => k.startsWith(prefix) && live(k));
    },
  };

  return client;
}
