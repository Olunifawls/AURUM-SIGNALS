import { loadRepoEnv } from '../load-env';
import { analystClient, analystModel, requestSummary } from '../v1/chief/ai-summary';
import { EvidencePack } from '../v1/chief/chief-analyst';

/**
 * Sends ONE request through the real summary function with the fixed pack below and
 * prints what came back. It imports nothing that writes to the database, sends
 * Telegram or calls OANDA. Each run is one paid API call.
 */

const PREVIEW_CHARS = 300;

export const SAMPLE_PACK: EvidencePack = {
  ruleset: 'v1',
  evaluatedAt: '2027-03-02T12:00:00.000Z',
  signal: { timeframe: '4h', direction: 'BUY', entry: 4012.5, stop: 3990, target: 4057.5, createdAt: '2027-03-02T12:00:00.000Z' },
  eligible: true,
  caseFor: [
    'technical: L1 fired on 4h, the only timeframe eligible for execution.',
    'regime: Gold close 4012.70 is above its 50-day mean 3882.85.',
    'regime: The 50-day mean is rising (53.00 over ten bars).',
    'dollar: The dollar proxy has fallen over 20 bars (-0.03152), which allows a gold BUY.',
    'yields10y: USB10Y_USD changed 1.000 over 20 bars, so yields are falling.',
    'sentiment: Managed-money net 139500 sits at 100.0 on its 52-week index, and is rising over 4 reports (3600).',
  ],
  caseAgainst: ['yields2y: USB02Y_USD changed -0.400 over 20 bars, so yields are rising.'],
  noted: ['news: No tier-1 or tier-2 event in the next 72 hours.'],
  invalidationLevel: 3990,
  target: 4057.5,
  eventRisk: [],
  dataTimestamps: {
    technical: '2027-03-02T12:00:00.000Z',
    regime: '2027-03-01T00:00:00.000Z',
    dollar: '2027-03-01T00:00:00.000Z',
    yields10y: '2027-03-01T00:00:00.000Z',
    yields2y: '2027-03-01T00:00:00.000Z',
    sentiment: '2027-02-16',
    news: null,
  },
};

export interface AiSmokeOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** Returns the process exit code: 0 success, 1 failure, 2 no key. */
export async function runAiSmoke(env: Record<string, string | undefined>, log: (line: string) => void = console.log, options: AiSmokeOptions = {}): Promise<number> {
  const key = env.ANTHROPIC_API_KEY?.trim();
  if (!key) {
    log('ANTHROPIC_API_KEY must be set');
    return 2;
  }
  const model = analystModel(env);
  log(`AI smoke: 1 request, model ${model}, no database, no Telegram`);
  try {
    const result = await requestSummary(analystClient(key, options.fetch), model, SAMPLE_PACK, options.timeoutMs);
    log(`model:         ${result.model}`);
    log(`latency:       ${result.latencyMs} ms`);
    log(`input tokens:  ${result.inputTokens}`);
    log(`output tokens: ${result.outputTokens}`);
    log(`summary:       ${result.text.slice(0, PREVIEW_CHARS)}`);
    log('OK');
    return 0;
  } catch (err) {
    log(`FAILED: ${err instanceof Error ? err.message : 'unexpected error'}`);
    return 1;
  }
}

if (require.main === module) {
  loadRepoEnv();
  runAiSmoke(process.env).then(
    (code) => {
      process.exitCode = code;
    },
    () => {
      process.exitCode = 1;
    },
  );
}
