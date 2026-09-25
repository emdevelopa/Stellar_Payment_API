/**
 * websocket-relay-queries.js
 *
 * Optimized SQL query helpers for the WebSocket relay event store.
 *
 * Index recommendations (run once against your database):
 *
 *   -- Covering index for paginated relay event reads, ordered by creation time
 *   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_relay_events_created_at
 *     ON relay_events (created_at DESC);
 *
 *   -- Composite index for queue dequeue queries (status + created_at)
 *   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_relay_events_status_created
 *     ON relay_events (status, created_at ASC)
 *     WHERE status = 'pending';
 *
 *   -- Index for payment-scoped event lookups
 *   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_relay_events_payment_id
 *     ON relay_events (payment_id, created_at DESC);
 *
 * These partial/covering indexes keep relay reads fast even when the table
 * grows into the millions of rows.
 */

/**
 * Clamp and validate pagination parameters.
 * @param {number} limit - Requested limit
 * @param {number} offset - Requested offset
 * @returns {{ limit: number, offset: number }}
 */
function validatePaginationParams(limit, offset) {
  const parsedLimit = Number(limit);
  const safeLimit = Math.min(Math.max(1, Number.isFinite(parsedLimit) ? parsedLimit : 100), 1000);
  const parsedOffset = Number(offset);
  const safeOffset = Math.max(0, Number.isFinite(parsedOffset) ? parsedOffset : 0);
  return { limit: safeLimit, offset: safeOffset };
}

/**
 * Fetch the most recent relay events in descending creation order.
 *
 * Uses a paginated query so callers never pull unbounded result sets.
 * The covering index on (created_at DESC) ensures an index-only scan
 * on databases that support it.
 *
 * @param {object} db   - pg Pool or pg Client with a .query() method
 * @param {number} limit  - Maximum rows to return (default 100, max 1000)
 * @param {number} offset - Row offset for pagination (default 0)
 * @returns {Promise<object[]>}
 * @throws {Error} When database query fails
 */
async function getRecentEvents(db, limit = 100, offset = 0) {
  const { limit: safeLimit, offset: safeOffset } = validatePaginationParams(limit, offset);

  try {
    const { rows } = await db.query(
      `
      SET LOCAL statement_timeout = '5s';
      SELECT
        id,
        payment_id,
        event_type,
        payload,
        status,
        created_at
      FROM relay_events
      ORDER BY created_at DESC
      LIMIT $1
      OFFSET $2
      `,
      [safeLimit, safeOffset],
    );
    return rows || [];
  } catch (err) {
    const error = new Error(`Failed to fetch recent relay events: ${err.message}`);
    error.cause = err;
    throw error;
  }
}

/**
 * Validate event objects for batch insertion.
 * @param {object[]} events - Array of event objects
 * @throws {Error} When events contain invalid data
 */
function validateEvents(events) {
  if (!Array.isArray(events)) {
    throw new Error('Events must be an array');
  }
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (!event || typeof event !== 'object') {
      throw new Error(`Event at index ${i} must be a non-null object`);
    }
    if (typeof event.payment_id !== 'string' || !event.payment_id.trim()) {
      throw new Error(`Event at index ${i} must have a non-empty payment_id`);
    }
    if (typeof event.event_type !== 'string' || !event.event_type.trim()) {
      throw new Error(`Event at index ${i} must have a non-empty event_type`);
    }
  }
}

/**
 * Batch-insert multiple relay events in a single round-trip.
 *
 * Building one multi-row VALUES clause is significantly faster than
 * issuing N sequential INSERT statements, especially when N > 10,
 * because it eliminates per-statement network and parse overhead.
 *
 * @param {object}   db     - pg Pool or pg Client
 * @param {object[]} events - Array of event objects with:
 *                              { payment_id, event_type, payload, status }
 * @returns {Promise<object[]>} Inserted rows
 * @throws {Error} When events are invalid or database query fails
 */
