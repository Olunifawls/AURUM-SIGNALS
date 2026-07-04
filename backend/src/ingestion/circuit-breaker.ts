import { Injectable } from '@nestjs/common';

export const CIRCUIT_THRESHOLD = 3;
export const CIRCUIT_COOLDOWN_MS = 60_000;

/**
 * Per-source circuit breaker. After `threshold` consecutive failures the
 * breaker is OPEN and cycles should be skipped, until `cooldownMs` has elapsed
 * (half-open probe), at which point one attempt is allowed again. A success
 * resets the failure count.
 */
export class CircuitBreaker {
  consecutiveFailures = 0;
  lastFailureAt = 0;

  constructor(
    public readonly name: string,
    public readonly threshold: number = CIRCUIT_THRESHOLD,
    public readonly cooldownMs: number = CIRCUIT_COOLDOWN_MS,
  ) {}

  isOpen(now: number = Date.now()): boolean {
    if (this.consecutiveFailures < this.threshold) return false;
    // Allow a half-open probe once the cooldown window passes.
    return now - this.lastFailureAt < this.cooldownMs;
  }

  recordSuccess(): void {
    this.consecutiveFailures = 0;
  }

  recordFailure(now: number = Date.now()): void {
    this.consecutiveFailures += 1;
    this.lastFailureAt = now;
  }

  /** True on exactly the failure that reaches the threshold (breaker trips). */
  justTripped(): boolean {
    return this.consecutiveFailures === this.threshold;
  }
}

@Injectable()
export class CircuitBreakerRegistry {
  private readonly breakers = new Map<string, CircuitBreaker>();

  get(name: string): CircuitBreaker {
    let breaker = this.breakers.get(name);
    if (!breaker) {
      breaker = new CircuitBreaker(name);
      this.breakers.set(name, breaker);
    }
    return breaker;
  }

  snapshot(): Record<string, { consecutiveErrors: number; circuitOpen: boolean }> {
    const out: Record<string, { consecutiveErrors: number; circuitOpen: boolean }> = {};
    for (const [name, b] of this.breakers) {
      out[name] = { consecutiveErrors: b.consecutiveFailures, circuitOpen: b.isOpen() };
    }
    return out;
  }
}
