import { Test } from '@nestjs/testing';
import { ScheduleModule } from '@nestjs/schedule';
import { SignalsModule } from '../signals/signals.module';
import { TradeManagerModule } from './trade-manager/trade-manager.module';
import { NewsExitService } from './trade-manager/news-exit.service';
import { ChiefAnalystService } from './chief/chief-analyst.service';
import { SignalsService } from '../signals/signals.service';

describe('V1 module wiring', () => {
  it('resolves every provider through Nest DI', async () => {
    const mod = await Test.createTestingModule({ imports: [ScheduleModule.forRoot(), SignalsModule, TradeManagerModule] }).compile();
    expect(mod.get(ChiefAnalystService, { strict: false })).toBeDefined();
    expect(mod.get(NewsExitService, { strict: false })).toBeDefined();
    expect(mod.get(SignalsService, { strict: false })).toBeDefined();
  });
});
