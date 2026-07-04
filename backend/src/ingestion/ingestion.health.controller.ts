import { Controller, Get } from '@nestjs/common';
import { IngestionService, IngestionHealth } from './ingestion.service';

/**
 * GET /api/health — ingestion health: per-timeframe last successful ingestion,
 * last FX timestamp, per-source consecutive-error counts, and the `stale` flag.
 * (The plain GET /health liveness endpoint is unchanged.)
 */
@Controller('api/health')
export class IngestionHealthController {
  constructor(private readonly ingestion: IngestionService) {}

  @Get()
  health(): IngestionHealth {
    return this.ingestion.getHealth();
  }
}
