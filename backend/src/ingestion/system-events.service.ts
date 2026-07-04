import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase/supabase.provider';

export type EventLevel = 'INFO' | 'WARN' | 'ERROR';

/**
 * Writes structured events to the `system_events` table (service-role, so it
 * bypasses RLS). Logging must never crash the caller: DB failures are swallowed
 * after being echoed to the Nest logger.
 */
@Injectable()
export class SystemEventsService {
  private readonly logger = new Logger('SystemEvents');

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient | null,
  ) {}

  async log(
    level: EventLevel,
    source: string,
    message: string,
    meta?: Record<string, unknown>,
  ): Promise<void> {
    const line = `[${source}] ${message}`;
    if (level === 'ERROR') this.logger.error(line);
    else if (level === 'WARN') this.logger.warn(line);
    else this.logger.log(line);

    if (!this.supabase) return;
    try {
      const { error } = await this.supabase
        .from('system_events')
        .insert({ level, source, message, meta: meta ?? null });
      if (error) {
        this.logger.error(`failed to persist system_event: ${error.message}`);
      }
    } catch (err) {
      this.logger.error(`failed to persist system_event: ${String(err)}`);
    }
  }

  info(source: string, message: string, meta?: Record<string, unknown>) {
    return this.log('INFO', source, message, meta);
  }

  warn(source: string, message: string, meta?: Record<string, unknown>) {
    return this.log('WARN', source, message, meta);
  }

  error(source: string, message: string, meta?: Record<string, unknown>) {
    return this.log('ERROR', source, message, meta);
  }
}
