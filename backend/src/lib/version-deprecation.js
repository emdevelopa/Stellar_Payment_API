export function versionDeprecationMiddleware(req, res, next) {
  const requestedVersion = req.headers["x-api-version"] || "v1";
  const latestVersion = "v2";

  if (requestedVersion !== latestVersion) {
    res.set("X-API-Warn", "Deprecation pending");
  }

  next();
}