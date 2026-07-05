import { Injectable, Logger } from '@nestjs/common';
import {
  AccountSummary,
  AmbiguousSubmitError,
  BrokerTrade,
  BrokerTransaction,
  IBrokerAdapter,
  InstrumentInfo,
  PlaceMarketOrderParams,
  PlaceMarketOrderResult,
  Pricing,
} from './broker.interface';

// DEMO ONLY. The live URL/token are NEVER referenced in this increment.
const OANDA_FXPRACTICE_URL = 'https://api-fxpractice.oanda.com';
const TIMEOUT_MS = 10_000;
const RETRIES = 3;

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * OANDA REST v20 adapter — practice/demo account only. Reads are retried
 * (idempotent); placeMarketOrder is NEVER blind-retried (see AmbiguousSubmitError).
 *
 * XAU_USD precision (confirmed empirically against the demo account, 2026-07):
 * type METAL, minimumTradeSize 0.1, tradeUnitsPrecision 1 (units in 0.1 steps),
 * displayPrecision 3 (SL/TP prices to 3 dp). NOTE: this differs from the spec's
 * assumption of "integer ounces, min 1" — the real minimum is 0.1 units.
 */
@Injectable()
export class OandaAdapter implements IBrokerAdapter {
  private readonly logger = new Logger('OandaAdapter');

  private get token(): string | undefined {
    return process.env.OANDA_API_TOKEN_DEMO || undefined;
  }
  private get account(): string | undefined {
    return process.env.OANDA_ACCOUNT_ID_DEMO || undefined;
  }

