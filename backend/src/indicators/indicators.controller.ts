import { BadRequestException, Controller, Param, Post } from '@nestjs/common';
import { IndicatorsService } from './indicators.service';
import { TIMEFRAMES, Timeframe } from '../ingestion/ingestion.constants';

/**
 * On-demand indicator recompute. Same testability/ops caveat as INC-1's manual
 * ingestion triggers: unauthenticated on this personal single-instance backend
 * — no extra auth scope is introduced here.
 */
@Controller('api/indicators')
export class IndicatorsController {
  constructor(private readonly indicators: IndicatorsService) {}

  @Post('compute/:tf')
  async compute(@Param('tf') tf: string) {
    if (!TIMEFRAMES.includes(tf as Timeframe)) {
      throw new BadRequestException(`unknown timeframe '${tf}' (allowed: ${TIMEFRAMES.join(', ')})`);
    }
    const values = await this.indicators.computeForTimeframe(tf as Timeframe);
    return { ok: true, timeframe: tf, computed: values != null, values };
  }
}
