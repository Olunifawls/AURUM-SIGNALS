import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase/supabase.provider';
import { level2Config } from './level2.config';

/**
 * On startup, UPSERT a single demo OANDA broker_accounts row from env. The
 * account id is NEVER hard-coded in the committed migration — it comes from
 * OANDA_ACCOUNT_ID_DEMO. If that env var is blank (e.g. CI, or before OANDA is
 * configured), the seed is skipped cleanly — no crash, nothing inserted.
 *
 * NO broker calls. This only writes a config row.
 */
@Injectable()
export class BrokerAccountSeedService implements OnModuleInit {
  private readonly logger = new Logger('Level2');

  constructor(@Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient | null) {}

  async onModuleInit(): Promise<void> {
    const cfg = level2Config();
    const accountId = cfg.demo.accountId;

    if (!accountId) {
      this.logger.log('demo OANDA account id not set — skipping broker-account seed');
      return;
    }
    if (!this.supabase) {
      this.logger.log('Supabase client not configured — skipping broker-account seed');
      return;
    }

    try {
      const { error } = await this.supabase.from('broker_accounts').upsert(
        {
          broker: 'OANDA',
          mode: 'demo',
          account_ref: accountId,
          base_currency: cfg.demo.accountCcy,
          is_active: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'broker,mode,account_ref' },
      );
      if (error) {
        this.logger.error(`broker-account seed failed: ${error.message}`);
        return;
      }
      this.logger.log(`demo broker account seeded (OANDA/${cfg.demo.accountCcy}, ref=${accountId})`);
    } catch (err) {
      // Never crash startup on a seed error.
      this.logger.error(`broker-account seed error: ${String(err)}`);
    }
  }
}
