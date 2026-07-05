import { Injectable } from '@nestjs/common';

/**
 * Shared trading-state flags. READ-ONLY in this increment: the halt state
 * MACHINE and the volatility-cooldown TRIGGER are INC-4. Here the flags default
 * to false; the risk checks simply read them.
 */
@Injectable()
export class TradingStateService {
  private halted = false;
  private volatilityCooldown = false;

  isHalted(): boolean {
    return this.halted;
  }
  isVolatilityCooldown(): boolean {
    return this.volatilityCooldown;
  }
}
