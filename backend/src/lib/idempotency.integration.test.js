import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import {
  createIdempotencyMiddleware,
  buildIdempotencyKey,
  hashPayload,
} from "./idempotency.js";
import { FakeRedis } from "./__testing__/fake-redis.js";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, { timeout = 2000, interval = 5 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (predicate()) return true;
    await wait(interval);
  }
  return predicate();
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

/**
 * Builds an app whose handler records how many times each Idempotency-Key
 * actually reached the business logic, with an optional in-handler delay so
 * duplicate requests genuinely overlap.
 */
function makeHarness(redis, { delayMs = 0, getClient } = {}) {
  const executions = new Map();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.merchant = { id: req.get("X-Merchant") || "merchant-1" };
    next();
  });
  app.use(createIdempotencyMiddleware({ getClient: getClient || (() => redis) }));
  app.post("/resource", async (req, res) => {
    const key = req.get("Idempotency-Key");
    executions.set(key, (executions.get(key) || 0) + 1);
    if (delayMs) await wait(delayMs);
    res.status(201).json({ key, executions: executions.get(key) });
  });
  return { app, executions };
}

function fire(agent, { key, merchant = "merchant-1", body = { amount: 1 }, count = 1 }) {
  return Array.from({ length: count }, () =>
    Promise.resolve(
      request(agent)
        .post("/resource")
        .set("Idempotency-Key", key)
        .set("X-Merchant", merchant)
        .send(body),
    ),
  );
}

describe("Idempotency Key Manager — concurrency integration & stress", () => {
  it("executes every key exactly once under 10-way concurrency across 50 keys", async () => {
    const localRedis = new FakeRedis();
    const { app, executions } = makeHarness(localRedis, { delayMs: 5 });
    const server = await listen(app);

    const keys = Array.from({ length: 50 }, (_, i) => `stress-${i}`);
    const tasks = keys.flatMap((key) => fire(server, { key, count: 10 }));

    const results = await Promise.all(tasks);
    await close(server);

    for (const result of results) {
      expect([201, 409]).toContain(result.status);
    }
    expect(executions.size).toBe(50);
    for (const [, count] of executions) {
      expect(count).toBe(1);
    }
    expect(localRedis.store.size).toBe(50);
  });

  it("dedupes 100 concurrent duplicates of a single key", async () => {
    const localRedis = new FakeRedis();
    const { app, executions } = makeHarness(localRedis, { delayMs: 10 });
    const server = await listen(app);

    const tasks = fire(server, { key: "hammer", count: 100 });
    const results = await Promise.all(tasks);
    await close(server);

    expect(executions.get("hammer")).toBe(1);
    const succeeded = results.filter((r) => r.status === 201);
    const conflicted = results.filter((r) => r.status === 409);
    expect(succeeded.length).toBeGreaterThanOrEqual(1);
    expect(succeeded.length + conflicted.length).toBe(100);
    for (const result of succeeded) {
      expect(result.body).toEqual({ key: "hammer", executions: 1 });
    }
  });

  it("dedupes across two app instances sharing one Redis (horizontal scaling)", async () => {
    const sharedRedis = new FakeRedis();
    const instanceA = makeHarness(sharedRedis, { delayMs: 10 });
    const instanceB = makeHarness(sharedRedis, { delayMs: 10 });
    const serverA = await listen(instanceA.app);
    const serverB = await listen(instanceB.app);

    const tasks = [
      ...fire(serverA, { key: "shared-across-instances", count: 5 }),
      ...fire(serverB, { key: "shared-across-instances", count: 5 }),
    ];
    const results = await Promise.all(tasks);
    await close(serverA);
    await close(serverB);

    const totalExecutions =
      (instanceA.executions.get("shared-across-instances") || 0) +
      (instanceB.executions.get("shared-across-instances") || 0);
    expect(totalExecutions).toBe(1);
    for (const result of results) {
      expect([201, 409]).toContain(result.status);
    }
  });

  it("completes the concurrency stress run within a bounded time budget", async () => {
    const localRedis = new FakeRedis();
    const { app, executions } = makeHarness(localRedis, { delayMs: 1 });
    const server = await listen(app);

    const startedAt = Date.now();
    const keys = Array.from({ length: 100 }, (_, i) => `budget-${i}`);
    const tasks = keys.flatMap((key) => fire(server, { key, count: 5 }));
    await Promise.all(tasks);
    const durationMs = Date.now() - startedAt;
    await close(server);

    expect(executions.size).toBe(100);
    expect(durationMs).toBeLessThan(5000);
  });

  it("rejects a different payload that races an in-flight request", async () => {
    const localRedis = new FakeRedis();
    const { app, executions } = makeHarness(localRedis, { delayMs: 20 });
    const server = await listen(app);

    const first = Promise.resolve(
      request(server)
        .post("/resource")
        .set("Idempotency-Key", "mismatch-race")
        .send({ amount: 1 }),
    );
    await wait(10);
    const conflicting = await request(server)
      .post("/resource")
      .set("Idempotency-Key", "mismatch-race")
      .send({ amount: 2 });
    const [firstResult] = await Promise.all([first]);
    await close(server);

    expect(conflicting.status).toBe(400);
    expect(firstResult.status).toBe(201);
    expect(executions.get("mismatch-race")).toBe(1);
  });

  it("self-heals a crashed worker's lock once the in-flight TTL elapses", async () => {
    const localRedis = new FakeRedis();
    const { app, executions } = makeHarness(localRedis);
    const server = await listen(app);

    const key = buildIdempotencyKey("merchant-1", "crashed-worker");
    await localRedis.set(
      key,
      JSON.stringify({
        state: "inflight",
        hash: hashPayload({ amount: 1 }),
        token: "dead-token",
        startedAt: new Date().toISOString(),
      }),
      { PX: 20 },
    );

    const blocked = await request(server)
      .post("/resource")
      .set("Idempotency-Key", "crashed-worker")
      .send({ amount: 1 });
    expect(blocked.status).toBe(409);

    await wait(40);

    const recovered = await request(server)
      .post("/resource")
      .set("Idempotency-Key", "crashed-worker")
      .send({ amount: 1 });
    await close(server);

    expect(recovered.status).toBe(201);
    expect(executions.get("crashed-worker")).toBe(1);
  });

  it("keeps the configured idempotency TTL on completed records", async () => {
    const localRedis = new FakeRedis();
    const middleware = createIdempotencyMiddleware({
      getClient: () => localRedis,
      ttlSeconds: 120,
    });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.merchant = { id: "merchant-1" };
      next();
    });
    app.use(middleware);
    app.post("/resource", (_req, res) => res.status(201).json({ ok: true }));
    const server = await listen(app);

    const key = buildIdempotencyKey("merchant-1", "ttl");
    await request(server).post("/resource").set("Idempotency-Key", "ttl").send({});
    await waitFor(() => {
      const entry = localRedis.store.get(key);
      if (!entry) return false;
      try {
        return JSON.parse(entry.value).state === "completed";
      } catch {
        return false;
      }
    }, { timeout: 1000 });

    const entry = localRedis.store.get(key);
    const ttlMs = entry.expiresAt - Date.now();
    await close(server);

    expect(ttlMs).toBeGreaterThan(115_000);
    expect(ttlMs).toBeLessThanOrEqual(120_000);
  });
});

