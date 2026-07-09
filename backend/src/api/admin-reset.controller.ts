import { Body, Controller, HttpCode, Logger, Post, UseGuards } from '@nestjs/common';
import { AdminTokenGuard } from '../common/admin-token.guard';
import { AdminResetService } from './admin-reset.service';

/**
 * FIX-2 admin reset endpoint (AdminTokenGuard — server-side only).
 * POST /api/admin/ledger-reset — flatten OANDA, wipe contaminated ledger,
 * re-baseline equity. Requires both:
 *   - Header: X-Admin-Token: <ADMIN_API_TOKEN>
 *   - Body:   { "confirm": "WIPE_LEDGER_DEMO" }
 * Double-gated to prevent accidental wipes. DEMO ONLY.
 */
@UseGuards(AdminTokenGuard)
@Controller('api/admin')
export class AdminResetController {
  private readonly logger = new Logger('AdminReset');

  constructor(private readonly svc: AdminResetService) {}

  @Post('ledger-reset')
  @HttpCode(200)
  async ledgerReset(@Body() body: { confirm?: string }) {
    if (body?.confirm !== 'WIPE_LEDGER_DEMO') {
      return { ok: false, error: 'Send body { "confirm": "WIPE_LEDGER_DEMO" } to proceed.' };
    }
    this.logger.warn('FIX-2 ledger-reset triggered via admin endpoint');
    const result = await this.svc.ledgerReset();
    return { ok: true, ...result };
  }
}
