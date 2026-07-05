import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { SizingService } from './sizing.service';
import { AdminTokenGuard } from '../common/admin-token.guard';

/**
 * Sizing calculator (public, pure read-only), tier status (public read), and
 * risk_pct update (state-changing -> protected by AdminTokenGuard). No UI here
 * (INC-9).
 */
@Controller('api')
export class SizingController {
  constructor(private readonly sizing: SizingService) {}

  @Post('sizing/calculate')
  calculate(
    @Body()
    body: {
      account_size: number;
      account_ccy?: string;
      risk_pct: number;
      entry: number;
      stop: number;
      take_profit?: number;
      gbp_usd_rate: number;
    },
  ) {
    return this.sizing.calculate(body);
  }

  @Get('sizing/tier-status')
  tierStatus() {
    return this.sizing.tierStatus();
  }

  @UseGuards(AdminTokenGuard)
  @Post('settings/risk-pct')
  updateRiskPct(@Body() body: { risk_pct: number; acknowledgment?: string }) {
    return this.sizing.updateRiskPct(body.risk_pct, body.acknowledgment);
  }
}
