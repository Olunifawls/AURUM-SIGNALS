import { HealthService } from './health.service';

function makeSupabase() {
  const b: any = {
    select: () => b,
    eq: () => b,
    order: () => b,
    limit: () => Promise.resolve({ data: [] }),
  };
  return { from: () => b } as any;
}

const ingestion = { getHealth: () => ({ sources: {} }) } as any;

describe('HealthService breakeven setting', () => {
  const OLD = { ...process.env };
  afterEach(() => (process.env = { ...OLD }));

  it('reports true when BREAKEVEN_STOP_ENABLED=true', async () => {
    process.env.BREAKEVEN_STOP_ENABLED = 'true';
    const health = await new HealthService(makeSupabase(), ingestion).getHealth();
    expect(health.breakevenStopEnabled).toBe(true);
  });

  it('reports false when the key is missing', async () => {
    delete process.env.BREAKEVEN_STOP_ENABLED;
    const health = await new HealthService(makeSupabase(), ingestion).getHealth();
    expect(health.breakevenStopEnabled).toBe(false);
  });
});
