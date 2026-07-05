import { Body, Controller, Post } from '@nestjs/common';
import { AlertsService } from './alerts.service';

/**
 * Manual alert test trigger. Same unauthenticated caveat as the prior manual
 * endpoints on this personal single-instance backend — no new auth scope, no UI.
 */
@Controller('api/alerts')
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  @Post('test')
  test(@Body() body: { type?: 'signal' | 'resolution' | 'admin' }) {
    return this.alerts.sendTest(body?.type ?? 'signal');
  }
}
