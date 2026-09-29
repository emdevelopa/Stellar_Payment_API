/**
 * websocket-relay-server.js
 *
 * Builds the Socket.IO relay server used for merchant dashboards and checkout
 * presence. Every inbound event goes through the relay guard, which sanitizes
 * and strictly validates the payload before any room is joined (issue #1452).
 */

import { Server as SocketIOServer } from "socket.io";
import {
  createRelayGuard,
  sanitizeOutboundPayload,
  DEFAULT_MAX_VIOLATIONS,
} from "./websocket-relay-validation.js";

/** Inbound relay events are tiny room joins; the socket.io default is 1 MB. */
export const DEFAULT_WS_MAX_HTTP_BUFFER_SIZE = 16 * 1024;

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const checkoutRoomName = (paymentId) => `checkout:${paymentId}`;

/**
 * Register the relay's connection handlers on an existing Socket.IO server.
 *
 * @param {import("socket.io").Server} io
 * @param {object} [opts]
 * @param {{ warn: Function, error: Function }} [opts.logger]
 * @param {number} [opts.maxViolations] - Invalid events tolerated per socket
 */
export function attachRelayHandlers(io, opts = {}) {
  const emitCheckoutPresence = (paymentId) => {
    const room = checkoutRoomName(paymentId);
    const activeViewers = io.sockets.adapter.rooms.get(room)?.size ?? 0;

    io.to(room).emit(
      "checkout:presence",
      sanitizeOutboundPayload({
        payment_id: paymentId,
        active_viewers: activeViewers,
      }),
    );
  };

  io.on("connection", (socket) => {
    const joinedCheckoutRooms = new Set();
    const relay = createRelayGuard(socket, {
      logger: opts.logger,
      maxViolations: opts.maxViolations,
    });

    relay.on("join:merchant", ({ merchant_id }) => {
      socket.join(`merchant:${merchant_id}`);
    });

    relay.on("join:checkout", ({ payment_id }) => {
      joinedCheckoutRooms.add(payment_id);
      socket.join(checkoutRoomName(payment_id));
      emitCheckoutPresence(payment_id);
    });

    relay.on("leave:checkout", ({ payment_id }) => {
      joinedCheckoutRooms.delete(payment_id);
      socket.leave(checkoutRoomName(payment_id));
      emitCheckoutPresence(payment_id);
    });

    socket.on("disconnect", () => {
      for (const paymentId of joinedCheckoutRooms) {
        emitCheckoutPresence(paymentId);
      }
      joinedCheckoutRooms.clear();
    });
  });

  return io;
}

/**
 * Create the relay Socket.IO server (attached to the HTTP server in server.js).
 *
 * Environment:
 *   WS_MAX_HTTP_BUFFER_SIZE - max inbound frame size in bytes (default 16 KiB)
 *   WS_MAX_INVALID_EVENTS   - invalid events before a socket is disconnected (default 10)
 *
 * @param {object} opts
 * @param {string[]} opts.corsOrigins
 * @param {{ warn: Function, error: Function }} [opts.logger]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @returns {import("socket.io").Server}
 */
export function createRelayServer({ corsOrigins, logger, env = process.env }) {
  const io = new SocketIOServer({
    cors: { origin: corsOrigins, credentials: true },
    maxHttpBufferSize: parsePositiveInt(
      env.WS_MAX_HTTP_BUFFER_SIZE,
      DEFAULT_WS_MAX_HTTP_BUFFER_SIZE,
    ),
  });

  return attachRelayHandlers(io, {
    logger,
    maxViolations: parsePositiveInt(env.WS_MAX_INVALID_EVENTS, DEFAULT_MAX_VIOLATIONS),
  });
}
