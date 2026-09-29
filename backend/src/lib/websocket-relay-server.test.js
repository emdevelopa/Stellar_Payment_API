/**
 * Integration tests for the relay server: a real Socket.IO server on an
 * ephemeral port, driven by a raw WebSocket speaking the Engine.IO v4 /
 * Socket.IO v5 wire protocol (so no socket.io-client dependency is needed).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import http from "node:http";
import WebSocket from "ws";
import { createRelayServer, DEFAULT_WS_MAX_HTTP_BUFFER_SIZE } from "./websocket-relay-server.js";
import { RELAY_ERROR_EVENT } from "./websocket-relay-validation.js";

const MERCHANT_ID = "3f1c2b4a-8d6e-4f7a-9b0c-1d2e3f4a5b6c";
const PAYMENT_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";

/** Minimal Socket.IO client over a raw WebSocket. */
function connectClient(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/socket.io/?EIO=4&transport=websocket`);
    const events = [];
    const acks = new Map();
    const waiters = [];
    let nextAckId = 0;
    let closed = false;
    const closeWaiters = [];

    const flush = () => {
      for (let i = waiters.length - 1; i >= 0; i--) {
        const w = waiters[i];
        const found = events.find(w.match);
        if (found) {
          waiters.splice(i, 1);
          w.resolve(found);
        }
      }
    };

    const client = {
      events,
      emit(event, ...args) {
        ws.send(`42${JSON.stringify([event, ...args])}`);
      },
      emitWithAck(event, ...args) {
        const id = nextAckId++;
        return new Promise((res) => {
          acks.set(id, res);
          ws.send(`42${id}${JSON.stringify([event, ...args])}`);
        });
      },
      sendRaw(frame) {
        ws.send(frame);
      },
      waitFor(event, timeout = 2000) {
        return new Promise((res, rej) => {
          const w = { match: ([name]) => name === event, resolve: res };
          waiters.push(w);
          flush();
          setTimeout(() => rej(new Error(`Timed out waiting for ${event}`)), timeout).unref();
        });
      },
      waitForClose(timeout = 2000) {
        if (closed) return Promise.resolve();
        return new Promise((res, rej) => {
          closeWaiters.push(res);
          setTimeout(() => rej(new Error("Timed out waiting for close")), timeout).unref();
        });
      },
      get closed() {
        return closed;
      },
      close() {
        ws.close();
      },
    };

    ws.on("message", (raw) => {
      const msg = raw.toString();
      if (msg.startsWith("0")) {
        ws.send("40"); // Socket.IO CONNECT to the main namespace
      } else if (msg === "2") {
        ws.send("3"); // pong
      } else if (msg.startsWith("40")) {
        resolve(client);
      } else if (msg.startsWith("42")) {
        events.push(JSON.parse(msg.slice(2)));
        flush();
      } else if (msg.startsWith("43")) {
        const m = /^43(\d+)(.*)$/s.exec(msg);
        acks.get(Number(m[1]))?.(JSON.parse(m[2]));
      } else if (msg.startsWith("41")) {
        closed = true;
        closeWaiters.splice(0).forEach((r) => r());
      }
    });
    ws.on("close", () => {
      closed = true;
      closeWaiters.splice(0).forEach((r) => r());
    });
    ws.on("error", reject);
  });
}

describe("websocket relay server (integration)", () => {
  let httpServer;
  let io;
  let port;
  let logger;
  const clients = [];

  const start = async (env = {}) => {
    logger = { warn: vi.fn(), error: vi.fn() };
    httpServer = http.createServer();
    io = createRelayServer({ corsOrigins: ["http://localhost:3000"], logger, env });
    io.attach(httpServer);
    await new Promise((r) => httpServer.listen(0, "127.0.0.1", r));
    port = httpServer.address().port;
  };

  const client = async () => {
    const c = await connectClient(port);
    clients.push(c);
    return c;
  };

  const roomsOf = async () => {
    const [socket] = await io.fetchSockets();
    return socket ? [...socket.rooms] : [];
  };

  beforeEach(async () => {
    await start();
  });

  afterEach(async () => {
    clients.splice(0).forEach((c) => c.close());
    io.close();
    await new Promise((r) => httpServer.close(r));
  });

  it("sets a tight maxHttpBufferSize by default and honours the env override", async () => {
    expect(io.engine.opts.maxHttpBufferSize).toBe(DEFAULT_WS_MAX_HTTP_BUFFER_SIZE);
    const custom = createRelayServer({
      corsOrigins: [],
      logger,
      env: { WS_MAX_HTTP_BUFFER_SIZE: "2048" },
    });
    custom.attach(http.createServer());
    expect(custom.engine.opts.maxHttpBufferSize).toBe(2048);
    custom.close();
  });

  it("joins the merchant room for a valid UUID (case-normalised)", async () => {
    const c = await client();
    c.emit("join:merchant", { merchant_id: MERCHANT_ID.toUpperCase() });
    await vi.waitFor(async () => {
      expect(await roomsOf()).toContain(`merchant:${MERCHANT_ID}`);
    });

    io.to(`merchant:${MERCHANT_ID}`).emit("payment:confirmed", { id: PAYMENT_ID });
    const [, payload] = await c.waitFor("payment:confirmed");
    expect(payload).toEqual({ id: PAYMENT_ID });
  });

  it("emits checkout presence on join and leave", async () => {
    const c = await client();
    c.emit("join:checkout", { payment_id: PAYMENT_ID });
    const [, joined] = await c.waitFor("checkout:presence");
    expect(joined).toEqual({ payment_id: PAYMENT_ID, active_viewers: 1 });

    c.emit("leave:checkout", { payment_id: PAYMENT_ID });
    await vi.waitFor(async () => {
      expect(await roomsOf()).not.toContain(`checkout:${PAYMENT_ID}`);
    });
  });

  it("does not crash the server on an event with no payload", async () => {
    const c = await client();
    c.emit("join:merchant");
    const [, err] = await c.waitFor(RELAY_ERROR_EVENT);
    expect(err).toMatchObject({ event: "join:merchant", error: { code: "INVALID_PAYLOAD" } });

    // server still healthy
    c.emit("join:checkout", { payment_id: PAYMENT_ID });
    await c.waitFor("checkout:presence");
  });

  it("rejects room-name injection and does not join any room", async () => {
    const c = await client();
    c.emit("join:merchant", { merchant_id: `${MERCHANT_ID}` + "x" });
    const [, err] = await c.waitFor(RELAY_ERROR_EVENT);
    expect(err.error.code).toBe("VALIDATION_FAILED");
    expect((await roomsOf()).some((r) => r.startsWith("merchant:"))).toBe(false);
  });

  it("rejects unknown keys and unknown events", async () => {
    const c = await client();
    const reply = await c.emitWithAck("join:checkout", { payment_id: PAYMENT_ID, extra: 1 });
    expect(reply).toEqual([
      expect.objectContaining({ ok: false, error: expect.objectContaining({ code: "VALIDATION_FAILED" }) }),
    ]);

    c.emit("admin:broadcast", { msg: "hi" });
    const [, err] = await c.waitFor(RELAY_ERROR_EVENT);
    expect(err).toMatchObject({ event: "admin:broadcast", error: { code: "UNKNOWN_EVENT" } });
  });

  it("strips prototype-pollution keys sent over the wire", async () => {
    const c = await client();
    c.sendRaw(`42["join:checkout",{"payment_id":"${PAYMENT_ID}","__proto__":{"polluted":true}}]`);
    await c.waitFor("checkout:presence");
    expect({}.polluted).toBeUndefined();
  });

  it("disconnects a socket after repeated invalid events", async () => {
    await new Promise((r) => {
      io.close();
      httpServer.close(r);
    });
    await start({ WS_MAX_INVALID_EVENTS: "3" });

    const c = await client();
    for (let i = 0; i < 3; i++) c.emit("join:checkout", { payment_id: "nope" });
    await c.waitForClose();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ violations: 3 }),
      expect.stringContaining("disconnecting"),
    );
  });

  it("drops the connection when a frame exceeds maxHttpBufferSize", async () => {
    const c = await client();
    c.emit("join:checkout", { payment_id: PAYMENT_ID, pad: "x".repeat(DEFAULT_WS_MAX_HTTP_BUFFER_SIZE) });
    await c.waitForClose();
    expect(c.closed).toBe(true);
  });
});
