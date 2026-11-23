/**
 * route-throughput-telemetry.js
 *
 * Per-route throughput telemetry for an Express router (#1770, #1775):
 * request count by status class, latency, and in-flight requests.
 *
 * Mounted with `router.use(...)` before the routes. It only records requests
 * that one of THIS router's routes will serve. Routers are mounted under a
 * shared prefix (`app.use("/api", ...)`), so the middleware also sees requests
 * that fall through to other routers, and those are ignored.
 *
 * Labels are the route PATTERN (`/payments/:id`), never the concrete URL, so
 * ids and query strings cannot inflate metric cardinality.
 */

function statusClass(status) {
  const n = Number(status);
  if (!Number.isInteger(n) || n < 100 || n > 599) return "unknown";
  return `${Math.floor(n / 100)}xx`;
}

function safe(fn) {
  try {
    fn();
  } catch {
    // Metrics must never break the request path.
  }
}

/**
 * Find the route pattern in `router` that will serve `req`, or null.
 * Evaluated per request because routes are registered after this middleware.
 */
export function matchRoutePattern(router, req) {
  const method = String(req.method || "").toLowerCase();
  for (const layer of router.stack) {
    const route = layer.route;
    if (!route) continue;
    const handles =
      route.methods?._all ||
      route.methods?.[method] ||
      (method === "head" && route.methods?.get);
    if (!handles) continue;
    if (layer.match(req.path)) return route.path;
  }
  return null;
}

/**
 * @param {{
 *   router: import("express").Router,
 *   requests: import("prom-client").Counter,   // labels: route, method, status_class
 *   duration: import("prom-client").Histogram, // labels: route, method
 *   inFlight: import("prom-client").Gauge,     // labels: route
 *   now?: () => bigint,
 * }} options
 */
export function createRouteThroughputTelemetry({ router, requests, duration, inFlight, now = process.hrtime.bigint }) {
  return function routeThroughputTelemetry(req, res, next) {
    let route;
    try {
      route = matchRoutePattern(router, req);
    } catch {
      route = null;
    }
    if (!route) return next();

    const method = String(req.method || "GET").toUpperCase();
    const startedAt = now();
    let done = false;
    safe(() => inFlight.inc({ route }));

    const finish = (aborted) => {
      if (done) return;
      done = true;
      safe(() => inFlight.dec({ route }));
      safe(() =>
        requests.inc({ route, method, status_class: aborted ? "aborted" : statusClass(res.statusCode) }),
      );
      safe(() => duration.observe({ route, method }, Number(now() - startedAt) / 1e9));
    };

    res.once("finish", () => finish(false));
    // "close" without a prior "finish" means the client went away first.
    res.once("close", () => finish(!res.writableFinished));
    return next();
  };
}
