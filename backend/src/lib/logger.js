import pino from "pino";
import pinoHttp from "pino-http";

// Fields that must never appear in plain-text logs
const REDACTED_PATHS = [
  "req.headers['x-api-key']",
  "req.headers.authorization",
  "req.body.api_key",
  "req.body.webhook_secret",
  "res.headers['x-api-key']",
];

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  // In development emit pretty-printed output; in production emit newline-delimited JSON
  ...(process.env.NODE_ENV !== "production" && {
    transport: {
      target: "pino-pretty",
      options: { colorize: true, translateTime: "SYS:standard" },
    },
  }),
  redact: {
    paths: REDACTED_PATHS,
    censor: "[REDACTED]",
  },
  base: { pid: process.pid },
  timestamp: pino.stdTimeFunctions.isoTime,
});

/**
 * pino-http middleware — attaches `req.log` to every request and emits a
 * structured access log on response finish.  Propagates `x-request-id` so
 * every downstream log entry is correlated to a single HTTP transaction.
 */
export const httpLogger = pinoHttp({
  logger,
  // Use the incoming x-request-id header if present, otherwise generate one
  genReqId(req) {
    return req.headers["x-request-id"] || crypto.randomUUID();
  },
  // Attach the resolved request-id to the response for client visibility
  customSuccessMessage(req, res) {
    return `${req.method} ${req.url} completed`;
  },
  customErrorMessage(req, res, err) {
    return `${req.method} ${req.url} errored: ${err.message}`;
  },
  // Serializers control what goes into the structured log entry
  serializers: {
    req(req) {
      return {
        id: req.id,
        method: req.method,
        url: req.url,
        remoteAddress: req.remoteAddress,
        "x-request-id": req.headers["x-request-id"],
      };
    },
    res(res) {
      return { statusCode: res.statusCode };
    },
  },
  redact: {
    paths: REDACTED_PATHS,
    censor: "[REDACTED]",
  },
});
