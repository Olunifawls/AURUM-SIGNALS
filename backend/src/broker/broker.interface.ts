// Broker-agnostic interface. OANDA is ONE implementation behind this; another
// broker (e.g. IG) could be added later without touching callers.

export const BROKER_ADAPTER = 'BROKER_ADAPTER';

export type Side = 'BUY' | 'SELL';

export interface AccountSummary {
  id: string;
  currency: string;
  balance: number;
  equity: number; // NAV
  unrealizedPl: number;
  marginUsed: number;
  openTradeCount: number;
  lastTransactionId: string;
  raw?: unknown;
}

export interface Pricing {
  instrument: string;
  bid: number;
  ask: number;
  spread: number;
  tradeable: boolean;
}

export interface InstrumentInfo {
  name: string;
  type: string;
  marginRate: number;
  minimumTradeSize: number;
  tradeUnitsPrecision: number;
  displayPrecision: number;
}

export interface BrokerTrade {
  id: string; // broker trade id
  instrument: string;
  side: Side;
  units: number;
  price: number;
  unrealizedPl: number;
  clientTag?: string;
  raw?: unknown;
}

export interface PlaceMarketOrderParams {
  instrument: string; // OANDA format, e.g. 'XAU_USD'
  side: Side;
  units: number; // positive magnitude; the adapter signs it
  stopLossPrice?: number;
  takeProfitPrice?: number;
  clientTag: string; // reconciliation tag: 'aurum-{signal_id}'
}

export type PlaceStatus = 'FILLED' | 'REJECTED' | 'SUBMITTED';

export interface PlaceMarketOrderResult {
  status: PlaceStatus;
  brokerOrderId?: string;
  brokerTradeId?: string;
  fillPrice?: number;
  reason?: string;
  raw?: unknown;
}

export interface BrokerTransaction {
  id: string;
  type: string;
  instrument?: string;
  clientTag?: string;
  raw?: unknown;
}

export interface IBrokerAdapter {
  getAccount(): Promise<AccountSummary>;
  getOpenTrades(): Promise<BrokerTrade[]>;
  placeMarketOrder(params: PlaceMarketOrderParams): Promise<PlaceMarketOrderResult>;
  closeTrade(tradeId: string): Promise<{ closed: boolean; raw?: unknown }>;
  getTransactionsSince(id: string): Promise<BrokerTransaction[]>;
  getPricing(instrument: string): Promise<Pricing>;
  getInstrument(instrument: string): Promise<InstrumentInfo>;
}

/**
 * Thrown when a market-order submit fails AMBIGUOUSLY (network error / timeout
 * after the request may have been sent). The caller MUST NOT blind-retry — it
 * reconciles via the client tag to determine whether the order actually exists.
 */
export class AmbiguousSubmitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AmbiguousSubmitError';
  }
}