const REDIS_URL = process.env.REDIS_URL;

describe.skipIf(!REDIS_URL)("Idempotency Key Manager — real Redis integration", () => {
  let client;
  const prefix = `it-idem-${Date.now()}`;

  beforeAll(async () => {
    const { createClient } = await import("redis");
    client = createClient({ url: REDIS_URL });
    client.on("error", () => {});
    await client.connect();
  });

  afterAll(async () => {
    if (client?.isOpen) {
      for await (const key of client.scanIterator({ MATCH: `idempotency:*:${prefix}-*` })) {
        await client.del(key);
      }
      await client.quit();
    }
  });

  it("runs the real Lua compare-and-swap scripts without double execution", async () => {
    const executions = new Map();
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.merchant = { id: "real-merchant" };
      next();
    });
    app.use(
      createIdempotencyMiddleware({
        getClient: () => client,
        lockTtlMs: 5000,
        ttlSeconds: 30,
      }),
    );
    app.post("/resource", async (req, res) => {
      const key = req.get("Idempotency-Key");
      executions.set(key, (executions.get(key) || 0) + 1);
      await wait(25);
      res.status(201).json({ key });
    });
    const server = await listen(app);

    const key = `${prefix}-single`;
    const tasks = fire(server, { key, count: 20 });
    const results = await Promise.all(tasks);
    await close(server);

    expect(executions.get(key)).toBe(1);
    for (const result of results) {
      expect([201, 409]).toContain(result.status);
    }
  });
});
