import { BadRequestException, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { SignalsService } from './signals.service';
import { TIMEFRAMES, Timeframe } from '../ingestion/ingestion.constants';
import { AdminTokenGuard } from '../common/admin-token.guard';

/**
 * On-demand signal evaluation. Same unauthenticated caveat as the INC-1/2
 * manual triggers on this personal single-instance backend — no new auth scope.
 */
@UseGuards(AdminTokenGuard)
@Controller('api/signals')
export class SignalsController {
  constructor(private readonly signals: SignalsService) {}

  @Post('evaluate/:tf')
  async evaluate(@Param('tf') tf: string) {
    if (!TIMEFRAMES.includes(tf as Timeframe)) {
      throw new BadRequestException(`unknown timeframe '${tf}' (allowed: ${TIMEFRAMES.join(', ')})`);
    }
    return this.signals.evaluateForTimeframe(tf as Timeframe);
  }
}
