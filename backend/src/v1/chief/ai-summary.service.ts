import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { EvidencePack } from './chief-analyst';

export const DEFAULT_ANALYST_MODEL = 'claude-haiku-5-5';
const TIMEOUT_MS = 20_000;
const MAX_TOKENS = 4096; // thinking counts against this, and a truncated reply is discarded

const SYSTEM_PROMPT = [
  'You summarise a gold trade evidence pack for its owner, in plain English, in about 120 words.',
  'Use only facts stated in the pack. Add no outside knowledge, forecast or advice.',
  'Copy every number exactly as the pack writes it. If the pack does not state something, leave it out.',
  'Cover the direction, whether it is eligible, the main case for and against, the invalidation level, the target and any upcoming event risk.',
  'Reply with the summary only, as one paragraph.',
].join(' ');

/** Numbers in the text that do not appear anywhere in the pack. */
export function unsupportedNumbers(summary: string, pack: EvidencePack): string[] {
  const source = JSON.stringify(pack);
  const numbers = summary.match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
  return numbers.map((n) => n.replace(/,/g, '').replace(/\.$/, '')).filter((n) => !source.includes(n));
}

export interface AiSummary {
  text: string;
  model: string;
}

/**
 * Optional plain-English summary of an evidence pack. Text only: it is written after
 * eligibility is stored and can never change it. Returns null on any failure, and
 * when ANTHROPIC_API_KEY is unset, so the pack is simply stored without one.
 */
@Injectable()
export class AiSummaryService {
  private readonly logger = new Logger('AiSummary');

  /** One attempt only: SDK retries would stretch the 20s limit. */
  protected client(apiKey: string): Pick<Anthropic, 'messages'> {
    return new Anthropic({ apiKey, timeout: TIMEOUT_MS, maxRetries: 0 });
  }

  async summarise(pack: EvidencePack): Promise<AiSummary | null> {
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    if (!apiKey) return null;
    const model = process.env.ANALYST_MODEL?.trim() || DEFAULT_ANALYST_MODEL;
    try {
      const response = await this.client(apiKey).messages.create({
        model,
        max_tokens: MAX_TOKENS,
        output_config: { effort: 'low' },
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: JSON.stringify(pack) }],
      });
      if (response.stop_reason !== 'end_turn') {
        this.logger.warn(`summary discarded: stop_reason ${response.stop_reason}`);
        return null;
      }
      const text = response.content
        .map((block) => (block.type === 'text' ? block.text : ''))
        .join('')
        .trim();
      if (!text) return null;
      const unsupported = unsupportedNumbers(text, pack);
      if (unsupported.length) {
        this.logger.warn(`summary discarded: numbers not in the pack: ${unsupported.join(', ')}`);
        return null;
      }
      return { text, model };
    } catch (err) {
      this.logger.warn(`summary failed: ${err instanceof Error ? err.name : 'unknown error'}`);
      return null;
    }
  }
}
