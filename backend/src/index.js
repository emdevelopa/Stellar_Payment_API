import 'dotenv/config';
import express from "express";
import morgan from "morgan";
import cors from "cors";
import swaggerJsdoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";
import { ZodError } from "zod";
import paymentsRouter from "./routes/payments.js";
import merchantsRouter from "./routes/merchants.js";
import { requireApiKeyAuth } from "./lib/auth.js";
import { supabase } from "./lib/supabase.js";
import { pool, closePool } from "./lib/db.js";
import { validateEnvironmentVariables } from "./lib/env-validation.js";
import { formatZodError } from "./lib/request-schemas.js";

validateEnvironmentVariables();

const app = express();
const port = process.env.PORT || 4000;

// Make the pool available to all routes via req.app.locals.pool
app.locals.pool = pool;

const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Stellar Payment API",
      version: "0.1.0",
      description: "API for creating and verifying Stellar network payments"
    },
    servers: [{ url: `http://localhost:${port}` }]
  },
  apis: ["./src/routes/*.js"]
});

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

const allowedOrigins = process.env.CORS_ALLOWED_ORIGINS
  ? process.env.CORS_ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:3000'];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

app.use(express.json({ limit: "1mb" }));
app.use(morgan("dev"));

app.get("/health", async (req, res) => {
  try {
    const { error } = await supabase.from("merchants").select("id").limit(1);

    if (error) {
      return res.status(503).json({
        ok: false,
        service: "stellar-payment-api",
        error: "Database unavailable"
      });
    }

    res.json({ ok: true, service: "stellar-payment-api" });
  } catch {
    res.status(503).json({
      ok: false,
      service: "stellar-payment-api",
      error: "Database unavailable"
    });
  }
});

app.use("/api/create-payment", requireApiKeyAuth());
app.use("/api/rotate-key", requireApiKeyAuth());
app.use("/api", paymentsRouter);
app.use("/api", merchantsRouter);

app.use((err, req, res, next) => {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: formatZodError(err)
    });
  }

  const status = err.status || 500;
  res.status(status).json({
    error: err.message || "Internal Server Error"
  });
});

// Verify pg pool reaches Postgres before accepting traffic
pool.query('SELECT 1').then(() => {
  console.log('✅ pg pool connected (Supabase pooler)');
}).catch((err) => {
  console.warn('⚠️  pg pool probe failed — check DATABASE_URL:', err.message);
});

const server = app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});

// Graceful shutdown: drain in-flight queries then exit
function shutdown(signal) {
  console.log(`${signal} received — closing server and pg pool...`);
  server.close(async () => {
    await closePool();
    console.log('pg pool closed. Goodbye.');
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
