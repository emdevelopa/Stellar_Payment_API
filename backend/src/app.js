import cors from "cors";
import express from "express";
import { Server as SocketIOServer } from "socket.io";
import swaggerUi from "swagger-ui-express";
import { ZodError } from "zod";
import { httpLogger, logger } from "./lib/logger.js";
import { createSwaggerSpec } from "./swagger.js";

import createPaymentsRouter from "./routes/payments.js";
import merchantsRouter from "./routes/merchants.js";
import metricsRouter from "./routes/metrics.js";
import webhooksRouter from "./routes/webhooks.js";
import prometheusRouter from "./routes/prometheus.js";
import sep0001Router from "./routes/sep0001.js";

import { requireApiKeyAuth } from "./lib/auth.js";
import { isHorizonReachable } from "./lib/stellar.js";
import { supabase } from "./lib/supabase.js";
import { pool } from "./lib/db.js";
import { formatZodError } from "./lib/request-schemas.js";
import { idempotencyMiddleware } from "./lib/idempotency.js";
import { setupSentryErrorHandler } from "./lib/sentry.js";
import {
  createRedisRateLimitStore,
  createVerifyPaymentRateLimit,
  createMerchantRegistrationRateLimit,
} from "./lib/rate-limit.js";

export async function createApp({ redisClient }) {
  const app = express();

  // Create socket.io instance (attached to HTTP server in server.js)
  const io = new SocketIOServer({
    cors: {
      origin: process.env.CORS_ALLOWED_ORIGINS
        ? process.env.CORS_ALLOWED_ORIGINS.split(",").map((o) => o.trim())
        : ["http://localhost:3000"],
      credentials: true,
    },
  });

  // Socket.io room management: clients join their merchant-specific room
  io.on("connection", (socket) => {
    socket.on("join:merchant", ({ merchant_id }) => {
      if (typeof merchant_id === "string" && merchant_id.length > 0) {
        socket.join(`merchant:${merchant_id}`);
      }
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
    }),
  );

  app.use(express.json({ limit: "1mb" }));
  // Structured JSON logging via pino-http (replaces morgan)
  app.use(httpLogger);
  // Expose the root logger on app.locals so routes can use req.log or app.locals.logger
  app.locals.logger = logger;

  // Health check
  app.get("/health", async (req, res) => {
    try {
      const [dbResult, horizonReachable] = await Promise.all([
        supabase.from("merchants").select("id").limit(1),
        isHorizonReachable(),
      ]);

      if (dbResult.error) {
        return res.status(503).json({
          ok: false,
          error: "Database unavailable",
          horizon_reachable: horizonReachable,
        });
      }

      if (!horizonReachable) {
        return res.status(503).json({
          ok: false,
          error: "Horizon unavailable",
          horizon_reachable: false,
        });
      }

      res.json({ ok: true, horizon_reachable: true });
    } catch {
      res.status(503).json({
        ok: false,
        error: "Health check failed",
        horizon_reachable: false,
      });
    }
  });

  const verifyPaymentRateLimit = createVerifyPaymentRateLimit({
    store: createRedisRateLimitStore({ client: redisClient }),
  });

  const merchantRegistrationRateLimit = createMerchantRegistrationRateLimit({
    store: createRedisRateLimitStore({ client: redisClient }),
  });

  app.use("/api/create-payment", requireApiKeyAuth());
  app.use("/api/create-payment", idempotencyMiddleware);
  app.use("/api/sessions", requireApiKeyAuth());
  app.use("/api/sessions", idempotencyMiddleware);
  app.use("/api/payments", requireApiKeyAuth());
  app.use("/api/rotate-key", requireApiKeyAuth());
  app.use("/api/merchant-branding", requireApiKeyAuth());
  app.use("/api/webhooks", requireApiKeyAuth());

  app.use("/api", createPaymentsRouter({ verifyPaymentRateLimit }));
  app.use("/api", createMerchantsRouter({ merchantRegistrationRateLimit }));
  app.use("/api", metricsRouter);
  app.use("/api", webhooksRouter);

  // SEP-0001 stellar.toml endpoint (public, no auth required)
  app.use("/", sep0001Router);

  // Prometheus Metrics endpoint
  app.use("/", prometheusRouter);

  // Sentry error handler — must come after all routes, before custom error handler
  setupSentryErrorHandler(app);

  app.use((err, req, res, next) => {
    if (err instanceof ZodError) {
      return res.status(400).json({ error: formatZodError(err) });
    }

    res.status(err.status || 500).json({
      error: err.message || "Internal Server Error",
    });
  });

  return { app, io };
}
