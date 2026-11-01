import Anthropic from '@anthropic-ai/sdk';
import { EvidencePack } from './chief-analyst';

export const DEFAULT_ANALYST_MODEL = 'claude-haiku-5-5';
export const AI_TIMEOUT_MS = 20_000;
const MAX_TOKENS = 400;
/** Well under 100k tokens even at one token per character. A normal pack is about 1.2k. */
export const MAX_PACK_CHARS = 40_000;

const SYSTEM_PROMPT = [
  'You summarise a gold trade evidence pack for its owner, in plain English, in about 120 words.',
  'Use only facts stated in the pack. Add no outside knowledge, forecast or advice.',
  'Copy every number exactly as the pack writes it. If the pack does not state something, leave it out.',
  'Cover the direction, whether it is eligible, the main case for and against, the invalidation level, the target and any upcoming event risk.',
  'Reply with the summary only, as one paragraph.',
].join(' ');

/** A failure whose message is safe to store: a reason, never a raw SDK or API error. */
export class AiSummaryError extends Error {}

export interface AiSummary {
  text: string;
  model: string;
}

export interface AiSummaryResult extends AiSummary {
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
}

export type AiClient = Pick<Anthropic, 'messages'>;

/** One attempt only: SDK retries would stretch the time limit. */
export function analystClient(apiKey: string, fetchFn?: typeof fetch): Anthropic {
  return new Anthropic({ apiKey, timeout: AI_TIMEOUT_MS, maxRetries: 0, ...(fetchFn ? { fetch: fetchFn } : {}) });
}

export function analystModel(env: Record<string, string | undefined>): string {
  return env.ANALYST_MODEL?.trim() || DEFAULT_ANALYST_MODEL;
}

/** Numbers in the text that do not appear anywhere in the pack. */
export function unsupportedNumbers(summary: string, pack: EvidencePack): string[] {
  const source = JSON.stringify(pack);
  const numbers = summary.match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
  return numbers.map((n) => n.replace(/,/g, '').replace(/\.$/, '')).filter((n) => !source.includes(n));
}

/** The pack as the model sees it. Builds a new string, so the stored pack is untouched. */
export function packPrompt(pack: EvidencePack): string {
  const text = JSON.stringify(pack);
  return text.length <= MAX_PACK_CHARS ? text : `${text.slice(0, MAX_PACK_CHARS)} [pack truncated]`;
}

/** Haiku thinks by default and thinking counts against max_tokens, which would use up
 * a 400 cap and lose the reply. Newer Opus and Sonnet models reject this setting. */
const thinkingSetting = (model: string) => (model.startsWith('claude-haiku') ? { thinking: { type: 'disabled' as const } } : {});

function failureReason(err: unknown): string {
  if (err instanceof AiSummaryError) return err.message;
  if (err instanceof Anthropic.APIConnectionTimeoutError) return 'timeout';
  if (err instanceof Anthropic.APIConnectionError) return 'connection error';
  if (err instanceof Anthropic.APIError && err.status) return `HTTP ${err.status}`;
  return 'unexpected error';
}

/** The SDK's own timeout stops at the response headers, so this limit covers the body. */
async function withDeadline<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new AiSummaryError('timeout'));
      controller.abort();
    }, ms);
  });
  try {
    return await Promise.race([run(controller.signal), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/** One request for one summary. Throws AiSummaryError on any failure. Text only: it
 * reads the pack and writes nothing. */
export async function requestSummary(client: AiClient, model: string, pack: EvidencePack, timeoutMs: number = AI_TIMEOUT_MS): Promise<AiSummaryResult> {
  const started = Date.now();
  try {
    const response = await withDeadline(timeoutMs, (signal) =>
      client.messages.create(
        {
          model,
          max_tokens: MAX_TOKENS,
          output_config: { effort: 'low' },
          ...thinkingSetting(model),
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: packPrompt(pack) }],
        },
        { signal },
      ),
    );
    if (response.stop_reason !== 'end_turn') throw new AiSummaryError(`stop_reason ${response.stop_reason}`);
    const text = response.content
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('')
      .trim();
    if (!text) throw new AiSummaryError('empty reply');
    const unsupported = unsupportedNumbers(text, pack);
    if (unsupported.length) throw new AiSummaryError(`numbers not in the pack: ${unsupported.join(', ')}`);
    return { text, model, latencyMs: Date.now() - started, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };
  } catch (err) {
    throw new AiSummaryError(failureReason(err));
  }
}
