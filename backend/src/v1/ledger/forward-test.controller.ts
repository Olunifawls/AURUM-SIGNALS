import { Controller, Get, UseGuards } from '@nestjs/common';
import { AdminTokenGuard } from '../../common/admin-token.guard';
import { ForwardTestService } from './forward-test.service';

/** Same guard and path prefix as the Execution API: L2 tables are anon-denied, and the
 * Next /api/exec proxy injects the token server-side. */
@UseGuards(AdminTokenGuard)
@Controller('api/execution')
export class ForwardTestController {
  constructor(private readonly forwardTest: ForwardTestService) {}

  @Get('forward-test')
  report() {
    return this.forwardTest.report();
  }
}
