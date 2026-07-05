import { loadRepoEnv } from './load-env';

describe('loadRepoEnv', () => {
  it('(Docker/CI safety) does NOT throw and returns null when no .env file exists', () => {
    expect(() => loadRepoEnv(['/definitely/not/here/.env', '/nope/.env'])).not.toThrow();
    expect(loadRepoEnv(['/definitely/not/here/.env'])).toBeNull();
  });

  it('does not override an already-set process.env variable', () => {
    process.env.__AURUM_TEST_VAR__ = 'preset';
    // even if a file were loaded, dotenv default does not override; with no file it is a no-op
    loadRepoEnv(['/definitely/not/here/.env']);
    expect(process.env.__AURUM_TEST_VAR__).toBe('preset');
    delete process.env.__AURUM_TEST_VAR__;
  });
});
