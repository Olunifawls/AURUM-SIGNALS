import { Body, Controller, HttpCode, Logger, Post, UseGuards } from '@nestjs/common';
import { AdminTokenGuard } from '../common/admin-token.guard';
import { AdminResetService } from './admin-reset.service';
import { CircuitBreakerService } from '../killswitch/circuit-breaker.service';

/**
 * FIX-2 admin reset endpoint (AdminTokenGuard — server-side only).
 * POST /api/admin/ledger-reset — flatten OANDA, wipe contaminated ledger,
 * re-baseline equity. Triple-gated:
 *   1. Header: X-Admin-Token: <ADMIN_API_TOKEN>
 *   2. TRADING_MODE must NOT be "live" (hard-refuses — never runs against real money)
 *   3. Body: { "confirm": "WIPE_LEDGER_DEMO" }
 * DEMO ONLY.
 */
@UseGuards(AdminTokenGuard)
@Controller('api/admin')
export class AdminResetController {
  private readonly logger = new Logger('AdminReset');

  constructor(
    private readonly svc: AdminResetService,
    private readonly breakers: CircuitBreakerService,
  ) {}

  @Post('ledger-reset')
  @HttpCode(200)
  async ledgerReset(@Body() body: { confirm?: string }) {
    // Hard-refuse when live — this endpoint must never wipe a real-money ledger.
    if ((process.env.TRADING_MODE ?? '').trim().toLowerCase() === 'live') {
      this.logger.error('ledger-reset BLOCKED: TRADING_MODE=live');
      return { ok: false, error: 'REFUSED: TRADING_MODE=live. This endpoint is DEMO-only and will never run against a live account.' };
    }
    if (body?.confirm !== 'WIPE_LEDGER_DEMO') {
      return { ok: false, error: 'Send body { "confirm": "WIPE_LEDGER_DEMO" } to proceed.' };
    }
    this.logger.warn('FIX-2 ledger-reset triggered via admin endpoint (DEMO)');
    const result = await this.svc.ledgerReset();
    return { ok: true, ...result };
  }

  /**
   * POST /api/admin/test-breaker — fire VOLATILITY_COOLDOWN or SESSION_GAP with
   * caller-supplied synthetic inputs. Used to prove end-to-end: sets halt,
   * logs risk_event, sends Telegram, so the next assess() call rejects at the
   * right check. DEMO ONLY. Triple-gated (token + TRADING_MODE + confirm).
   *
   * Body: { "breaker": "VOLATILITY_COOLDOWN"|"SESSION_GAP",
   *         "confirm": "TEST_FIRE_DEMO",
   *         "inputs": { ...numeric fields per evalVolatility or evalSessionGap } }
   */
  @Post('test-breaker')
  @HttpCode(200)
  async testBreaker(@Body() body: { breaker?: string; confirm?: string; inputs?: Record<string, number> }) {
    if ((process.env.TRADING_MODE ?? '').trim().toLowerCase() === 'live') {
      this.logger.error('test-breaker BLOCKED: TRADING_MODE=live');
      return { ok: false, error: 'REFUSED: TRADING_MODE=live. DEMO-only endpoint.' };
    }
    if (body?.confirm !== 'TEST_FIRE_DEMO') {
      return { ok: false, error: 'Send body { "confirm": "TEST_FIRE_DEMO", "breaker": "...", "inputs": {...} }' };
    }
    if (body.breaker !== 'VOLATILITY_COOLDOWN' && body.breaker !== 'SESSION_GAP') {
      return { ok: false, error: 'breaker must be "VOLATILITY_COOLDOWN" or "SESSION_GAP"' };
    }
    this.logger.warn(`test-breaker: firing ${body.breaker} with synthetic inputs (DEMO)`);
    const spec = await this.breakers.testFireBreaker(body.breaker, body.inputs ?? {});
    return { ok: true, fired: spec !== null, spec: spec ?? null };
  }
}
