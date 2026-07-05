import { Controller, Post, UseGuards } from '@nestjs/common';
import { TrackerService } from './tracker.service';
import { AdminTokenGuard } from '../common/admin-token.guard';

/**
 * On-demand resolution + rollup. Same unauthenticated caveat as the prior
 * manual triggers on this personal single-instance backend — no new auth scope.
 */
@UseGuards(AdminTokenGuard)
@Controller('api/track')
export class TrackerController {
  constructor(private readonly tracker: TrackerService) {}

  @Post('run')
  run() {
    return this.tracker.run();
  }
}
