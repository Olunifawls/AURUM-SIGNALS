import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';

/**
 * Requires header `X-Admin-Token` == ADMIN_API_TOKEN on every mutating /
 * trigger / credit-consuming endpoint. Fails CLOSED: if ADMIN_API_TOKEN is not
 * configured, all guarded requests are rejected.
 */
@Injectable()
export class AdminTokenGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ headers: Record<string, string | undefined> }>();
    const expected = process.env.ADMIN_API_TOKEN;
    const provided = req.headers['x-admin-token'];

    if (!expected) {
      throw new UnauthorizedException('ADMIN_API_TOKEN is not configured on the server');
    }
    if (!provided || provided !== expected) {
      throw new UnauthorizedException('Missing or invalid X-Admin-Token');
    }
    return true;
  }
}
