import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import {
  createIdempotencyMiddleware,
  buildIdempotencyKey,
  hashPayload,
} from "./idempotency.js";
import { FakeRedis } from "./__testing__/fake-redis.js";

function makeApp(middleware, { merchantId = "merchant-1", onRequest } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (merchantId) req.merchant = { id: merchantId };
    next();
  });
  app.use(middleware);
  app.post("/resource", async (req, res, next) => {
    try {
      if (onRequest) await onRequest(req, res);
      res.status(201).json({ ok: true, echo: req.body ?? null });
    } catch (err) {
      next(err);
    }
  });
  app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
  return app;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, { timeout = 1000, interval = 5 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (predicate()) return true;
    await wait(interval);
  }
  return predicate();
}

describe("idempotency middleware", () => {
  let redis;

  beforeEach(() => {
    redis = new FakeRedis();
  });

  it("bypasses requests without an Idempotency-Key", async () => {
    let calls = 0;
    const app = makeApp(createIdempotencyMiddleware({ getClient: () => redis }), {
      onRequest: () => {
        calls += 1;
      },
    });

    await request(app).post("/resource").send({ amount: 1 }).expect(201);
    await request(app).post("/resource").send({ amount: 1 }).expect(201);
    expect(calls).toBe(2);
  });

  it("rejects an empty Idempotency-Key", async () => {
    const app = makeApp(createIdempotencyMiddleware({ getClient: () => redis }));
    const res = await request(app)
      .post("/resource")
      .set("Idempotency-Key", "   ")
      .send({ amount: 1 });
    expect(res.status).toBe(400);
  });

  it("requires merchant authentication", async () => {
    const app = makeApp(createIdempotencyMiddleware({ getClient: () => redis }), {
      merchantId: null,
    });
    const res = await request(app)
      .post("/resource")
      .set("Idempotency-Key", "abc")
      .send({ amount: 1 });
    expect(res.status).toBe(401);
  });

  it("executes once and replays the stored response for the same key and payload", async () => {
    let calls = 0;
    const app = makeApp(createIdempotencyMiddleware({ getClient: () => redis }), {
      onRequest: () => {
        calls += 1;
      },
    });

    const first = await request(app)
      .post("/resource")
      .set("Idempotency-Key", "key-1")
      .send({ amount: 5 })
      .expect(201);

    await wait(10);

    const second = await request(app)
      .post("/resource")
      .set("Idempotency-Key", "key-1")
      .send({ amount: 5 })
      .expect(201);

    expect(calls).toBe(1);
    expect(second.headers["idempotency-replayed"]).toBe("true");
    expect(second.body).toEqual(first.body);
  });

  it("replays the stored status code rather than a hard-coded 201", async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.merchant = { id: "merchant-1" };
      next();
    });
    app.use(createIdempotencyMiddleware({ getClient: () => redis }));
    app.post("/resource", (req, res) => res.status(200).json({ ok: true }));

    await request(app).post("/resource").set("Idempotency-Key", "k").send({}).expect(200);
    await wait(10);
    const replay = await request(app)
      .post("/resource")
      .set("Idempotency-Key", "k")
      .send({})
      .expect(200);
    expect(replay.body).toEqual({ ok: true });
  });

  it("rejects a reused key with a different payload", async () => {
    const app = makeApp(createIdempotencyMiddleware({ getClient: () => redis }));

    await request(app).post("/resource").set("Idempotency-Key", "key-2").send({ amount: 5 });
    await wait(10);

    const res = await request(app)
      .post("/resource")
      .set("Idempotency-Key", "key-2")
      .send({ amount: 6 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/different request payload/);
  });

  it("rejects concurrent duplicates with 409 while the original is in flight", async () => {
    let calls = 0;
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const app = makeApp(createIdempotencyMiddleware({ getClient: () => redis }), {
      onRequest: async () => {
        calls += 1;
        await gate;
      },
    });

    const send = () =>
      request(app).post("/resource").set("Idempotency-Key", "key-3").send({ amount: 7 });

    const inflight = Array.from({ length: 5 }, () => Promise.resolve(send()));
    await waitFor(() => calls === 1, { timeout: 1000 });
    await wait(50);

    release();
    const results = await Promise.all(inflight);
    const statuses = results.map((r) => r.status).sort();

    expect(calls).toBe(1);
    expect(statuses).toEqual([201, 409, 409, 409, 409]);
    const conflicts = results.filter((r) => r.status === 409);
    expect(conflicts[0].headers["retry-after"]).toBe("1");
  });

  it("does not cache non-2xx responses and frees the lock for a retry", async () => {
    let calls = 0;
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.merchant = { id: "merchant-1" };
      next();
    });
    app.use(createIdempotencyMiddleware({ getClient: () => redis }));
    app.post("/resource", (req, res) => {
      calls += 1;
      res.status(calls === 1 ? 500 : 201).json({ attempt: calls });
    });

    await request(app).post("/resource").set("Idempotency-Key", "key-4").send({}).expect(500);
    await waitFor(() => redis.store.size === 0, { timeout: 500 });

    const retry = await request(app)
      .post("/resource")
      .set("Idempotency-Key", "key-4")
      .send({})
      .expect(201);
    expect(retry.body).toEqual({ attempt: 2 });
    expect(calls).toBe(2);
  });

  it("ignores an expired in-flight lock and lets the retry proceed", async () => {
    let calls = 0;
    const app = makeApp(createIdempotencyMiddleware({ getClient: () => redis }), {
      onRequest: () => {
        calls += 1;
      },
    });
    const key = buildIdempotencyKey("merchant-1", "key-5");
    await redis.set(
      key,
      JSON.stringify({
        state: "inflight",
        hash: hashPayload({}),
        token: "dead-worker-token",
        startedAt: new Date().toISOString(),
      }),
      { PX: 15 },
    );

    const blocked = await request(app)
      .post("/resource")
      .set("Idempotency-Key", "key-5")
      .send({});
    expect(blocked.status).toBe(409);

    await wait(30);
    await request(app).post("/resource").set("Idempotency-Key", "key-5").send({}).expect(201);
    expect(calls).toBe(1);
  });

  it("fails open when Redis is unavailable", async () => {
    let calls = 0;
    const app = makeApp(createIdempotencyMiddleware({ getClient: () => redis }), {
      onRequest: () => {
        calls += 1;
      },
    });

    redis.failNextGet = true;
    await request(app)
      .post("/resource")
      .set("Idempotency-Key", "key-6")
      .send({ amount: 1 })
      .expect(201);
    await request(app)
      .post("/resource")
      .set("Idempotency-Key", "key-6")
      .send({ amount: 1 })
      .expect(201);
    expect(calls).toBe(2);
  });

  it("does not fail open when an existing payload mismatches", async () => {
    const app = makeApp(createIdempotencyMiddleware({ getClient: () => redis }));
    await redis.set(
      buildIdempotencyKey("merchant-1", "key-7"),
      JSON.stringify({
        state: "completed",
        hash: hashPayload({ amount: 1 }),
        statusCode: 201,
        response: { ok: true },
      }),
    );
    const res = await request(app)
      .post("/resource")
      .set("Idempotency-Key", "key-7")
      .send({ amount: 2 });
    expect(res.status).toBe(400);
  });

  it("replays legacy records that predate the state machine", async () => {
    const app = makeApp(createIdempotencyMiddleware({ getClient: () => redis }));
    await redis.set(
      buildIdempotencyKey("merchant-1", "legacy"),
      JSON.stringify({ hash: hashPayload({ amount: 9 }), response: { ok: true, legacy: true } }),
    );

    const res = await request(app)
      .post("/resource")
      .set("Idempotency-Key", "legacy")
      .send({ amount: 9 })
      .expect(201);
    expect(res.body.legacy).toBe(true);
  });

  it("isolates keys per merchant", async () => {
    const appA = makeApp(createIdempotencyMiddleware({ getClient: () => redis }), {
      merchantId: "merchant-a",
    });
    const appB = makeApp(createIdempotencyMiddleware({ getClient: () => redis }), {
      merchantId: "merchant-b",
    });

    await request(appA).post("/resource").set("Idempotency-Key", "shared").send({}).expect(201);
    await wait(10);
    await request(appB).post("/resource").set("Idempotency-Key", "shared").send({}).expect(201);
    expect(redis.store.size).toBe(2);
  });

  it("frees the lock when the connection closes before a response is sent", async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.merchant = { id: "merchant-1" };
      next();
    });
    app.use(createIdempotencyMiddleware({ getClient: () => redis }));
    app.post("/resource", (req, res) => {
      res.socket.destroy();
    });

    await request(app)
      .post("/resource")
      .set("Idempotency-Key", "key-8")
      .send({})
      .catch(() => {});

    expect(await waitFor(() => redis.store.size === 0, { timeout: 1000 })).toBe(true);
  });

  it("keeps the in-flight record when the completion write fails", async () => {
    redis.eval = async () => {
      throw new Error("eval unavailable");
    };
    const app = makeApp(createIdempotencyMiddleware({ getClient: () => redis }));
    await request(app).post("/resource").set("Idempotency-Key", "key-9").send({}).expect(201);
    expect(redis.store.has(buildIdempotencyKey("merchant-1", "key-9"))).toBe(true);
  });
});
