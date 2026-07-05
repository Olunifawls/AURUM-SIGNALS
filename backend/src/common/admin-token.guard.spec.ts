import { UnauthorizedException } from '@nestjs/common';
import { AdminTokenGuard } from './admin-token.guard';

function ctx(headers: Record<string, string | undefined>) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as any;
}

describe('AdminTokenGuard', () => {
  const guard = new AdminTokenGuard();
  const OLD = process.env.ADMIN_API_TOKEN;
  afterEach(() => {
    process.env.ADMIN_API_TOKEN = OLD;
  });

  it('rejects when the server token is not configured (fail closed)', () => {
    delete process.env.ADMIN_API_TOKEN;
    expect(() => guard.canActivate(ctx({ 'x-admin-token': 'anything' }))).toThrow(UnauthorizedException);
  });

  it('rejects a missing token', () => {
    process.env.ADMIN_API_TOKEN = 'secret';
    expect(() => guard.canActivate(ctx({}))).toThrow(UnauthorizedException);
  });

  it('rejects a wrong token', () => {
    process.env.ADMIN_API_TOKEN = 'secret';
    expect(() => guard.canActivate(ctx({ 'x-admin-token': 'nope' }))).toThrow(UnauthorizedException);
  });

  it('accepts the exact token', () => {
    process.env.ADMIN_API_TOKEN = 'secret';
    expect(guard.canActivate(ctx({ 'x-admin-token': 'secret' }))).toBe(true);
  });
});
