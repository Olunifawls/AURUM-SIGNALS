import { CircuitBreaker } from './circuit-breaker';

describe('CircuitBreaker', () => {
  it('opens after threshold consecutive failures and reports justTripped', () => {
    const b = new CircuitBreaker('test', 3, 60_000);
    expect(b.isOpen(1_000)).toBe(false);
    b.recordFailure(1_000);
    b.recordFailure(1_000);
    expect(b.isOpen(1_000)).toBe(false);
    b.recordFailure(1_000);
    expect(b.justTripped()).toBe(true);
    expect(b.isOpen(1_000)).toBe(true);
  });

  it('allows a half-open probe after the cooldown window', () => {
    const b = new CircuitBreaker('test', 3, 60_000);
    b.recordFailure(1_000);
    b.recordFailure(1_000);
    b.recordFailure(1_000);
    expect(b.isOpen(1_000)).toBe(true); // still within cooldown
    expect(b.isOpen(1_000 + 60_000)).toBe(false); // cooldown elapsed -> probe allowed
  });

  it('resets on success', () => {
    const b = new CircuitBreaker('test', 3, 60_000);
    b.recordFailure();
    b.recordFailure();
    b.recordSuccess();
    expect(b.consecutiveFailures).toBe(0);
    expect(b.isOpen()).toBe(false);
  });
});
