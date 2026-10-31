import { findOriginal, fourDp, setupKey, SetupRow } from './duplicate';

const row = (over: Partial<SetupRow> = {}): SetupRow => ({
  id: 'b',
  symbol: 'XAU/USD',
  timeframe: '4h',
  direction: 'SELL',
  entry_price: 3966.615,
  stop_loss: 3994.3267,
  take_profit: 3911.1915,
  created_at: '2026-10-30T14:33:13Z',
  ...over,
});
const earlier = (over: Partial<SetupRow> = {}) => row({ id: 'a', created_at: '2026-10-30T14:03:06Z', ...over });

describe('duplicate detection', () => {
  it('finds an exact earlier match', () => {
    expect(findOriginal(row(), [earlier(), row()])).toBe('a');
  });

  it('picks the earliest of several, in any order', () => {
    const later = row({ id: 'c', created_at: '2026-10-30T15:02:06Z' });
    expect(findOriginal(later, [row(), later, earlier()])).toBe('a');
  });

  it('treats the earliest signal as the original', () => {
    expect(findOriginal(earlier(), [earlier(), row()])).toBeNull();
    expect(findOriginal(row(), [])).toBeNull();
  });

  it('breaks an equal timestamp by id, so exactly one of the pair is the original', () => {
    const a = earlier({ created_at: row().created_at });
    expect(findOriginal(row(), [a])).toBe('a');
    expect(findOriginal(a, [row()])).toBeNull();
  });

  it('compares prices at 4 decimals, whether numbers or database strings', () => {
    expect(fourDp('3966.6150')).toBe(fourDp(3966.615));
    expect(findOriginal(row({ entry_price: 3966.61504 }), [earlier({ entry_price: '3966.6150' })])).toBe('a');
  });

  it('does not match a difference in the fourth decimal', () => {
    expect(findOriginal(row({ entry_price: 3966.6151 }), [earlier()])).toBeNull();
    expect(findOriginal(row({ stop_loss: 3994.3268 }), [earlier()])).toBeNull();
    expect(findOriginal(row({ take_profit: 3911.1916 }), [earlier()])).toBeNull();
  });

  it('does not match another timeframe, direction or symbol', () => {
    expect(findOriginal(row({ timeframe: '1h' }), [earlier()])).toBeNull();
    expect(findOriginal(row({ direction: 'BUY' }), [earlier()])).toBeNull();
    expect(findOriginal(row({ symbol: 'XAG/USD' }), [earlier()])).toBeNull();
  });

  it('builds a key from every defining field', () => {
    expect(setupKey(row())).toBe('XAU/USD|4h|SELL|3966.6150|3994.3267|3911.1915');
  });
});
