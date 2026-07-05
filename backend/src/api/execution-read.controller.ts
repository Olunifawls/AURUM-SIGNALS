import { Controller, Get, Post, UseGuards } from '@nestjs/common';
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
}
