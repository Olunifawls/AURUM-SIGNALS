import { Injectable } from '@nestjs/common';
import { SystemEventsService } from '../../common/system-events.service';
import { AiClient, AiSummary, AI_TIMEOUT_MS, analystClient, analystModel, requestSummary } from './ai-summary';
import { EvidencePack } from './chief-analyst';

const EVENT_SOURCE = 'v1';

/**
 * Optional plain-English summary of an evidence pack. Text only: it is written after
 * eligibility is stored and can never change it. It never throws: any failure is one
 * WARN and a null, so the evaluation stands and the alert goes without a summary.
 */
@Injectable()
export class AiSummaryService {
  protected readonly timeoutMs: number = AI_TIMEOUT_MS;

  constructor(private readonly events: SystemEventsService) {}

  protected client(apiKey: string): AiClient {
    return analystClient(apiKey);
  }

  async summarise(pack: EvidencePack): Promise<AiSummary | null> {
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    if (!apiKey) return this.failed('ANTHROPIC_API_KEY not set');
    try {
      const { text, model } = await requestSummary(this.client(apiKey), analystModel(process.env), pack, this.timeoutMs);
      return { text, model };
    } catch (err) {
      return this.failed(err instanceof Error ? err.message : 'unexpected error');
    }
  }

  private async failed(reason: string): Promise<null> {
    await this.events.warn(EVENT_SOURCE, `AI summary failed: ${reason}`, { reason }).catch(() => undefined);
    return null;
  }
}
