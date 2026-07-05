/**
 * Simple per-key time-window throttle. `allow(key)` returns true at most once
 * per `windowMs` for a given key.
 */
export class Throttle {
  private readonly last = new Map<string, number>();

  constructor(private readonly windowMs: number) {}

  allow(key: string, now: number = Date.now()): boolean {
    const prev = this.last.get(key);
    if (prev != null && now - prev < this.windowMs) return false;
    this.last.set(key, now);
    return true;
  }
}

export const ADMIN_THROTTLE_MS = 30 * 60 * 1000; // 1 per source per 30 min
