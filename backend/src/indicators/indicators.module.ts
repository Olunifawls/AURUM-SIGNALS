import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { CommonModule } from '../common/common.module';
import { IndicatorsService } from './indicators.service';
import { IndicatorsController } from './indicators.controller';

@Module({
  imports: [SupabaseModule, CommonModule],
  controllers: [IndicatorsController],
  providers: [IndicatorsService],
  exports: [IndicatorsService],
})
export class IndicatorsModule {}
