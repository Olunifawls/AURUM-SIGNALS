import { Body, Controller, HttpCode, Logger, Post, UseGuards } from '@nestjs/common';
import { AdminTokenGuard } from '../common/admin-token.guard';
import { AdminResetService } from './admin-reset.service';
import { CircuitBreakerService } from '../killswitch/circuit-breaker.service';
import { RiskManagerService } from '../risk/risk-manager.service';

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
    private readonly risk: RiskManagerService,
  ) {}

  /**
   * POST /api/admin/purge-test-artifacts — surgical removal of synthetic test data.
   * Removes the test position (entry ≈ 4100 / broker trade 78), all risk_events,
   * and active system_halts. Equity snapshots and signals are untouched.
   * Triple-gated (token + TRADING_MODE + confirm).
   */
  @Post('purge-test-artifacts')
  @HttpCode(200)
  async purgeTestArtifacts(@Body() body: { confirm?: string }) {
    if ((process.env.TRADING_MODE ?? '').trim().toLowerCase() === 'live') {
      return { ok: false, error: 'REFUSED: TRADING_MODE=live. DEMO-only endpoint.' };
    }
    if (body?.confirm !== 'PURGE_TEST_ARTIFACTS_DEMO') {
      return { ok: false, error: 'Send body { "confirm": "PURGE_TEST_ARTIFACTS_DEMO" } to proceed.' };
    }
    this.logger.warn('purge-test-artifacts triggered via admin endpoint (DEMO)');
    const result = await this.svc.purgeTestArtifacts();
    return { ok: true, ...result };
  }

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

  /**
   * POST /api/admin/test-assess — run a synthetic OrderIntent through RiskManagerService.assess()
   * and return the decision (approved or rejected + reason). DEMO ONLY. Admin-token gated.
   * Used to prove that an active VOLATILITY_COOLDOWN or SESSION_GAP halt causes the
   * RiskManager to reject new orders at the correct check.
   */
  @Post('test-assess')
  @HttpCode(200)
  async testAssess(@Body() body: { confirm?: string }) {
    if ((process.env.TRADING_MODE ?? '').trim().toLowerCase() === 'live') {
      return { ok: false, error: 'REFUSED: TRADING_MODE=live. DEMO-only endpoint.' };
    }
    if (body?.confirm !== 'TEST_ASSESS_DEMO') {
      return { ok: false, error: 'Send body { "confirm": "TEST_ASSESS_DEMO" }' };
    }
    this.logger.warn('test-assess: running synthetic assess() (DEMO)');
    const decision = await this.risk.assess({
      signalId: 'TEST_ASSESS_SYNTHETIC',
      side: 'BUY',
      timeframe: '15min',
      entryPrice: 3300,
      stopLoss: 3290,
      takeProfit: 3320,
    });
    return { ok: true, approved: decision.approved, reason: decision.reason ?? null };
  }
}
