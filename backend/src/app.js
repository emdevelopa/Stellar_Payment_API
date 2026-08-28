import cors from "cors";
import helmet from "helmet";
import express from "express";
import { Server as SocketIOServer } from "socket.io";
import swaggerUi from "swagger-ui-express";
import { ZodError } from "zod";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { httpLogger, logger } from "./lib/logger.js";
import { createSwaggerSpec } from "./swagger.js";

import createPaymentsRouter from "./routes/payments.js";
import createMerchantsRouter from "./routes/merchants.js";
import createMetricsRouter from "./routes/metrics.js";
import webhooksRouter from "./routes/webhooks.js";
import prometheusRouter from "./routes/prometheus.js";
import sep0001Router from "./routes/sep0001.js";
import createSep12Router from "./routes/sep12.js";
import trustlinesRouter from "./routes/trustlines.js";
import paymentDetailsRouter from "./routes/paymentDetails.js";
import x402Router from "./routes/x402.js";
import createAuthRouter from "./routes/auth.js";
import auditRouter from "./routes/audit.js";

import { requireApiKeyAuth } from "./lib/auth.js";
import { isHorizonReachable } from "./lib/stellar.js";
import { supabase } from "./lib/supabase.js";
import { pool } from "./lib/db.js";
import { x402Middleware } from "./middleware/x402.js";

import { idempotencyMiddleware } from "./lib/idempotency.js";
import { setupSentryErrorHandler } from "./lib/sentry.js";
import {
  createRedisRateLimitStore,
  createVerifyPaymentRateLimit,
  createMerchantRegistrationRateLimit,
  createSep10ChallengeRateLimit,
  createSep10VerifyRateLimit,
  createDashboardMetricsRateLimit,
} from "./lib/rate-limit.js";
import {
  createTransactionSignerMiddlewares,
  handleVerifySignature,
} from "./lib/transaction-signer.js";
import { versionDeprecationMiddleware } from "./lib/version-deprecation.js";
import oracleRouter from "./routes/oracle.js";

