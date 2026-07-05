import { BadRequestException, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { IngestionService } from './ingestion.service';
import { TIMEFRAMES, Timeframe } from './ingestion.constants';
import { AdminTokenGuard } from '../common/admin-token.guard';

/**
 * Manual ingestion triggers. These exist to make the INC-1 Definition-of-Done
 * provable on demand (seed, idempotency, resilience) without waiting for the
 * scheduled crons. They call the same code paths the crons do:
 *   - /api/ingest/seed        bypasses the market-hours gate (seed semantics)
 *   - /api/ingest/timeframe/* respects the gate (cron semantics)
 *   - /api/ingest/fx          respects the gate (cron semantics)
 */
@UseGuards(AdminTokenGuard)
@Controller('api/ingest')
export class IngestionController {
  constructor(private readonly ingestion: IngestionService) {}

  @Post('seed')
  async seed() {
    await this.ingestion.seed();
    return { ok: true, health: this.ingestion.getHealth() };
  }

  @Post('timeframe/:tf')
  async timeframe(@Param('tf') tf: string) {
    if (!TIMEFRAMES.includes(tf as Timeframe)) {
      throw new BadRequestException(`unknown timeframe '${tf}' (allowed: ${TIMEFRAMES.join(', ')})`);
    }
    await this.ingestion.ingestTimeframe(tf as Timeframe);
    return { ok: true, health: this.ingestion.getHealth() };
  }

  @Post('fx')
  async fx() {
    await this.ingestion.ingestFx();
    return { ok: true, health: this.ingestion.getHealth() };
  }
}
