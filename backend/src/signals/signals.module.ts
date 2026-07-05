import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { CommonModule } from '../common/common.module';
import { SizingModule } from '../sizing/sizing.module';
import { SignalsService } from './signals.service';
import { SignalsController } from './signals.controller';

@Module({
  imports: [SupabaseModule, CommonModule, SizingModule],
  controllers: [SignalsController],
  providers: [SignalsService],
  exports: [SignalsService],
})
export class SignalsModule {}
