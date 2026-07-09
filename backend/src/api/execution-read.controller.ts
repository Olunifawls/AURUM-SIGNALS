import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { AdminTokenGuard } from '../common/admin-token.guard';
import { ExecutionReadService } from './execution-read.service';

/**
 * Execution read API for the L2 Execution page. Every route is admin-guarded
 * (L2 tables are anon-denied) — the Next server-side proxy injects the token.
 * There is NO live-switch endpoint anywhere.
 */
@UseGuards(AdminTokenGuard)
@Controller('api/execution')
export class ExecutionReadController {
  constructor(private readonly exec: ExecutionReadService) {}

  @Get('positions')
  positions() {
    return this.exec.positions();
  }

  @Get('orders')
  orders() {
    return this.exec.orders();
  }

  @Get('equity')
  equity() {
    return this.exec.equity();
  }

  @Get('risk-events')
  riskEvents() {
    return this.exec.riskEvents();
  }

  @Get('state')
  state() {
    return this.exec.stateSummary();
  }

  @Post('halt')
  halt() {
    return this.exec.setManualHalt();
  }

  /**
   * POST /api/execution/close — close a single open trade at market.
   * Admin-token gated (same guard as /halt). DEMO only (owner's own trade).
   * Body: { tradeId: string } — the broker trade ID (broker_trade_id from positions).
   */
  @Post('close')
  @HttpCode(200)
  close(@Body() body: { tradeId?: string }) {
    const tradeId = (body?.tradeId ?? '').trim();
    if (!tradeId) return { ok: false, error: 'tradeId is required' };
    return this.exec.closeTrade(tradeId);
  }
}
