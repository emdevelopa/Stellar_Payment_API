import { describe, it, expect, vi, beforeEach } from "vitest";
import { RecoveryQueue, sanitizeErrorMessage } from "./recovery-queue.js";

const silentLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function makeQueue(overrides = {}) {
  let now = 1_000_000;
  const queue = new RecoveryQueue({
    name: "test",
    maxCapacity: 3,
    maxAttempts: 3,
    baseDelayMs: 1_000,
    maxDelayMs: 8_000,
    now: () => now,
    random: () => 1, // deterministic: full ceiling
    logger: silentLogger,
    ...overrides,
  });
  return { queue, advance: (ms) => (now += ms), clock: () => now };
}

describe("RecoveryQueue", () => {
  beforeEach(() => vi.clearAllMocks());

  it("enqueues work and reports stats", () => {
    const { queue } = makeQueue();
    queue.enqueue("a", { id: 1 }, new Error("boom"));

    expect(queue.size).toBe(1);
    expect(queue.stats()).toEqual({ total: 1, pending: 1, exhausted: 0 });
    expect(queue.has("a")).toBe(true);
  });

  it("requires a string key", () => {
    const { queue } = makeQueue();
    expect(() => queue.enqueue("", {}, new Error("x"))).toThrow(TypeError);
    expect(() => queue.enqueue(undefined, {}, new Error("x"))).toThrow(TypeError);
  });

  it("de-duplicates by key and refreshes the error instead of adding an entry", () => {
    const { queue } = makeQueue();
    queue.enqueue("a", { v: 1 }, new Error("first"));
    queue.enqueue("a", { v: 2 }, new Error("second"));

    expect(queue.size).toBe(1);
    expect(queue.list()[0].error.message).toBe("second");
  });

  it("evicts the oldest exhausted entry first, then the oldest pending one, at capacity", async () => {
    const { queue, advance } = makeQueue({ maxAttempts: 1 });
    queue.enqueue("b", {}, new Error("x"));
    advance(10_000);
    await queue.recover(async () => {
      throw new Error("fail");
    });
    expect(queue.stats().exhausted).toBe(1);

    queue.enqueue("a", {}, new Error("x"));
    queue.enqueue("c", {}, new Error("x"));
    queue.enqueue("d", {}, new Error("x")); // full: the exhausted entry makes room
    expect(queue.has("b")).toBe(false);
    expect(queue.size).toBe(3);

    queue.enqueue("e", {}, new Error("x")); // nothing exhausted now: oldest pending goes
    expect(queue.has("a")).toBe(false);
    expect(queue.size).toBe(3);
  });

  it("recovers due entries and removes them", async () => {
    const { queue, advance } = makeQueue();
    queue.enqueue("a", { n: 1 }, new Error("x"));
    advance(5_000);

    const handler = vi.fn(async () => {});
    const result = await queue.recover(handler);

    expect(result).toEqual({ recovered: 1, failed: 0, exhausted: 0, skipped: false });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].payload).toEqual({ n: 1 });
    expect(queue.size).toBe(0);
  });

  it("does not retry an entry before its backoff elapses", async () => {
    const { queue, advance } = makeQueue();
    queue.enqueue("a", {}, new Error("x"));
    advance(1_000);
    const first = await queue.recover(async () => {
      throw new Error("still down");
    });
    expect(first.failed).toBe(1);

    const handler = vi.fn(async () => {});
    const immediate = await queue.recover(handler);
    expect(handler).not.toHaveBeenCalled();
    expect(immediate.recovered).toBe(0);
  });

  it("backs off exponentially, capped at maxDelayMs", async () => {
    const { queue, advance, clock } = makeQueue();
    queue.enqueue("a", {}, new Error("x"));
    advance(1_000);
    const fail = async () => {
      throw new Error("down");
    };

    const t0 = clock();
    await queue.recover(fail); // attempts=1 -> ceiling 2000
    expect(queue.list()[0].nextRetryAt - t0).toBe(2_000);

    advance(2_000);
    const t1 = clock();
    await queue.recover(fail); // attempts=2 -> ceiling 4000
    expect(queue.list()[0].nextRetryAt - t1).toBe(4_000);
  });

  it("isolates an entry as a poison pill after maxAttempts failures", async () => {
    const { queue, advance } = makeQueue({ maxAttempts: 2 });
    queue.enqueue("a", {}, new Error("x"));
    advance(1_000);
    const fail = async () => {
      throw new Error("down");
    };

    await queue.recover(fail);
    advance(60_000);
    const last = await queue.recover(fail);

    expect(last.exhausted).toBe(1);
    expect(queue.stats()).toEqual({ total: 1, pending: 0, exhausted: 1 });

    advance(60_000);
    const handler = vi.fn(async () => {});
    await queue.recover(handler);
    expect(handler).not.toHaveBeenCalled(); // exhausted entries are never retried
  });

  it("exhausts immediately on a non-retryable error", async () => {
    const { queue, advance } = makeQueue();
    queue.enqueue("a", {}, new Error("x"));
    advance(1_000);

    const result = await queue.recover(async () => {
      const err = new Error("gone");
      err.retryable = false;
      throw err;
    });

    expect(result.exhausted).toBe(1);
  });

  it("limits the batch size per run", async () => {
    const { queue, advance } = makeQueue({ maxCapacity: 10 });
    for (let i = 0; i < 5; i += 1) queue.enqueue(`k${i}`, {}, new Error("x"));
    advance(5_000);

    const handler = vi.fn(async () => {});
    const result = await queue.recover(handler, { maxBatch: 2 });

    expect(result.recovered).toBe(2);
    expect(queue.size).toBe(3);
  });

  it("does not run overlapping recoveries", async () => {
    const { queue, advance } = makeQueue();
    queue.enqueue("a", {}, new Error("x"));
    advance(5_000);

    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const first = queue.recover(() => gate);
    const second = await queue.recover(async () => {});

    expect(second.skipped).toBe(true);
    release();
    expect((await first).recovered).toBe(1);
  });

  it("allows a new recovery after the previous one fails", async () => {
    const { queue, advance } = makeQueue();
    queue.enqueue("a", {}, new Error("x"));
    advance(5_000);
    await queue.recover(async () => {
      throw new Error("down");
    });
    advance(60_000);
    const again = await queue.recover(async () => {});
    expect(again.skipped).toBe(false);
    expect(again.recovered).toBe(1);
  });

  it("list() never exposes the payload", () => {
    const { queue } = makeQueue();
    queue.enqueue("a", { secret: "must-not-leak" }, new Error("x"));

    const listed = queue.list();
    expect(JSON.stringify(listed)).not.toContain("must-not-leak");
    expect(listed[0]).not.toHaveProperty("payload");
  });

  it("sanitizes and truncates error messages", () => {
    expect(sanitizeErrorMessage(new Error("a\u0000b\nc"))).toBe("a b c");
    expect(sanitizeErrorMessage(new Error("x".repeat(500))).length).toBe(200);
    expect(sanitizeErrorMessage(undefined)).toBe("unknown error");
  });

  it("reports depth and operations to the metrics hooks", async () => {
    const onDepth = vi.fn();
    const onOperation = vi.fn();
    const { queue, advance } = makeQueue({ metrics: { onDepth, onOperation } });

    queue.enqueue("a", {}, new Error("x"));
    expect(onDepth).toHaveBeenLastCalledWith(1);
    expect(onOperation).toHaveBeenCalledWith("push", "success");

    advance(5_000);
    await queue.recover(async () => {});
    expect(onOperation).toHaveBeenCalledWith("recover", "success");
    expect(onDepth).toHaveBeenLastCalledWith(0);

    queue.enqueue("b", {}, new Error("x"));
    queue.enqueue("b", {}, new Error("y"));
    expect(onOperation).toHaveBeenCalledWith("push", "duplicate");

    queue.clear();
    expect(onOperation).toHaveBeenCalledWith("clear", "success");
    expect(onDepth).toHaveBeenLastCalledWith(0);
  });

  it("clamps unsafe configuration", () => {
    const q = new RecoveryQueue({ maxCapacity: -5, maxAttempts: 9999, baseDelayMs: -1, logger: silentLogger });
    expect(q.maxCapacity).toBe(1);
    expect(q.maxAttempts).toBe(20);
    expect(q.baseDelayMs).toBe(0);
  });
});
