# WebSocket Relay: Payload Sanitization & Strict Validation

Issue: #1452

The Socket.IO relay (`src/lib/websocket-relay-server.js`) lets merchant dashboards
join `merchant:<id>` rooms and checkout pages join `checkout:<id>` rooms. Every
inbound event now passes through a guard (`src/lib/websocket-relay-validation.js`)
before any handler runs.

## Inbound pipeline

1. **Engine limit.** `maxHttpBufferSize` is 16 KiB (the Socket.IO default is 1 MB). Larger frames close the connection.
2. **Event allow-list.** Only `join:merchant`, `join:checkout` and `leave:checkout` are accepted. Any other event gets `UNKNOWN_EVENT`.
3. **Shape check.** The payload must be a plain JSON object. A missing payload, `null`, an array or a primitive gets `INVALID_PAYLOAD`.
4. **Byte limit.** The serialised payload must be 4 KiB or less (`PAYLOAD_TOO_LARGE`).
5. **Deep sanitization** (`sanitizeRelayPayload`):
   - drops the `__proto__`, `constructor` and `prototype` keys at any depth
   - NFC-normalises strings and strips C0/C1 control characters and bidi overrides (`\t \n \r` are kept)
   - rejects non-finite numbers, BigInt, binary data and circular references
   - bounds depth (8), keys per object (64), array length (256) and string length (2048)
6. **Strict schema** (zod `.strict()`). Unknown keys are rejected. IDs must be UUIDs and are trimmed and lower-cased, so room names are canonical and cannot be injected (for example `"<uuid>:admin"`).

## Failure handling

| Situation | Behaviour |
| --- | --- |
| Invalid event, client sent an ack callback | `ack({ ok: false, event, error: { code, message, issues? } })` |
| Invalid event, no ack callback | `socket.emit("relay:error", { ok: false, event, error })` |
| Every rejection | `logger.warn` records the socket id, event, error code and violation count. The raw payload is never logged or echoed. |
| `WS_MAX_INVALID_EVENTS` rejections on one socket | The socket is disconnected. |
| A handler throws | The error is logged, the client gets `INTERNAL_ERROR`, and the process keeps running. |

Error codes: `UNKNOWN_EVENT`, `INVALID_PAYLOAD`, `PAYLOAD_TOO_LARGE`,
`VALIDATION_FAILED`, `PAYLOAD_TOO_DEEP`, `TOO_MANY_KEYS`, `ARRAY_TOO_LONG`,
`STRING_TOO_LONG`, `INVALID_NUMBER`, `INVALID_DATE`, `UNSUPPORTED_TYPE`,
`CIRCULAR_REFERENCE`, `UNSERIALIZABLE`, `INTERNAL_ERROR`.

## Outbound sanitization

`sanitizeOutboundPayload()` is applied to `checkout:presence` emits and to all
payment events from the Horizon poller (`notifyPaymentEvent`). It uses the same
rules with looser size limits. Data that came from Horizon or from merchant
metadata cannot push prototype keys, control characters or non-JSON values to
dashboards. If an outbound payload cannot be sanitized, it is dropped and a
warning is logged; nothing crashes.

`sanitizeRelayMessage()` in `websocket-relay-security.js` now also deep-sanitizes
the value of each allowed field.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `WS_MAX_HTTP_BUFFER_SIZE` | `16384` | Maximum inbound frame size in bytes |
| `WS_MAX_INVALID_EVENTS` | `10` | Invalid events allowed per socket before it is disconnected |

## Adding a new inbound event

Add a strict zod schema to `INBOUND_EVENT_SCHEMAS`, then register the handler with
`relay.on(event, handler)`. `createRelayGuard().on()` refuses events that have no schema.

## Security notes

- **Fixed:** a `join:*` event with no payload used to throw a destructuring `TypeError` inside the listener.
- **Fixed:** any non-empty string was accepted as a room ID. Arbitrary room names could be created, and the relay's memory could grow without bound.
- **Fixed:** frames up to 1 MB were accepted for events that need fewer than 100 bytes.
- **Out of scope:** `join:merchant` is still unauthenticated. Anyone who knows a merchant UUID can listen to that merchant's room. The follow-up is to require a JWT at handshake (`verifyRelayToken`) and check that the token's merchant matches the room.

## Tests

```
npx vitest run src/lib/websocket-relay-validation.test.js \
               src/lib/websocket-relay-server.test.js \
               src/lib/websocket-relay-security.test.js
```

`websocket-relay-server.test.js` starts a real Socket.IO server and drives it with
a raw WebSocket client that speaks the Engine.IO v4 / Socket.IO v5 wire protocol.
