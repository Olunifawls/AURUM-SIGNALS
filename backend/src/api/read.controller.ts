import { Controller, Get, Query } from '@nestjs/common';
import { ReadService } from './read.service';
import { HealthService } from './health.service';

/**
 * Public read-only API for the dashboard (INC-9). These GET endpoints expose
 * only non-sensitive computed data and require no authentication.
 */
@Controller('api')
export class ReadController {
  constructor(
    private readonly read: ReadService,
    private readonly health: HealthService,
  ) {}

  @Get('signals')
  signals(@Query('status') status?: string, @Query('limit') limit?: string) {
    return this.read.listSignals(status, limit != null ? Number(limit) : undefined);
  }

  @Get('signals/active')
  active() {
    return this.read.activeSignals();
  }

  @Get('performance')
  performance() {
    return this.read.performance();
  }

  @Get('market/snapshot')
  marketSnapshot() {
    return this.read.marketSnapshot();
  }

  @Get('health')
  getHealth() {
    return this.health.getHealth();
  }
}
