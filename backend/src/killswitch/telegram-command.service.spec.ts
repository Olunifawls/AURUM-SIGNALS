import { TelegramCommandService } from './telegram-command.service';

function makeSupabase(openPositions: any[] = []) {
  const updates: any[] = [];
  const from = () => ({
    select: () => ({ eq: () => Promise.resolve({ data: openPositions }) }),
    update: (fields: any) => ({ eq: () => { updates.push(fields); return Promise.resolve({ error: null }); } }),
  });
  return { client: { from } as any, updates };
}

function makeState() {
  return {
    setHalt: jest.fn(async () => undefined),
    resumeManual: jest.fn(async () => ['MANUAL_HALT']),
    resumeDrawdown: jest.fn(async () => true),
    getActiveHalts: jest.fn(async () => []),
  } as any;
}

function makeAdapter() {
  return {
    getAccount: jest.fn(async () => ({ equity: 100000, currency: 'GBP', unrealizedPl: 0 })),
    getOpenTrades: jest.fn(async () => []),
    closeTrade: jest.fn(async () => ({ closed: true })),
  } as any;
}

const alerts = () => ({ send: jest.fn(async () => true) } as any);
const msg = (id: number, text: string) => ({ message: { chat: { id }, text } });

describe('(d) COMMAND AUTH', () => {
  const OLD = { ...process.env };
  beforeEach(() => (process.env.TELEGRAM_CHAT_ID = '555'));
  afterEach(() => (process.env = { ...OLD }));

  it('ignores a command from a non-owner chat (silently, no action)', async () => {
    const state = makeState();
    const a = alerts();
    const svc = new TelegramCommandService(makeSupabase().client, makeAdapter(), state, a);
    await svc.handleUpdate(msg(123456, '/halt')); // not the owner
    expect(state.setHalt).not.toHaveBeenCalled();
    expect(a.send).not.toHaveBeenCalled();
  });

  it('acts on a command from the owner chat', async () => {
    const state = makeState();
    const a = alerts();
    const svc = new TelegramCommandService(makeSupabase().client, makeAdapter(), state, a);
    await svc.handleUpdate(msg(555, '/halt'));
    expect(state.setHalt).toHaveBeenCalledWith('MANUAL_HALT', expect.anything());
    expect(a.send).toHaveBeenCalled();
  });
});

describe('(b) /halt_close_all requires exact confirmation', () => {
  const OLD = { ...process.env };
  beforeEach(() => (process.env.TELEGRAM_CHAT_ID = '555'));
  afterEach(() => (process.env = { ...OLD }));

  it('closes positions only after the exact "CONFIRM CLOSE ALL" reply', async () => {
    const { client } = makeSupabase([{ id: 'p1', broker_trade_id: 'T1' }]);
    const adapter = makeAdapter();
    const state = makeState();
    const svc = new TelegramCommandService(client, adapter, state, alerts());

    await svc.handleUpdate(msg(555, '/halt_close_all'));
    expect(adapter.closeTrade).not.toHaveBeenCalled(); // nothing closed yet

    await svc.handleUpdate(msg(555, 'CONFIRM CLOSE ALL'));
    expect(state.setHalt).toHaveBeenCalledWith('MANUAL_HALT', expect.anything());
    expect(adapter.closeTrade).toHaveBeenCalledWith('T1');
  });

  it('does NOT close on a wrong confirmation', async () => {
    const { client } = makeSupabase([{ id: 'p1', broker_trade_id: 'T1' }]);
    const adapter = makeAdapter();
    const svc = new TelegramCommandService(client, adapter, makeState(), alerts());

    await svc.handleUpdate(msg(555, '/halt_close_all'));
    await svc.handleUpdate(msg(555, 'CONFIRM')); // wrong text
    expect(adapter.closeTrade).not.toHaveBeenCalled();
  });

  it('/mode never offers a live switch', async () => {
    const a = alerts();
    const svc = new TelegramCommandService(makeSupabase().client, makeAdapter(), makeState(), a);
    await svc.handleUpdate(msg(555, '/mode'));
    const sent = a.send.mock.calls[0][0] as string;
    expect(sent).toContain('DEMO');
    expect(sent.toLowerCase()).toContain('not available via telegram');
  });
});
