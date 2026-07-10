import {
  formatNewSignal,
  formatResolution,
  shouldAlertSignal,
  isFeedStale,
  SAMPLE_ALERT_SIGNAL,
  AlertResolution,
} from './alert-format';

describe('(b) formatNewSignal — exact format', () => {
  it('matches the spec format including the sizing line', () => {
    const expected = [
      '🟡 GOLD SIGNAL — BUY (4h)',
      'Confluence: 5/6 ✅',
      'Entry:  2,341.20',
      'Stop:   2,332.80  (−8.40)',
      'Target: 2,358.00  (+16.80)',
      'R:R = 2.0',
      'Factors: Trend HTF ✓ Trend ✓ RSI ✓ MACD ✓ Structure ✓ Momentum ✗',
      'Your size: 0.02 lots  (risking ~£13.40 ≈ 0.7% of £2,000)',
      '⚠️ Analysis only — not financial advice. Manual execution.',
    ].join('\n');
    expect(formatNewSignal(SAMPLE_ALERT_SIGNAL)).toBe(expected);
  });

  it('SELL deltas flip sign correctly', () => {
    const out = formatNewSignal({
      ...SAMPLE_ALERT_SIGNAL,
      direction: 'SELL',
      entry: 2341.2,
      stop: 2349.6, // +8.40 above entry
      target: 2324.4, // −16.80 below entry
    });
    expect(out).toContain('Stop:   2,349.60  (+8.40)');
    expect(out).toContain('Target: 2,324.40  (−16.80)');
  });

  it('falls back to the too-small note when lots is 0/null', () => {
    const out = formatNewSignal({
      ...SAMPLE_ALERT_SIGNAL,
      suggestedLots: 0,
      riskAmountCcy: null,
      sizingNote: 'POSITION TOO SMALL — do not force this trade.',
    });
    expect(out).toContain('POSITION TOO SMALL');
  });
});

describe('(d) robust: missing FX/sizing degrades gracefully, never throws', () => {
  it('missing sizing/FX -> "unavailable" line, all other params intact', () => {
    const out = formatNewSignal({
      ...SAMPLE_ALERT_SIGNAL,
      suggestedLots: null,
      riskAmountCcy: null,
      sizingNote: undefined,
    });
    expect(out).toContain('Your size: unavailable (sizing/FX data missing).');
    expect(out).toContain('🟡 GOLD SIGNAL — BUY (4h)');
    expect(out).toContain('R:R = 2.0');
    expect(out).toContain('Factors: Trend HTF');
    expect(out).toContain('Analysis only');
  });

  it('an undefined numeric field (rr) does NOT throw and does not swallow the alert', () => {
    const bad = { ...SAMPLE_ALERT_SIGNAL, rr: undefined as unknown as number };
    expect(() => formatNewSignal(bad)).not.toThrow();
    const out = formatNewSignal(bad);
    expect(out).toContain('R:R = —');
    expect(out).toContain('🟡 GOLD SIGNAL');
  });
});

describe('(c) formatResolution — TP / SL / EXPIRED signed R', () => {
  const base: AlertResolution = { status: 'HIT_TP', direction: 'BUY', timeframe: '4h', entry: 2341.2, rMultiple: 2.0, track: 'core' };

  it('TP HIT', () => {
    expect(formatResolution(base)).toBe('✅ TP HIT — BUY 4h from 2,341.20 → +2.0R');
  });
  it('SL HIT', () => {
    expect(formatResolution({ ...base, status: 'HIT_SL', rMultiple: -1.0 })).toBe(
      '❌ SL HIT — BUY 4h from 2,341.20 → −1.0R',
    );
  });
  it('EXPIRED with signed R', () => {
    expect(formatResolution({ ...base, status: 'EXPIRED', rMultiple: 0.5 })).toBe(
      '⏳ EXPIRED — BUY 4h from 2,341.20 → +0.5R',
    );
  });
});

describe('(e) EXCLUSION — experimental 15min gated by ALERT_15MIN', () => {
  it('core always alerts', () => {
    expect(shouldAlertSignal('core', false)).toBe(true);
    expect(shouldAlertSignal('core', true)).toBe(true);
  });
  it('experimental alerts only when the flag is on', () => {
    expect(shouldAlertSignal('experimental', false)).toBe(false);
    expect(shouldAlertSignal('experimental', true)).toBe(true);
  });
});

describe('(g) HEARTBEAT — feed stale detection', () => {
  const now = new Date('2024-01-03T12:00:00Z'); // Wednesday
  it('is stale when market is open and no ingestion within 35 min (default threshold)', () => {
    const old = new Date(now.getTime() - 36 * 60_000).toISOString();
    expect(isFeedStale(old, now, true)).toBe(true);
  });
  it('is NOT stale for a single late bar (~21 min) — below the 35 min default threshold', () => {
    const latish = new Date(now.getTime() - 21 * 60_000).toISOString();
    expect(isFeedStale(latish, now, true)).toBe(false);
  });
  it('is NOT stale when ingestion is recent', () => {
    const recent = new Date(now.getTime() - 5 * 60_000).toISOString();
    expect(isFeedStale(recent, now, true)).toBe(false);
  });
  it('is NOT stale when the market is closed', () => {
    const old = new Date(now.getTime() - 60 * 60_000).toISOString();
    expect(isFeedStale(old, now, false)).toBe(false);
  });
  it('is stale when market open and there is no ingestion at all', () => {
    expect(isFeedStale(null, now, true)).toBe(true);
  });
});