async function batchInsertEvents(db, events) {
  if (!Array.isArray(events) || events.length === 0) {
    return [];
  }

  try {
    validateEvents(events);
  } catch (err) {
    const error = new Error(`Invalid events for batch insert: ${err.message}`);
    error.cause = err;
    throw error;
  }

  const values = [];
  const placeholders = events.map((event, i) => {
    const base = i * 4;
    values.push(
      event.payment_id,
      event.event_type,
      event.payload != null ? JSON.stringify(event.payload) : null,
      event.status || "pending",
    );
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, NOW())`;
  });

  const sql = `
    SET LOCAL statement_timeout = '5s';
    INSERT INTO relay_events (payment_id, event_type, payload, status, created_at)
    VALUES ${placeholders.join(", ")}
    RETURNING id, payment_id, event_type, status, created_at
  `;

  try {
    const { rows } = await db.query(sql, values);
    return rows || [];
  } catch (err) {
    const error = new Error(`Failed to batch insert relay events: ${err.message}`);
    error.cause = err;
    throw error;
  }
}

/**
 * Dequeue the next pending relay event using SELECT … FOR UPDATE SKIP LOCKED.
 *
 * SKIP LOCKED lets multiple consumers pull from the queue concurrently
 * without waiting on row locks held by other workers, which eliminates
 * the "thundering herd" lock contention common in naive queue designs.
 * The SET LOCAL statement_timeout prevents a worker from holding a lock
 * indefinitely when the database is slow.
 *
 * @param {object} db - pg Pool or pg Client
 * @returns {Promise<object|null>} The dequeued event row, or null if the queue is empty
 * @throws {Error} When database query fails
 */
async function dequeueNextEvent(db) {
  try {
    const { rows } = await db.query(`
      SET LOCAL statement_timeout = '5s';
      WITH next_event AS (
        SELECT id
        FROM relay_events
        WHERE status = 'pending'
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE relay_events
      SET status = 'processing'
      FROM next_event
      WHERE relay_events.id = next_event.id
      RETURNING relay_events.id, relay_events.payment_id, relay_events.event_type, relay_events.payload, relay_events.created_at
    `);
    return rows?.[0] || null;
  } catch (err) {
    const error = new Error(`Failed to dequeue relay event: ${err.message}`);
    error.cause = err;
    throw error;
  }
}

/**
 * Mark a relay event as completed.
 * @param {object} db - pg Pool or pg Client
 * @param {string} eventId - The event ID to mark as completed
 * @returns {Promise<object|null>} The updated event row
 * @throws {Error} When database query fails
 */
async function markEventComplete(db, eventId) {
  if (typeof eventId !== 'string' || !eventId.trim()) {
    throw new Error('Event ID must be a non-empty string');
  }

  try {
    const { rows } = await db.query(
      `
      SET LOCAL statement_timeout = '5s';
      UPDATE relay_events
      SET status = 'completed'
      WHERE id = $1 AND status = 'processing'
      RETURNING id, payment_id, status, created_at, updated_at
      `,
      [eventId],
    );
    return rows?.[0] || null;
  } catch (err) {
    const error = new Error(`Failed to mark relay event as complete: ${err.message}`);
    error.cause = err;
    throw error;
  }
}

/**
 * Mark a relay event as failed with an error message.
 * @param {object} db - pg Pool or pg Client
 * @param {string} eventId - The event ID to mark as failed
 * @param {string} reason - The reason for failure
 * @returns {Promise<object|null>} The updated event row
 * @throws {Error} When database query fails
 */
async function markEventFailed(db, eventId, reason) {
  if (typeof eventId !== 'string' || !eventId.trim()) {
    throw new Error('Event ID must be a non-empty string');
  }
  if (typeof reason !== 'string' || !reason.trim()) {
    throw new Error('Failure reason must be a non-empty string');
  }

  try {
    const { rows } = await db.query(
      `
      SET LOCAL statement_timeout = '5s';
      UPDATE relay_events
      SET status = 'failed', error_message = $2
      WHERE id = $1 AND status = 'processing'
      RETURNING id, payment_id, status, error_message, created_at, updated_at
      `,
      [eventId, reason],
    );
    return rows?.[0] || null;
  } catch (err) {
    const error = new Error(`Failed to mark relay event as failed: ${err.message}`);
    error.cause = err;
    throw error;
  }
}

export {
  getRecentEvents,
  batchInsertEvents,
  dequeueNextEvent,
  markEventComplete,
  markEventFailed,
  validatePaginationParams,
  validateEvents,
};
