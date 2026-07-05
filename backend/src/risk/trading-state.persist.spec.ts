import { TradingStateService } from './trading-state.service';

// Stateful system_halts mock shared across service instances (simulates the DB).
function haltStore() {
  const rows = new Map<string, any>();
  const from = () => {
    const b: any = {
      upsert: (row: any) => { rows.set(row.halt_type, { ...row }); return Promise.resolve({ error: null }); },
      update: (fields: any) => ({ eq: (_k: string, v: string) => { const r = rows.get(v); if (r) Object.assign(r, fields); return Promise.resolve({ error: null }); } }),
      select: () => b,
      eq: () => b,
      then: (res: any) => Promise.resolve({ data: [...rows.values()].filter((r) => r.active) }).then(res),
    };
    return b;
  };
  return { client: { from } as any, rows };
}

describe('(f) halts PERSIST across restarts', () => {
  it('a halt set before "restart" is still active for a fresh service instance', async () => {
    const { client } = haltStore();
    const before = new TradingStateService(client);
    await before.setHalt('MANUAL_HALT', { requiresManual: true, reason: 'manual' });

    const afterReboot = new TradingStateService(client); // new instance, same DB
    expect(await afterReboot.isHalted()).toBe(true);
  });
});

describe('(c) /resume rules', () => {
  it('a loss-limit halt CANNOT be cleared by /resume (only its reset rule)', async () => {
    const { client } = haltStore();
    const state = new TradingStateService(client);
    await state.setHalt('DAILY_LOSS', { requiresManual: false, reason: 'daily loss' });

    const cleared = await state.resumeManual();
    expect(cleared).not.toContain('DAILY_LOSS');
    expect(await state.isHalted()).toBe(true); // still halted
  });

  it('the drawdown halt is NOT cleared by /resume; it needs resumeDrawdown (confirmation)', async () => {
    const { client } = haltStore();
    const state = new TradingStateService(client);
    await state.setHalt('DRAWDOWN', { scope: 'ALL', requiresManual: true, reason: '-20%' });

    const cleared = await state.resumeManual();
    expect(cleared).not.toContain('DRAWDOWN');
    expect(await state.isHalted()).toBe(true);

    expect(await state.resumeDrawdown()).toBe(true); // confirmation path clears it
    expect(await state.isHalted()).toBe(false);
  });

  it('/resume clears a plain MANUAL_HALT', async () => {
    const { client } = haltStore();
    const state = new TradingStateService(client);
    await state.setHalt('MANUAL_HALT', { requiresManual: true });
    expect(await state.resumeManual()).toContain('MANUAL_HALT');
    expect(await state.isHalted()).toBe(false);
  });

  it('a timed halt auto-clears once clears_at passes', async () => {
    const { client } = haltStore();
    const state = new TradingStateService(client);
    await state.setHalt('VOLATILITY_COOLDOWN', { requiresManual: false, clearsAt: new Date('2026-07-08T10:00:00Z') });
    // isVolatilityCooldown at a later time -> expired -> auto-cleared
    expect(await state.isVolatilityCooldown(new Date('2026-07-08T13:00:00Z'))).toBe(false);
  });
});
