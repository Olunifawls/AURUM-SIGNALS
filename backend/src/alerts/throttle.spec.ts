import { Throttle, ADMIN_THROTTLE_MS } from './throttle';

describe('(d) Throttle — max 1 per source per 30 min', () => {
  it('allows the first, blocks repeats within the window, allows after it', () => {
    const t = new Throttle(ADMIN_THROTTLE_MS);
    const t0 = 1_000_000;
    expect(t.allow('ingestion', t0)).toBe(true); // first
    expect(t.allow('ingestion', t0 + 60_000)).toBe(false); // 1 min later
    expect(t.allow('ingestion', t0 + 29 * 60_000)).toBe(false); // 29 min later
    expect(t.allow('ingestion', t0 + 31 * 60_000)).toBe(true); // 31 min later -> window elapsed
  });

  it('throttles per source independently', () => {
    const t = new Throttle(ADMIN_THROTTLE_MS);
    const t0 = 2_000_000;
    expect(t.allow('ingestion', t0)).toBe(true);
    expect(t.allow('indicators', t0)).toBe(true); // different source, allowed
    expect(t.allow('ingestion', t0)).toBe(false); // same source, blocked
  });

  it('a source firing 100 times in the window yields exactly 1 allowed', () => {
    const t = new Throttle(ADMIN_THROTTLE_MS);
    const t0 = 3_000_000;
    let allowed = 0;
    for (let i = 0; i < 100; i++) if (t.allow('spammy', t0 + i * 1000)) allowed++;
    expect(allowed).toBe(1);
  });
});
