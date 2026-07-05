import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase/supabase.provider';
import { BROKER_ADAPTER, IBrokerAdapter } from '../broker/broker.interface';
import { AlertsService } from '../alerts/alerts.service';
import { TradingStateService } from '../risk/trading-state.service';
import { level2Config } from '../level2/level2.config';
import { scrubString } from './scrub';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Telegram CommandModule (INC-4). Long-polls getUpdates and executes owner
 * commands. STRICT AUTH (C2): only messages from TELEGRAM_CHAT_ID are honoured;
 * everything else is ignored SILENTLY. Live-mode switching is NOT available here.
 */
@Injectable()
export class TelegramCommandService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('TgCommand');
  private polling = false;
  private offset = 0;
  private pending: 'CLOSE_ALL' | 'RESUME_DRAWDOWN' | null = null;

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient | null,
    @Inject(BROKER_ADAPTER) private readonly broker: IBrokerAdapter,
    private readonly state: TradingStateService,
    private readonly alerts: AlertsService,
  ) {}

  private get ownerChatId(): string | undefined {
    return process.env.TELEGRAM_CHAT_ID || undefined;
  }

  onModuleInit(): void {
    if (!process.env.TELEGRAM_BOT_TOKEN || !this.ownerChatId) {
      this.logger.log('Telegram commands disabled (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set)');
      return;
    }
    this.polling = true;
    void this.pollLoop();
    this.logger.log('Telegram command polling started');
  }
  onModuleDestroy(): void {
    this.polling = false;
  }

  private async pollLoop(): Promise<void> {
    while (this.polling) {
      try {
        const updates = await this.getUpdates(this.offset);
        for (const u of updates) {
          this.offset = u.update_id + 1;
          await this.handleUpdate(u);
        }
      } catch (err) {
        this.logger.warn(scrubString(`poll failed: ${String(err)}`));
        await sleep(3000);
      }
    }
  }

  private async getUpdates(offset: number): Promise<any[]> {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return [];
    const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates?timeout=25&offset=${offset}`, {
      signal: AbortSignal.timeout(30_000),
    });
    const json = await res.json();
    return json.ok ? json.result : [];
  }

  /** Entry point (also the unit-test seam). Enforces strict owner auth. */
  async handleUpdate(update: any): Promise<void> {
    const msg = update?.message ?? update?.edited_message;
    if (!msg) return;
    const chatId = String(msg.chat?.id ?? '');
    const text: string = (msg.text ?? '').trim();
    if (!this.ownerChatId || chatId !== this.ownerChatId) {
      this.logger.warn(`ignored command from unauthorized chat ${scrubString(chatId)}`); // silent to sender
      return;
    }
    await this.handleCommand(text);
  }

  private async reply(text: string): Promise<void> {
    await this.alerts.send(scrubString(text));
  }

  async handleCommand(text: string): Promise<void> {
    // Pending confirmations (exact match required).
    if (this.pending === 'CLOSE_ALL') {
      if (text === 'CONFIRM CLOSE ALL') {
        this.pending = null;
        return this.doCloseAll();
      }
      this.pending = null; // any other reply cancels
    }
    if (this.pending === 'RESUME_DRAWDOWN') {
      if (text === 'CONFIRM RESUME') {
        this.pending = null;
        const ok = await this.state.resumeDrawdown();
        return this.reply(ok ? '✅ Drawdown halt cleared.' : 'No drawdown halt active.');
      }
      this.pending = null;
    }

    const cmd = text.split(/\s+/)[0].toLowerCase();
    switch (cmd) {
      case '/status':
        return this.status();
      case '/halt':
        await this.state.setHalt('MANUAL_HALT', { requiresManual: true, reason: 'manual /halt' });
        return this.reply('🛑 Manual halt SET. No new orders. Open positions keep their broker SL/TP. /resume to clear.');
      case '/halt_close_all':
        this.pending = 'CLOSE_ALL';
        return this.reply('⚠️ This will HALT and CLOSE ALL open demo positions at market.\nReply exactly: CONFIRM CLOSE ALL');
      case '/resume':
        return this.resume();
      case '/mode':
        return this.reply(`Mode: ${level2Config().tradingMode.toUpperCase()} (DEMO only). Switching to live is NOT available via Telegram — env + redeploy + gate only.`);
      default:
        return this.reply('Commands: /status /halt /halt_close_all /resume /mode');
    }
  }

  private async resume(): Promise<void> {
    const cleared = await this.state.resumeManual();
    const halts = await this.state.getActiveHalts();
    const drawdown = halts.some((h) => h.halt_type === 'DRAWDOWN');
    let msg = cleared.length ? `✅ Cleared manual halts: ${cleared.join(', ')}.` : 'No manual halts to clear.';
    const stuck = halts.filter((h) => h.halt_type !== 'DRAWDOWN').map((h) => h.halt_type);
    if (stuck.length) msg += `\nStill active (clear on their own rule): ${stuck.join(', ')}.`;
    if (drawdown) {
      this.pending = 'RESUME_DRAWDOWN';
      msg += '\n⛔ DRAWDOWN halt requires confirmation — reply CONFIRM RESUME.';
    }
    return this.reply(msg);
  }

  private async doCloseAll(): Promise<void> {
    await this.state.setHalt('MANUAL_HALT', { requiresManual: true, reason: '/halt_close_all' });
    let closed = 0;
    if (this.supabase) {
      const { data } = await this.supabase.from('positions').select('id,broker_trade_id').eq('status', 'OPEN');
      for (const pos of data ?? []) {
        if (pos.broker_trade_id) {
          try {
            await this.broker.closeTrade(pos.broker_trade_id);
            await this.supabase.from('positions').update({ status: 'CLOSED', close_reason: 'MANUAL_CLOSE_ALL', closed_at: new Date().toISOString() }).eq('id', pos.id);
            closed++;
          } catch (err) {
            this.logger.error(scrubString(`close failed for ${pos.id}: ${String(err)}`));
          }
        }
      }
    }
    return this.reply(`🛑 Halted and closed ${closed} open position(s) at market.`);
  }

  private async status(): Promise<void> {
    const cfg = level2Config();
    let equity = 0;
    let ccy = cfg.demo.accountCcy;
    let openCount = 0;
    let unrealized = 0;
    try {
      const account = await this.broker.getAccount();
      equity = account.equity;
      ccy = account.currency;
      unrealized = account.unrealizedPl;
      openCount = (await this.broker.getOpenTrades()).length;
    } catch {
      /* best-effort */
    }
    const halts = await this.state.getActiveHalts();
    const haltStr = halts.length ? halts.map((h) => h.halt_type).join(', ') : 'none';
    return this.reply(
      `📊 AURUM status\nMode: ${cfg.tradingMode.toUpperCase()}\nEquity: ${equity} ${ccy}\nOpen positions: ${openCount}\nUnrealised P/L: ${unrealized} ${ccy}\nActive halts: ${haltStr}`,
    );
  }
}
