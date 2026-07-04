import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(() => {
    controller = new HealthController();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('returns status ok with an ISO timestamp', () => {
    const result = controller.check();
    expect(result.status).toBe('ok');
    // ts should be a valid ISO date string
    expect(new Date(result.ts).toISOString()).toBe(result.ts);
  });
});
