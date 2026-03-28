/**
 * Optional Google reCAPTCHA v2/v3 verification middleware.
 *
 * When the environment variable RECAPTCHA_SECRET_KEY is set the middleware
 * verifies the `g-recaptcha-response` field in the request body against
 * Google's siteverify API.  When the variable is absent the middleware is a
 * transparent no-op, so deployments that haven't opted into reCAPTCHA are
 * unaffected.
 */

const GOOGLE_VERIFY_URL = "https://www.google.com/recaptcha/api/siteverify";

/**
 * Calls the Google siteverify endpoint and returns the parsed JSON response.
 *
 * @param {string} secret   The server-side reCAPTCHA secret key.
 * @param {string} token    The `g-recaptcha-response` token from the client.
 * @param {string} [remoteip] Optional request IP for extra validation.
 * @returns {Promise<{success: boolean, [key: string]: unknown}>}
 */
async function verifyCaptchaToken(secret, token, remoteip) {
  const params = new URLSearchParams({ secret, response: token });
  if (remoteip) params.append("remoteip", remoteip);

  const res = await fetch(GOOGLE_VERIFY_URL, {
    method: "POST",
    body: params,
  });

  return res.json();
}

/**
 * Express middleware factory.
 *
 * Usage:
 *   import { recaptchaMiddleware } from "../lib/recaptcha.js";
 *   router.post("/create-payment", recaptchaMiddleware(), ...);
 *
 * Configuration (env vars):
 *   RECAPTCHA_SECRET_KEY  – server-side secret.  Feature disabled when absent.
 *   RECAPTCHA_MIN_SCORE   – minimum v3 score (0.0 – 1.0), default 0.5.
 *                           Ignored for v2 tokens.
 */
export function recaptchaMiddleware() {
  const secret = process.env.RECAPTCHA_SECRET_KEY;

  // No secret configured → middleware is a transparent pass-through.
  if (!secret) {
    return (_req, _res, next) => next();
  }

  const minScore = parseFloat(process.env.RECAPTCHA_MIN_SCORE ?? "0.5");

  return async (req, res, next) => {
    const token = req.body?.["g-recaptcha-response"];

    if (!token) {
      return res.status(400).json({
        error: "reCAPTCHA token required",
        code: "RECAPTCHA_MISSING",
      });
    }

    try {
      const remoteip =
        req.ip ||
        req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
        undefined;

      const result = await verifyCaptchaToken(secret, token, remoteip);

      if (!result.success) {
        const codes = result["error-codes"] ?? [];
        return res.status(403).json({
          error: "reCAPTCHA verification failed",
          code: "RECAPTCHA_FAILED",
          details: codes,
        });
      }

      // reCAPTCHA v3 returns a score; v2 does not.
      if (typeof result.score === "number" && result.score < minScore) {
        return res.status(403).json({
          error: "reCAPTCHA score too low",
          code: "RECAPTCHA_SCORE_LOW",
          score: result.score,
        });
      }

      // Attach the verification result for downstream handlers.
      req.recaptcha = result;
      return next();
    } catch (err) {
      // Network or parse failure: fail open with a warning so a Google
      // outage never blocks legitimate payments.
      console.warn("reCAPTCHA verification error (failing open):", err.message);
      return next();
    }
  };
}
