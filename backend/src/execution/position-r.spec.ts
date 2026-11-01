import { positionR, tradeableR } from '../v1/ledger/forward-test';
import { realizedR } from './exec-util';
import { closedPositionR } from './position-r';

const SIGNAL = { entry: 2000, stop: 1990 }; // original risk 10

function db(signal: unknown, error: unknown = null) {
  const reads: string[] = [];
  const b: any = { select: () => b, eq: (_: string, id: string) => (reads.push(id), b), limit: async () => ({ data: signal ? [signal] : [], error }) };
  return { client: { from: () => b } as any, reads };
}

describe('positionR', () => {
  it('a fill better than the signal does not shrink the unit', () => {
    // BUY filled 5 better. Fill-based risk 5 would make this +3R.
    expect(positionR({ side: 'BUY', fill: 1995, initialStop: 1990 }, SIGNAL, 2010)).toBe(1.5);
    expect(realizedR(1995, 1990, 2010, 'BUY')).toBe(3);
  });

  it('a fill worse than the signal does not grow the unit', () => {
    expect(positionR({ side: 'BUY', fill: 2005, initialStop: 1990 }, SIGNAL, 2015)).toBe(1);
  });

  it('measures a SELL in the same unit', () => {
    expect(positionR({ side: 'SELL', fill: 2005, initialStop: 2010 }, { entry: 2000, stop: 2010 }, 1985)).toBe(2);
  });

  it('a stop hit from a worse fill passes -1R', () => {
    expect(positionR({ side: 'BUY', fill: 2002, initialStop: 1990 }, SIGNAL, 1990)).toBe(-1.2);
  });

  it('is the ledger unit: the same as tradeableR from the same fill', () => {
    const fired = { side: 'BUY' as const, ...SIGNAL, firePrice: 1995 };
    expect(positionR({ side: 'BUY', fill: 1995, initialStop: 1990 }, SIGNAL, 2020)).toBe(tradeableR(fired, 2020));
  });

  it.each([null, undefined])('falls back to the fill risk with no signal (%s)', (signal) => {
    expect(positionR({ side: 'BUY', fill: 1995, initialStop: 1990 }, signal, 2010)).toBe(realizedR(1995, 1990, 2010, 'BUY'));
  });

  it('falls back when the signal has no risk', () => {
    expect(positionR({ side: 'BUY', fill: 1995, initialStop: 1990 }, { entry: 2000, stop: 2000 }, 2010)).toBe(3);
  });
});

describe('closedPositionR', () => {
  const pos = { signal_id: 'sig-1', side: 'BUY', entry_price: '1995', stop_loss: '2000.1', initial_stop_loss: '1990' };

  it('reads the position signal and uses its risk', async () => {
    const { client, reads } = db({ entry_price: '2000', stop_loss: '1990' });
    await expect(closedPositionR(client, pos, 2010)).resolves.toBe(1.5);
    expect(reads).toEqual(['sig-1']);
  });

  it('with no signal id, reads nothing and uses the initial stop, not a moved stop', async () => {
    const { client, reads } = db(null);
    await expect(closedPositionR(client, { ...pos, signal_id: null }, 2010)).resolves.toBe(3);
    expect(reads).toEqual([]);
  });

  it('falls back when the signal is gone', async () => {
    await expect(closedPositionR(db(null).client, pos, 2010)).resolves.toBe(3);
  });

  it('falls back when the read errors', async () => {
    await expect(closedPositionR(db(null, { message: 'down' }).client, pos, 2010)).resolves.toBe(3);
  });

  it('falls back when the read throws: a close must still be recorded', async () => {
    const client = { from: () => { throw new Error('network'); } } as any;
    await expect(closedPositionR(client, pos, 2010)).resolves.toBe(3);
  });
});
