import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { CommonModule } from '../common/common.module';
import { OandaCandlesService } from '../ingestion/oanda-candles.service';
import { AiSummaryService } from './chief/ai-summary.service';
import { ChiefAnalystService } from './chief/chief-analyst.service';
import { V1DataService } from './data/v1-data.service';

/** V1 multi-agent ruleset. Imported by SignalsModule, so it cannot import IngestionModule. */
@Module({
  imports: [SupabaseModule, CommonModule],
  providers: [OandaCandlesService, V1DataService, AiSummaryService, ChiefAnalystService],
  exports: [ChiefAnalystService, V1DataService, OandaCandlesService],
})
export class V1Module {}
