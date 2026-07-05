import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { CommonModule } from '../common/common.module';
import { TrackerService } from './tracker.service';
import { TrackerController } from './tracker.controller';

@Module({
  imports: [SupabaseModule, CommonModule],
  controllers: [TrackerController],
  providers: [TrackerService],
  exports: [TrackerService],
})
export class TrackerModule {}