  private fmtPrice(p: number): string {
    return p.toFixed(3); // OANDA XAU_USD display precision
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
    opts: { retry?: boolean } = {},
  ): Promise<{ status: number; json: any }> {
    const token = this.token;
    const account = this.account;
    if (!token || !account) {
      throw new Error('OANDA demo not configured (OANDA_API_TOKEN_DEMO / OANDA_ACCOUNT_ID_DEMO)');
    }
    const attempts = opts.retry ? RETRIES : 1;
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        const res = await fetch(`${OANDA_FXPRACTICE_URL}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Accept-Datetime-Format': 'RFC3339',
          },
          body: body != null ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        const text = await res.text();
        return { status: res.status, json: text ? JSON.parse(text) : {} };
      } catch (err) {
        lastErr = err; // network / timeout / parse
        if (i < attempts - 1) await delay(300 * 2 ** i);
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  async getAccount(): Promise<AccountSummary> {
    const { status, json } = await this.request('GET', `/v3/accounts/${this.account}/summary`, undefined, {
      retry: true,
    });
    const a = json.account;
    if (!a) throw new Error(`OANDA getAccount failed (HTTP ${status}): ${json.errorMessage ?? 'no account'}`);
    return {
      id: a.id,
      currency: a.currency,
      balance: Number(a.balance),
      equity: Number(a.NAV),
      unrealizedPl: Number(a.unrealizedPL),
      marginUsed: Number(a.marginUsed ?? 0),
      openTradeCount: Number(a.openTradeCount),
      lastTransactionId: String(a.lastTransactionID),
      raw: json,
    };
  }

  async getPricing(instrument: string): Promise<Pricing> {
    const { json } = await this.request(
      'GET',
      `/v3/accounts/${this.account}/pricing?instruments=${encodeURIComponent(instrument)}`,
      undefined,
      { retry: true },
    );
    const p = json.prices?.[0];
    const bid = Number(p?.bids?.[0]?.price ?? p?.closeoutBid ?? 0);
    const ask = Number(p?.asks?.[0]?.price ?? p?.closeoutAsk ?? 0);
    return { instrument, bid, ask, spread: ask - bid, tradeable: p?.tradeable ?? p?.status === 'tradeable' };
  }

  async getInstrument(instrument: string): Promise<InstrumentInfo> {
    const { json } = await this.request(
      'GET',
      `/v3/accounts/${this.account}/instruments?instruments=${encodeURIComponent(instrument)}`,
      undefined,
      { retry: true },
    );
    const i = json.instruments?.[0] ?? {};
    return {
      name: i.name ?? instrument,
      type: i.type ?? 'METAL',
      marginRate: Number(i.marginRate ?? 0.05),
      minimumTradeSize: Number(i.minimumTradeSize ?? 0.1),
      tradeUnitsPrecision: Number(i.tradeUnitsPrecision ?? 1),
      displayPrecision: Number(i.displayPrecision ?? 3),
    };
  }

  async getOpenTrades(): Promise<BrokerTrade[]> {
    const { json } = await this.request('GET', `/v3/accounts/${this.account}/openTrades`, undefined, {
      retry: true,
    });
    return (json.trades ?? []).map((t: any): BrokerTrade => {
      const u = Number(t.currentUnits);
      return {
        id: String(t.id),
        instrument: t.instrument,
        side: u >= 0 ? 'BUY' : 'SELL',
        units: Math.abs(u),
        price: Number(t.price),
        unrealizedPl: Number(t.unrealizedPL),
        clientTag: t.clientExtensions?.id,
        raw: t,
      };
    });
  }

  async placeMarketOrder(p: PlaceMarketOrderParams): Promise<PlaceMarketOrderResult> {
    const signedUnits = p.side === 'BUY' ? Math.abs(p.units) : -Math.abs(p.units);
    const order: Record<string, unknown> = {
      type: 'MARKET',
      instrument: p.instrument,
      // XAU_USD tradeUnitsPrecision = 1 (0.1-unit steps); round to 1 dp.
      units: String(Math.round(signedUnits * 10) / 10),
      timeInForce: 'FOK',
      positionFill: 'DEFAULT',
      clientExtensions: { id: p.clientTag }, // tag on the ORDER
      // Tag the resulting TRADE too — order clientExtensions do NOT propagate to
      // the opened trade, so getOpenTrades()/ambiguous-reconcile could not match
      // it by tag (the "NOT FOUND" seen in verification). This makes the trade
      // carry aurum-{signal_id} so tag-based open-trade lookups work.
      tradeClientExtensions: { id: p.clientTag },
    };
    if (p.stopLossPrice != null) order.stopLossOnFill = { price: this.fmtPrice(p.stopLossPrice) };
    if (p.takeProfitPrice != null) order.takeProfitOnFill = { price: this.fmtPrice(p.takeProfitPrice) };

    let resp: { status: number; json: any };
    try {
      // NEVER retried: a timeout after send is ambiguous, not safe to repeat.
      resp = await this.request('POST', `/v3/accounts/${this.account}/orders`, { order }, { retry: false });
    } catch (err) {
      throw new AmbiguousSubmitError(`OANDA order submit failed ambiguously: ${String(err)}`);
    }

    const j = resp.json;
    if (j.orderFillTransaction) {
      const f = j.orderFillTransaction;
      return {
        status: 'FILLED',
        brokerOrderId: String(f.orderID),
        brokerTradeId: f.tradeOpened?.tradeID ? String(f.tradeOpened.tradeID) : undefined,
        fillPrice: Number(f.price),
        raw: j,
      };
    }
    const rej = j.orderCancelTransaction || j.orderRejectTransaction;
    const reason = rej?.reason || j.errorMessage || j.errorCode || `HTTP ${resp.status}`;
    return { status: 'REJECTED', reason: String(reason), raw: j };
  }

  async closeTrade(tradeId: string): Promise<{ closed: boolean; raw?: unknown }> {
    const { json } = await this.request('PUT', `/v3/accounts/${this.account}/trades/${tradeId}/close`, {}, {
      retry: false,
    });
    return { closed: !!json.orderFillTransaction, raw: json };
  }

  async getTrade(tradeId: string): Promise<import('./broker.interface').BrokerTradeState> {
    const { json } = await this.request('GET', `/v3/accounts/${this.account}/trades/${tradeId}`, undefined, {
      retry: true,
    });
    const t = json.trade ?? {};
    const units = Number(t.currentUnits ?? t.initialUnits ?? 0);
    return {
      id: String(t.id ?? tradeId),
      state: t.state === 'CLOSED' ? 'CLOSED' : 'OPEN',
      instrument: t.instrument,
      units: Math.abs(units),
      price: Number(t.price ?? 0),
      closePrice: t.averageClosePrice != null ? Number(t.averageClosePrice) : null,
      realizedPl: Number(t.realizedPL ?? 0),
      clientTag: t.clientExtensions?.id,
      raw: json,
    };
  }

  async getTransactionsSince(id: string): Promise<BrokerTransaction[]> {
    const { json } = await this.request(
      'GET',
      `/v3/accounts/${this.account}/transactions/sinceid?id=${encodeURIComponent(id)}`,
      undefined,
      { retry: true },
    );
    return (json.transactions ?? []).map((t: any): BrokerTransaction => ({
      id: String(t.id),
      type: t.type,
      instrument: t.instrument,
      clientTag: t.clientExtensions?.id,
      raw: t,
    }));
  }
}
