import { WeeklyReportService } from '../alerts/weekly-report.service';
import { KillSwitchModule } from '../killswitch/killswitch.module';
import { WeeklySnapshotService } from './ledger/weekly-snapshot.service';
import { V1Module } from './v1.module';
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

describe('weekly snapshot wiring', () => {
  it('resolves through the real modules, with no credentials and no startup hooks', async () => {
    const mod = await Test.createTestingModule({ imports: [ScheduleModule.forRoot(), KillSwitchModule, V1Module] }).compile();
    expect(mod.get(WeeklySnapshotService, { strict: false })).toBeDefined();
    expect(mod.get(WeeklyReportService, { strict: false })).toBeDefined();
    expect(mod.get(ChiefAnalystService, { strict: false })).toBeDefined();
    await mod.close();
  });
});
