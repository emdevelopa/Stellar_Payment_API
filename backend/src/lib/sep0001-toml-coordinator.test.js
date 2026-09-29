import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  ENTRY_VERSION,
  INVALIDATE_SCRIPT,
  MAX_TOML_BYTES,
  RELEASE_LOCK_SCRIPT,
  WRITE_IF_GENERATION_SCRIPT,
  buildTomlKeys,
  createStellarTomlCoordinator,
  digestToml,
  isValidMerchantId,
  parseSharedEntry,
  resolveCoordinatorConfig,
} from "./sep0001-toml-coordinator.js";
import { logger } from "./logger.js";

const MERCHANT_ID = "3f0c6a8e-6b1d-4c4e-9a53-1f3d2b7c9e10";
const MERCHANT = {
  id: MERCHANT_ID,
  business_name: "Coordinated Merchant",
  email: "merchant@example.com",
  notification_email: "support@example.com",
  recipient: "GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQSXUSMIQSTBE2BRUY4DQAT2B",
  branding_config: { homepage: "https://example.com" },
};

/**
 * In-memory Redis shared between "instances". Implements exactly the commands
 * and Lua scripts the coordinator issues, with PX expiry on a manual clock.
 */
function createFakeRedis(clock) {
  const store = new Map(); // key -> { value, expiresAt }
  const calls = [];

  const read = (key) => {
    const e = store.get(key);
    if (!e) return null;
    if (e.expiresAt !== null && e.expiresAt <= clock.now) {
      store.delete(key);
      return null;
    }
    return e.value;
  };
  const write = (key, value, px) => {
    store.set(key, { value: String(value), expiresAt: px ? clock.now + Number(px) : null });
  };

  const client = {
    isOpen: true,
    store,
    calls,
    read,
    write,
    async sendCommand(args) {
      calls.push(args);
      const [cmd, ...rest] = args;
      switch (cmd) {
        case "GET":
          return read(rest[0]);
        case "MGET":
          return rest.map(read);
        case "DEL":
          return rest.reduce((n, k) => n + (store.delete(k) ? 1 : 0), 0);
        case "SET": {
          const [key, value, ...opts] = rest;
          const nx = opts.includes("NX");
          const pxIdx = opts.indexOf("PX");
          const px = pxIdx >= 0 ? opts[pxIdx + 1] : null;
          if (nx && read(key) !== null) return null;
          write(key, value, px);
          return "OK";
        }
        case "EVAL": {
          const [script, numKeys, ...tail] = rest;
          const keys = tail.slice(0, Number(numKeys));
          const argv = tail.slice(Number(numKeys));
          if (script === RELEASE_LOCK_SCRIPT) {
            if (read(keys[0]) === argv[0]) {
              store.delete(keys[0]);
              return 1;
            }
            return 0;
          }
          if (script === WRITE_IF_GENERATION_SCRIPT) {
            const g = read(keys[1]) ?? "0";
            if (g === argv[0]) {
              write(keys[0], argv[1], argv[2]);
              return 1;
            }
            return 0;
          }
          if (script === INVALIDATE_SCRIPT) {
            const g = Number(read(keys[1]) ?? "0") + 1;
            write(keys[1], g, argv[0]);
            store.delete(keys[0]);
            return g;
          }
          throw new Error("unknown script");
        }
        default:
          throw new Error(`unsupported command ${cmd}`);
      }
    },
  };
  return client;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeInstance(redis, clock, overrides = {}) {
  return createStellarTomlCoordinator({
    getRedis: async () => redis,
    now: () => clock.now,
    sleep: async (ms) => {
      clock.now += ms;
      await Promise.resolve();
    },
    config: { cacheTtlMs: 60_000, lockTtlMs: 5_000, waitTimeoutMs: 1_000, pollIntervalMs: 50 },
    ...overrides,
  });
}

describe("sep0001-toml-coordinator — helpers", () => {
  it("validates merchant ids before they reach a Redis key", () => {
    expect(isValidMerchantId(MERCHANT_ID)).toBe(true);
    for (const bad of ["", "a:b", "a}b", "a{b", "a b", "x".repeat(129), null, 42, "*"]) {
      expect(isValidMerchantId(bad)).toBe(false);
      expect(() => buildTomlKeys(bad)).toThrow(TypeError);
    }
  });

  it("puts all merchant keys on one cluster hash slot", () => {
    const keys = buildTomlKeys(MERCHANT_ID);
    for (const key of Object.values(keys)) {
      expect(key).toContain(`{${MERCHANT_ID}}`);
    }
    expect(new Set(Object.values(keys)).size).toBe(3);
  });

  it("clamps configuration from the environment", () => {
    expect(resolveCoordinatorConfig({})).toEqual({
      cacheTtlMs: 300_000,
      lockTtlMs: 10_000,
      waitTimeoutMs: 3_000,
      pollIntervalMs: 50,
    });
    const cfg = resolveCoordinatorConfig({
      SEP1_TOML_CACHE_TTL_MS: "1",
      SEP1_TOML_LOCK_TTL_MS: "999999",
      SEP1_TOML_LOCK_WAIT_MS: "nope",
      SEP1_TOML_LOCK_POLL_MS: "-5",
    });
    expect(cfg).toEqual({ cacheTtlMs: 1_000, lockTtlMs: 60_000, waitTimeoutMs: 3_000, pollIntervalMs: 50 });
  });

  it("requires a loader", () => {
    expect(() => createStellarTomlCoordinator({})).toThrow(TypeError);
  });

  describe("parseSharedEntry", () => {
    const toml = 'NETWORK_PASSPHRASE = "x"\nTRANSFER_SERVER = "y"';
    const good = { v: ENTRY_VERSION, merchantId: MERCHANT_ID, gen: "0", digest: digestToml(toml), toml };

    it("accepts a well-formed entry", () => {
      expect(parseSharedEntry(JSON.stringify(good), MERCHANT_ID, "0")).toEqual({
        toml,
        digest: good.digest,
      });
    });

    it.each([
      ["missing", null],
      ["not json", "{nope"],
      ["wrong version", JSON.stringify({ ...good, v: 99 })],
      ["other merchant", JSON.stringify({ ...good, merchantId: "someone-else" })],
      ["stale generation", JSON.stringify({ ...good, gen: "7" })],
      ["tampered content", JSON.stringify({ ...good, toml: `${toml}\nSIGNING_KEY = "evil"` })],
      ["missing required fields", JSON.stringify({ ...good, toml: "x", digest: digestToml("x") })],
      [
        "oversized",
        JSON.stringify({
          ...good,
          toml: `${toml}${"a".repeat(MAX_TOML_BYTES)}`,
          digest: digestToml(`${toml}${"a".repeat(MAX_TOML_BYTES)}`),
        }),
      ],
    ])("rejects %s entries", (_label, raw) => {
      expect(parseSharedEntry(raw, MERCHANT_ID, "0")).toBeNull();
    });
  });
});

describe("sep0001-toml-coordinator — coordination", () => {
  let clock;
  let redis;

  beforeEach(() => {
    vi.clearAllMocks();
    clock = { now: 1_000_000 };
    redis = createFakeRedis(clock);
  });

  it("coalesces concurrent requests on one instance into a single load", async () => {
    const gate = deferred();
    const loadMerchant = vi.fn(() => gate.promise);
    const coord = makeInstance(redis, clock, { loadMerchant });

    const pending = Array.from({ length: 25 }, () => coord.getStellarToml(MERCHANT_ID));
    await Promise.resolve();
    gate.resolve(MERCHANT);
    const results = await Promise.all(pending);

    expect(loadMerchant).toHaveBeenCalledTimes(1);
    expect(new Set(results.map((r) => r.digest)).size).toBe(1);
    expect(results[0].toml).toContain('name = "Coordinated Merchant"');
  });

  it("elects a single leader across instances; followers reuse the shared entry", async () => {
    const gate = deferred();
    const loadA = vi.fn(() => gate.promise);
    const loadB = vi.fn(async () => MERCHANT);
    const a = makeInstance(redis, clock, { loadMerchant: loadA });
    const b = makeInstance(redis, clock, {
      loadMerchant: loadB,
      // Follower polls yield to the event loop so the leader can finish.
      sleep: async () => {
        gate.resolve(MERCHANT);
        await new Promise((r) => setImmediate(r));
      },
    });

    const leaderP = a.getStellarToml(MERCHANT_ID);
    await new Promise((r) => setImmediate(r));
    const followerP = b.getStellarToml(MERCHANT_ID);
    const [leader, follower] = await Promise.all([leaderP, followerP]);

    expect(leader.source).toBe("leader");
    expect(follower.source).toBe("shared");
    expect(follower.digest).toBe(leader.digest);
    expect(loadA).toHaveBeenCalledTimes(1);
    expect(loadB).not.toHaveBeenCalled();
    // Lock is released once the leader is done.
    expect(redis.read(buildTomlKeys(MERCHANT_ID).lock)).toBeNull();
  });

  it("serves later requests from the shared store until the TTL lapses", async () => {
    const loadMerchant = vi.fn(async () => MERCHANT);
    const coord = makeInstance(redis, clock, { loadMerchant });

    expect((await coord.getStellarToml(MERCHANT_ID)).source).toBe("leader");
    expect((await coord.getStellarToml(MERCHANT_ID)).source).toBe("shared");
    expect(loadMerchant).toHaveBeenCalledTimes(1);

    clock.now += 60_001;
    expect((await coord.getStellarToml(MERCHANT_ID)).source).toBe("leader");
    expect(loadMerchant).toHaveBeenCalledTimes(2);
  });

  it("invalidation forces regeneration on every instance", async () => {
    let name = "Before";
    const loadMerchant = vi.fn(async () => ({ ...MERCHANT, business_name: name }));
    const a = makeInstance(redis, clock, { loadMerchant });
    const b = makeInstance(redis, clock, { loadMerchant });

    expect((await a.getStellarToml(MERCHANT_ID)).toml).toContain('"Before"');
    expect((await b.getStellarToml(MERCHANT_ID)).source).toBe("shared");

    name = "After";
    await expect(a.invalidate(MERCHANT_ID)).resolves.toBe(true);

    const fromB = await b.getStellarToml(MERCHANT_ID);
    expect(fromB.source).toBe("leader");
    expect(fromB.toml).toContain('"After"');
  });

  it("fences out a stale regeneration that raced an invalidation", async () => {
    const gate = deferred();
    const loadMerchant = vi
      .fn()
      .mockImplementationOnce(() => gate.promise) // slow read of OLD data
      .mockImplementation(async () => ({ ...MERCHANT, business_name: "Fresh" }));
    const a = makeInstance(redis, clock, { loadMerchant });
    const b = makeInstance(redis, clock, { loadMerchant });

    const stale = a.getStellarToml(MERCHANT_ID);
    await new Promise((r) => setImmediate(r));

    // Branding update lands while the leader is still reading.
    await b.invalidate(MERCHANT_ID);
    gate.resolve({ ...MERCHANT, business_name: "Stale" });
    expect((await stale).toml).toContain('"Stale"');

    // The stale result must NOT have been published.
    expect(redis.read(buildTomlKeys(MERCHANT_ID).entry)).toBeNull();
    expect(logger.info).toHaveBeenCalledWith(
      { merchantId: MERCHANT_ID },
      expect.stringContaining("generation changed"),
    );

    const next = await b.getStellarToml(MERCHANT_ID);
    expect(next.toml).toContain('"Fresh"');
  });

  it("does not let requests issued after a local invalidation join an older flight", async () => {
    const gate = deferred();
    const loadMerchant = vi
      .fn()
      .mockImplementationOnce(() => gate.promise)
      .mockImplementation(async () => ({ ...MERCHANT, business_name: "New" }));
    const coord = makeInstance(redis, clock, {
      loadMerchant,
      getRedis: async () => null, // isolate local single-flight behaviour
    });

    const first = coord.getStellarToml(MERCHANT_ID);
    await coord.invalidate(MERCHANT_ID);
    const second = coord.getStellarToml(MERCHANT_ID);
    gate.resolve({ ...MERCHANT, business_name: "Old" });

    expect((await first).toml).toContain('"Old"');
    expect((await second).toml).toContain('"New"');
    expect(loadMerchant).toHaveBeenCalledTimes(2);
  });

  it("takes over when the leader's lock expires without a result", async () => {
    const keys = buildTomlKeys(MERCHANT_ID);
    // A crashed peer left a lock behind that expires in 200ms.
    redis.write(keys.lock, "crashed-peer", 200);
    const loadMerchant = vi.fn(async () => MERCHANT);
    const coord = makeInstance(redis, clock, { loadMerchant });

    const result = await coord.getStellarToml(MERCHANT_ID);
    expect(result.source).toBe("leader");
    expect(loadMerchant).toHaveBeenCalledTimes(1);
  });

  it("never releases a lock it no longer owns", async () => {
    const keys = buildTomlKeys(MERCHANT_ID);
    const coord = makeInstance(redis, clock, {
      loadMerchant: async () => {
        // Lease expires mid-generation and another instance takes the lock.
        clock.now += 5_001;
        redis.write(keys.lock, "other-owner", 5_000);
        return MERCHANT;
      },
    });

    await coord.getStellarToml(MERCHANT_ID);
    expect(redis.read(keys.lock)).toBe("other-owner");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ merchantId: MERCHANT_ID }),
      expect.stringContaining("lock expired before release"),
    );
  });

  it("generates directly when the lock wait times out", async () => {
    const keys = buildTomlKeys(MERCHANT_ID);
    redis.write(keys.lock, "slow-peer", 60_000);
    const loadMerchant = vi.fn(async () => MERCHANT);
    const coord = makeInstance(redis, clock, { loadMerchant });

    const result = await coord.getStellarToml(MERCHANT_ID);
    expect(result.source).toBe("direct");
    expect(loadMerchant).toHaveBeenCalledTimes(1);
    expect(redis.read(keys.lock)).toBe("slow-peer");
  });

  it("ignores a tampered shared entry and regenerates", async () => {
    const keys = buildTomlKeys(MERCHANT_ID);
    const toml = 'NETWORK_PASSPHRASE = "x"\nTRANSFER_SERVER = "https://evil.example"';
    redis.write(
      keys.entry,
      JSON.stringify({ v: ENTRY_VERSION, merchantId: MERCHANT_ID, gen: "0", digest: "0".repeat(64), toml }),
      60_000,
    );
    const coord = makeInstance(redis, clock, { loadMerchant: async () => MERCHANT });

    const result = await coord.getStellarToml(MERCHANT_ID);
    expect(result.source).toBe("leader");
    expect(result.toml).not.toContain("evil.example");
  });

  it("fails open when Redis is unavailable or returns the no-op client", async () => {
    const loadMerchant = vi.fn(async () => MERCHANT);
    for (const getRedis of [
      async () => {
        throw new Error("ECONNREFUSED");
      },
      async () => ({ isOpen: false, sendCommand: async () => null }),
    ]) {
      const coord = makeInstance(redis, clock, { loadMerchant, getRedis });
      expect((await coord.getStellarToml(MERCHANT_ID)).source).toBe("direct");
      await expect(coord.invalidate(MERCHANT_ID)).resolves.toBe(false);
    }
  });

  it("fails open when a Redis command throws mid-coordination", async () => {
    const broken = { isOpen: true, sendCommand: vi.fn().mockRejectedValue(new Error("READONLY")) };
    const coord = makeInstance(redis, clock, {
      loadMerchant: async () => MERCHANT,
      getRedis: async () => broken,
    });
    expect((await coord.getStellarToml(MERCHANT_ID)).source).toBe("direct");
    await expect(coord.invalidate(MERCHANT_ID)).resolves.toBe(false);
  });

  it("returns null for unknown merchants and caches nothing", async () => {
    const coord = makeInstance(redis, clock, { loadMerchant: async () => null });
    await expect(coord.getStellarToml(MERCHANT_ID)).resolves.toBeNull();
    const keys = buildTomlKeys(MERCHANT_ID);
    expect(redis.read(keys.entry)).toBeNull();
    expect(redis.read(keys.lock)).toBeNull();
  });

  it("propagates loader errors once and still releases the lock", async () => {
    const loadMerchant = vi.fn(async () => {
      const err = new Error("db down");
      err.status = 500;
      throw err;
    });
    const coord = makeInstance(redis, clock, { loadMerchant });

    await expect(coord.getStellarToml(MERCHANT_ID)).rejects.toThrow("db down");
    expect(loadMerchant).toHaveBeenCalledTimes(1);
    expect(redis.read(buildTomlKeys(MERCHANT_ID).lock)).toBeNull();
  });

  it("rejects generated content that fails SEP-0001 validation", async () => {
    const coord = makeInstance(redis, clock, {
      loadMerchant: async () => MERCHANT,
      render: () => "garbage",
    });
    await expect(coord.getStellarToml(MERCHANT_ID)).rejects.toMatchObject({ status: 500 });
    expect(redis.read(buildTomlKeys(MERCHANT_ID).entry)).toBeNull();
  });

  it("rejects invalid merchant ids without touching Redis or the database", async () => {
    const loadMerchant = vi.fn();
    const coord = makeInstance(redis, clock, { loadMerchant });
    await expect(coord.getStellarToml("bad:id")).rejects.toThrow(TypeError);
    await expect(coord.invalidate("bad:id")).resolves.toBe(false);
    expect(loadMerchant).not.toHaveBeenCalled();
    expect(redis.calls).toHaveLength(0);
  });
});
