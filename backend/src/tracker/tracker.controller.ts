import { Controller, Post } from '@nestjs/common';
import { TrackerService } from './tracker.service';

/**
 * On-demand resolution + rollup. Same unauthenticated caveat as the prior
 * manual triggers on this personal single-instance backend — no new auth scope.
 */
@Controller('api/track')
export class TrackerController {
  constructor(private readonly tracker: TrackerService) {}

  @Post('run')
  run() {
    return this.tracker.run();
  }
}
