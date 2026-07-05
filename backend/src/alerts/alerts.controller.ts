import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { AlertsService } from './alerts.service';
import { AdminTokenGuard } from '../common/admin-token.guard';

/**
 * Manual alert test trigger. Same unauthenticated caveat as the prior manual
 * endpoints on this personal single-instance backend — no new auth scope, no UI.
 */
@UseGuards(AdminTokenGuard)
@Controller('api/alerts')
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  @Post('test')
  test(@Body() body: { type?: 'signal' | 'resolution' | 'admin' }) {
    return this.alerts.sendTest(body?.type ?? 'signal');
  }
}
