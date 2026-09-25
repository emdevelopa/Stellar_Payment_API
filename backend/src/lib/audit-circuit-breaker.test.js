import { describe, it, expect, vi, beforeEach } from "vitest";
import { AuditCircuitBreaker, CircuitState } from "./audit-circuit-breaker.js";

describe("AuditCircuitBreaker", () => {
  let cb;
  let onCloseMock;

  beforeEach(() => {
    onCloseMock = vi.fn();
    cb = new AuditCircuitBreaker({
      failureThreshold: 3,
      resetTimeoutMs: 1000,
      halfOpenRequired: 2,
      label: "test-breaker",
      onClose: onCloseMock,
    });
  });

  it("should start in CLOSED state", () => {
    expect(cb.state).toBe(CircuitState.CLOSED);
    expect(cb.isOpen()).toBe(false);
  });

  it("should transition to OPEN after reaching failureThreshold in CLOSED", () => {
    cb.recordFailure();
    expect(cb.state).toBe(CircuitState.CLOSED);
    cb.recordFailure();
    expect(cb.state).toBe(CircuitState.CLOSED);
    cb.recordFailure();
    expect(cb.state).toBe(CircuitState.OPEN);
    expect(cb.isOpen()).toBe(true);
  });

  it("should reset failures on success in CLOSED state", () => {
    cb.recordFailure();
    cb.recordFailure();
    cb.recordSuccess();
    cb.recordFailure();
    expect(cb.state).toBe(CircuitState.CLOSED);
  });

  it("should transition from OPEN to HALF_OPEN after timeout", () => {
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.state).toBe(CircuitState.OPEN);

    // Timeout not met yet
    const now = Date.now();
    expect(cb.isOpen(now)).toBe(true);

    // Timeout met
    expect(cb.isOpen(now + 1001)).toBe(false);
    expect(cb.state).toBe(CircuitState.HALF_OPEN);
  });

  it("should transition from HALF_OPEN back to OPEN on failure", () => {
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    cb.isOpen(Date.now() + 1001); // transitions to HALF_OPEN

    cb.recordFailure();
    expect(cb.state).toBe(CircuitState.OPEN);
    expect(cb.isOpen()).toBe(true);
  });

  it("should transition from HALF_OPEN back to CLOSED on consecutive successes", () => {
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    cb.isOpen(Date.now() + 1001); // transitions to HALF_OPEN

    cb.recordSuccess();
    expect(cb.state).toBe(CircuitState.HALF_OPEN);
    expect(onCloseMock).not.toHaveBeenCalled();

    cb.recordSuccess();
    expect(cb.state).toBe(CircuitState.CLOSED);
    expect(onCloseMock).toHaveBeenCalledOnce();
  });

  it("should reset breaker states fully when reset() is called", () => {
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.state).toBe(CircuitState.OPEN);

    cb.reset();
    expect(cb.state).toBe(CircuitState.CLOSED);
    expect(cb.failures).toBe(0);
    expect(cb.openedAt).toBeNull();
    expect(cb.halfOpenSuccesses).toBe(0);
  });
});