export async function createApp({ redisClient }) {
  const app = express();
  const redisAvailable = Boolean(redisClient && redisClient.isOpen);

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const publicDir = path.join(__dirname, "..", "public");

  // Create socket.io instance (attached to HTTP server in server.js)
  const io = new SocketIOServer({
    cors: {
      origin: process.env.CORS_ALLOWED_ORIGINS
        ? process.env.CORS_ALLOWED_ORIGINS.split(",").map((o) => o.trim())
        : ["http://localhost:3000"],
      credentials: true,
    },
  });

  const checkoutRoomName = (paymentId) => `checkout:${paymentId}`;
  const emitCheckoutPresence = (paymentId) => {
    const room = checkoutRoomName(paymentId);
    const activeViewers = io.sockets.adapter.rooms.get(room)?.size ?? 0;

    io.to(room).emit("checkout:presence", {
      payment_id: paymentId,
      active_viewers: activeViewers,
    });
  };

  // Socket.io room management: clients join their merchant-specific room
  io.on("connection", (socket) => {
    const joinedCheckoutRooms = new Set();

    socket.on("join:merchant", ({ merchant_id }) => {
      if (typeof merchant_id === "string" && merchant_id.length > 0) {
        socket.join(`merchant:${merchant_id}`);
      }
    });

    socket.on("join:checkout", ({ payment_id }) => {
      if (typeof payment_id !== "string" || payment_id.length === 0) {
        return;
      }

      const room = checkoutRoomName(payment_id);
      joinedCheckoutRooms.add(payment_id);
      socket.join(room);
      emitCheckoutPresence(payment_id);
    });

    socket.on("leave:checkout", ({ payment_id }) => {
      if (typeof payment_id !== "string" || payment_id.length === 0) {
        return;
      }

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

  // Make DB pool and io accessible on every request
  app.locals.pool = pool;
  app.locals.io = io;

  const port = process.env.PORT || 4000;

  const swaggerSpec = createSwaggerSpec({
    serverUrl: `http://localhost:${port}`,
  });

  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

  app.use(express.static(publicDir));

  app.get("/api/postman-collection.json", (req, res) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="postman-collection.json"',
    );
    res.sendFile(path.join(publicDir, "postman-collection.json"));
  });

  const allowedOrigins = process.env.CORS_ALLOWED_ORIGINS
    ? process.env.CORS_ALLOWED_ORIGINS.split(",").map((o) => o.trim())
    : ["http://localhost:3000"];

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        callback(new Error("Not allowed by CORS"));
      },
      credentials: true,
    })
  );

  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }));

  app.use(express.json({ limit: "1mb" }));

  // Explicit JSON parsing error handler
  app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
      return res.status(400).json({ error: "Invalid JSON payload" });
    }
    next(err);
  });
  // Structured JSON logging via pino-http (replaces morgan)
  app.use(httpLogger);
  // Expose the root logger on app.locals so routes can use req.log or app.locals.logger
  app.locals.logger = logger;

  // Root route for platform/browser checks.
  app.get("/", (_req, res) => {
    res.status(200).json({
      ok: true,
      service: "pluto-api",
      docs: "/api-docs",
      health: "/health",
      ready: "/ready",
    });
  });

  // Readiness probe for platforms (Railway, etc.).
  // Keep this independent from external dependency checks so orchestrators
  // don't restart a healthy process when Horizon/DB has transient issues.
  app.get("/ready", (_req, res) => {
    res.status(200).json({
      ok: true,
      service: "pluto-api",
      timestamp: new Date().toISOString(),
    });
  });

  // Health check
  /**
   * @swagger
   * /health:
   *   get:
   *     summary: Health check endpoint
   *     description: Check the health status of the API and its dependencies (database, Stellar Horizon)
   *     tags: [Health]
   *     security: []
   *     responses:
   *       200:
   *         description: API is healthy
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 ok:
   *                   type: boolean
   *                   description: Overall health status
   *                 horizon_reachable:
   *                   type: boolean
   *                   description: Whether Stellar Horizon is reachable
   *       503:
   *         description: Service unavailable - database or Horizon is unreachable
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 ok:
   *                   type: boolean
   *                 error:
   *                   type: string
   *                 horizon_reachable:
   *                   type: boolean
   */
  app.get("/health", async (req, res) => {
    const [dbResult, horizonReachable] = await Promise.allSettled([
      supabase.from("merchants").select("id").limit(1),
      isHorizonReachable(),
    ]);

    const dbOk = dbResult.status === "fulfilled" && !dbResult.value?.error;
    if (!dbOk) {
      console.error("Health DB error:", JSON.stringify(dbResult.reason || dbResult.value?.error));
    }
    const horizonOk = horizonReachable.status === "fulfilled" && horizonReachable.value === true;

    const status = dbOk && horizonOk ? 200 : 503;

    res.status(status).json({
      ok: dbOk && horizonOk,
      services: {
        database: dbOk ? "ok" : "unavailable",
        horizon: horizonOk ? "ok" : "unavailable",
        redis: redisAvailable ? "ok" : "unavailable",
      },
    });
  });

  const verifyPaymentRateLimit = createVerifyPaymentRateLimit({
    store: redisAvailable ? createRedisRateLimitStore({ client: redisClient }) : undefined,
  });

  const merchantRegistrationRateLimit = createMerchantRegistrationRateLimit({
    store: redisAvailable ? createRedisRateLimitStore({ client: redisClient }) : undefined,
  });

  const sep10RateLimitStore = redisAvailable
    ? createRedisRateLimitStore({ client: redisClient, prefix: "rl:sep10:" })
    : undefined;

  const authRouter = createAuthRouter({
    sep10ChallengeRateLimit: createSep10ChallengeRateLimit({ store: sep10RateLimitStore }),
    sep10VerifyRateLimit: createSep10VerifyRateLimit({ store: sep10RateLimitStore }),
  });

  const dashboardMetricsRateLimit = createDashboardMetricsRateLimit({
    store: redisAvailable
      ? createRedisRateLimitStore({ client: redisClient, prefix: "rl:dashboard:" })
      : undefined,
  });

  const metricsRouter = createMetricsRouter({ dashboardMetricsRateLimit });

  // x402 pay-per-request on payment creation endpoints (custom middleware flow)
  const x402Provider = process.env.X402_PROVIDER_PUBLIC_KEY;
  const x402Enabled = Boolean(x402Provider && process.env.X402_JWT_SECRET);
  const x402CreatePaymentAmount = process.env.X402_CREATE_PAYMENT_AMOUNT || "0.01";
  const x402EnforceDefault = String(process.env.X402_ENFORCE_DEFAULT || "false").toLowerCase() === "true";

  if (x402Enabled) {
    const requireCreatePaymentCharge = x402Middleware({
      amount: x402CreatePaymentAmount,
      recipient: x402Provider,
      memo_prefix: "pluto-create",
      enforceByDefault: x402EnforceDefault,
    });

    app.use("/api/create-payment", requireCreatePaymentCharge);
    app.use("/api/sessions", requireCreatePaymentCharge);
  }

  app.use(
    "/api/create-payment",
    requireApiKeyAuth(),
    idempotencyMiddleware
  );
  app.use(
    "/api/sessions",
    requireApiKeyAuth(),
    idempotencyMiddleware
  );
  app.use("/api/payments", requireApiKeyAuth(), idempotencyMiddleware);
  app.use("/api/rotate-key", requireApiKeyAuth(), idempotencyMiddleware);
  app.use("/api/merchant-branding", requireApiKeyAuth(), idempotencyMiddleware);
  app.use("/api/webhooks", requireApiKeyAuth(), idempotencyMiddleware);

  app.use("/api", createPaymentsRouter({ verifyPaymentRateLimit }));
  app.use("/api", createMerchantsRouter({ merchantRegistrationRateLimit }));
  app.use("/api", authRouter);
  app.use("/api", metricsRouter);
  app.use("/api", webhooksRouter);
  app.use("/api", auditRouter);
  app.use("/api/payments", paymentDetailsRouter); // NEW — GET /api/payments/:id

  // Transaction Signer — authenticated, rate-limited signature verification endpoint (#912)
  // requireApiKeyAuth() is mandatory here: the endpoint triggers Horizon API calls and
  // must not be reachable by unauthenticated parties. Rate limiters run after auth so
  // that only authenticated actors consume budget.
  const transactionSignerMiddlewares = createTransactionSignerMiddlewares({
    redisClient: redisAvailable ? redisClient : undefined,
  });
  app.post(
    "/api/verify-signature",
    requireApiKeyAuth(),
    ...transactionSignerMiddlewares,
    handleVerifySignature,
  );

  // SEP-0001 stellar.toml endpoint (public, no auth required)
  app.use("/", sep0001Router);

  // SEP-12 KYC endpoints (signature-gated; auth enforced per-request)
  app.use("/", createSep12Router({
    redisStore: redisAvailable ? createRedisRateLimitStore({ client: redisClient, prefix: "rl:sep12:" }) : undefined,
  }));
  app.use("/api/trustlines", trustlinesRouter);

  // Prometheus Metrics endpoint
  app.use("/", prometheusRouter);

  // x402 pay-per-request verification (public — agents call this)
  app.use("/api", x402Router);

  // Smart Contract Oracle Integrator endpoints
  app.use("/", oracleRouter);

  // Sentry error handler — must come after all routes, before custom error handler
  setupSentryErrorHandler(app);

  app.use((err, req, res, next) => {
    console.error("EXPRESS ERROR LOG:", err);
    res.status(err.status || 500).json({
      error: err.message || "Internal Server Error",
    });
  });

  app.use(versionDeprecationMiddleware);

  return { app, io };
}
