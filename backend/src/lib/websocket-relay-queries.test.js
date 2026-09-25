import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getRecentEvents,
  batchInsertEvents,
  dequeueNextEvent,
} from "./websocket-relay-queries.js";

function makeDb(rows = []) {
  return {
    query: vi.fn().mockResolvedValue({ rows }),
  };
}

describe("getRecentEvents", () => {
  let db;

  beforeEach(() => {
    db = makeDb([
      { id: "1", payment_id: "p1", event_type: "payment.confirmed", status: "pending", created_at: new Date() },
    ]);
  });

  it("calls db.query with correct limit and offset", async () => {
    await getRecentEvents(db, 10, 20);
    expect(db.query).toHaveBeenCalledTimes(1);
    const [sql, params] = db.query.mock.calls[0];
    expect(params).toEqual([10, 20]);
    expect(sql).toContain("ORDER BY created_at DESC");
    expect(sql).toContain("LIMIT $1");
    expect(sql).toContain("OFFSET $2");
  });

  it("uses default limit 100 and offset 0 when not provided", async () => {
    await getRecentEvents(db);
    const [, params] = db.query.mock.calls[0];
    expect(params).toEqual([100, 0]);
  });

  it("clamps limit to 1000 max", async () => {
    await getRecentEvents(db, 99999, 0);
    const [, params] = db.query.mock.calls[0];
    expect(params[0]).toBe(1000);
  });

  it("clamps limit to minimum of 1", async () => {
    await getRecentEvents(db, 0, 0);
    const [, params] = db.query.mock.calls[0];
    expect(params[0]).toBe(1);
  });

  it("returns rows from the query result", async () => {
    const result = await getRecentEvents(db, 5, 0);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
    expect(result[0].payment_id).toBe("p1");
  });

  it("includes SET LOCAL statement_timeout in the query", async () => {
    await getRecentEvents(db, 10, 0);
    const [sql] = db.query.mock.calls[0];
    expect(sql).toContain("statement_timeout");
  });
});

describe("batchInsertEvents", () => {
  let db;

  beforeEach(() => {
    db = makeDb([
      { id: "a", payment_id: "p1", event_type: "relay.send", status: "pending", created_at: new Date() },
      { id: "b", payment_id: "p2", event_type: "relay.send", status: "pending", created_at: new Date() },
    ]);
  });

  it("returns empty array when events array is empty", async () => {
    const result = await batchInsertEvents(db, []);
    expect(result).toEqual([]);
    expect(db.query).not.toHaveBeenCalled();
  });

  it("returns empty array when events is not an array", async () => {
    const result = await batchInsertEvents(db, null);
    expect(result).toEqual([]);
    expect(db.query).not.toHaveBeenCalled();
  });

  it("builds a single INSERT with multiple VALUE rows", async () => {
    const events = [
      { payment_id: "p1", event_type: "relay.send", payload: { foo: 1 }, status: "pending" },
      { payment_id: "p2", event_type: "relay.ack", payload: null, status: "pending" },
    ];
    await batchInsertEvents(db, events);
    expect(db.query).toHaveBeenCalledTimes(1);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain("INSERT INTO relay_events");
    // 2 events × 4 params each = 8 total
    expect(params).toHaveLength(8);
    expect(params[0]).toBe("p1");
    expect(params[1]).toBe("relay.send");
    expect(params[4]).toBe("p2");
  });

  it("serializes payload objects to JSON strings", async () => {
    const events = [
      { payment_id: "p1", event_type: "relay.send", payload: { amount: 100 }, status: "pending" },
    ];
    await batchInsertEvents(db, events);
    const [, params] = db.query.mock.calls[0];
    expect(params[2]).toBe(JSON.stringify({ amount: 100 }));
  });

  it("defaults status to 'pending' if not provided", async () => {
    const events = [{ payment_id: "p1", event_type: "relay.send", payload: null }];
    await batchInsertEvents(db, events);
    const [, params] = db.query.mock.calls[0];
    expect(params[3]).toBe("pending");
  });

  it("returns rows from the query result", async () => {
    const events = [
      { payment_id: "p1", event_type: "relay.send", payload: null, status: "pending" },
      { payment_id: "p2", event_type: "relay.ack", payload: null, status: "pending" },
    ];
    const result = await batchInsertEvents(db, events);
    expect(result).toHaveLength(2);
  });

  it("includes statement_timeout in the query", async () => {
    const events = [{ payment_id: "p1", event_type: "e", payload: null, status: "pending" }];
    await batchInsertEvents(db, events);
    const [sql] = db.query.mock.calls[0];
    expect(sql).toContain("statement_timeout");
  });
});

describe("dequeueNextEvent", () => {
  it("returns the first event row when queue has items", async () => {
    const event = { id: "x", payment_id: "p1", event_type: "relay.send", payload: null, created_at: new Date() };
    const db = makeDb([event]);
    const result = await dequeueNextEvent(db);
    expect(result).toEqual(event);
  });

  it("returns null when the queue is empty", async () => {
    const db = makeDb([]);
    const result = await dequeueNextEvent(db);
    expect(result).toBeNull();
  });

  it("issues a SELECT FOR UPDATE SKIP LOCKED query", async () => {
    const db = makeDb([]);
    await dequeueNextEvent(db);
    const [sql] = db.query.mock.calls[0];
    expect(sql).toContain("FOR UPDATE SKIP LOCKED");
  });

  it("updates status to processing in the same query", async () => {
    const db = makeDb([]);
    await dequeueNextEvent(db);
    const [sql] = db.query.mock.calls[0];
    expect(sql).toContain("status = 'processing'");
  });

  it("includes statement_timeout guard", async () => {
    const db = makeDb([]);
    await dequeueNextEvent(db);
    const [sql] = db.query.mock.calls[0];
    expect(sql).toContain("statement_timeout");
  });
});
