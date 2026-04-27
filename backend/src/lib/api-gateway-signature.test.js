import { describe, expect, it } from "vitest";
import {
  signApiGatewayRequest,
  verifyApiGatewayRequestSignature,
} from "./api-gateway-signature.js";

describe("api-gateway-signature", () => {
  it("signs and verifies request payloads", () => {
    const timestamp = 1713916800;
    const secret = "test-api-key";

    const signature = signApiGatewayRequest({
      secret,
      method: "POST",
      path: "/api/payments",
      timestamp,
      body: { amount: 12.5, asset: "USDC" },
    });

    const result = verifyApiGatewayRequestSignature({
      secret,
      method: "POST",
      path: "/api/payments",
      timestampHeader: String(timestamp),
      signatureHeader: `sha256=${signature}`,
      body: { amount: 12.5, asset: "USDC" },
      now: timestamp * 1000,
    });

    expect(result).toEqual({ valid: true });
  });

  it("rejects signatures outside timestamp tolerance", () => {
    const timestamp = 1713916800;
    const secret = "test-api-key";

    const signature = signApiGatewayRequest({
      secret,
      method: "GET",
      path: "/api/metrics/summary",
      timestamp,
      body: {},
    });

    const result = verifyApiGatewayRequestSignature({
      secret,
      method: "GET",
      path: "/api/metrics/summary",
      timestampHeader: String(timestamp),
      signatureHeader: `sha256=${signature}`,
      body: {},
      now: (timestamp + 900) * 1000,
      toleranceSeconds: 300,
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/outside the accepted window/i);
  });

  it("rejects malformed signature headers", () => {
    const result = verifyApiGatewayRequestSignature({
      secret: "abc",
      method: "GET",
      path: "/health",
      timestampHeader: "1713916800",
      signatureHeader: "not-a-signature",
      body: {},
      now: 1713916800 * 1000,
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/invalid x-api-signature/i);
  });
});
