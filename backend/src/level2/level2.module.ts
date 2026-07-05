import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { BrokerAccountSeedService } from './broker-account-seed.service';

/**
 * Level 2 (automated execution) — L2-INC-0: config + the demo broker-account
 * seed only. No broker calls, no risk/execution logic. Does not touch Level 1.
 */
@Module({
  imports: [SupabaseModule],
  providers: [BrokerAccountSeedService],
})
export class Level2Module {}
