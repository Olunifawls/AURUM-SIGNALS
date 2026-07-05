import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { CommonModule } from '../common/common.module';
import { SizingService } from './sizing.service';
import { SizingController } from './sizing.controller';

@Module({
  imports: [SupabaseModule, CommonModule],
  controllers: [SizingController],
  providers: [SizingService],
  exports: [SizingService],
})
export class SizingModule {}
